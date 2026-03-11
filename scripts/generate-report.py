#!/usr/bin/env python3
"""
Feed Quality Analysis Report Generator

Generates a styled .docx report with charts and tables from the feed's
scoring pipeline data. Pulls data from the VPS via SSH or reads from
a local CSV for offline use.

Usage:
    python3 scripts/generate-report.py                    # Live VPS data
    python3 scripts/generate-report.py --dry-run          # Print summary only
    python3 scripts/generate-report.py --csv data.csv     # From local CSV
    python3 scripts/generate-report.py --date "March 15"  # Custom date label
    python3 scripts/generate-report.py --output report.docx

Dependencies: pandas, matplotlib, python-docx (pip install python-docx)
"""

import argparse
import io
import json
import os
import subprocess
import sys
from datetime import datetime

import matplotlib
matplotlib.use("Agg")  # Non-interactive backend
import matplotlib.pyplot as plt
import pandas as pd
from docx import Document
from docx.enum.section import WD_ORIENT
from docx.enum.table import WD_TABLE_ALIGNMENT
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml.ns import qn
from docx.shared import Inches, Pt, RGBColor

# ---------------------------------------------------------------------------
# Constants & Style
# ---------------------------------------------------------------------------

ACCENT_COLOR = "#1B4F72"
ACCENT_RGB = RGBColor(0x1B, 0x4F, 0x72)
LIGHT_ACCENT = "#EBF5FB"
LIGHT_ACCENT_RGB = RGBColor(0xEB, 0xF5, 0xFB)
FONT = "Arial"
TITLE_SIZE = Pt(18)
HEADING_SIZE = Pt(12)
BODY_SIZE = Pt(10)
SMALL_SIZE = Pt(8)

SCORE_COMPONENTS = [
    "recency_score", "engagement_score", "bridging_score",
    "source_diversity_score", "relevance_score",
]
COMPONENT_LABELS = ["Recency", "Engagement", "Bridging", "Src Diversity", "Relevance"]
WEIGHT_COLUMNS = [
    "recency_weight", "engagement_weight", "bridging_weight",
    "source_diversity_weight", "relevance_weight",
]

# SQL for the 3 data pulls (separated by marker in SSH output)
MARKER = "---REPORT-MARKER---"

POSTS_SQL = """
COPY (
  SELECT
    p.uri, LEFT(p.text, 200) as text, p.author_did,
    p.topic_vector::text as topics,
    p.classification_method,
    ps.total_score,
    ps.recency_score, ps.engagement_score, ps.bridging_score,
    ps.source_diversity_score, ps.relevance_score,
    ps.recency_weight, ps.engagement_weight, ps.bridging_weight,
    ps.source_diversity_weight, ps.relevance_weight,
    ps.recency_weighted, ps.engagement_weighted, ps.bridging_weighted,
    ps.source_diversity_weighted, ps.relevance_weighted,
    COALESCE(pe.like_count,0) as likes,
    COALESCE(pe.repost_count,0) as reposts,
    COALESCE(pe.reply_count,0) as replies
  FROM post_scores ps
  JOIN posts p ON p.uri = ps.post_uri
  LEFT JOIN post_engagement pe ON pe.post_uri = ps.post_uri
  WHERE ps.epoch_id = (
    SELECT id FROM governance_epochs
    WHERE status='active' ORDER BY id DESC LIMIT 1
  )
    AND p.deleted = FALSE
  ORDER BY ps.total_score DESC
  LIMIT 1000
) TO STDOUT WITH CSV HEADER
""".strip().replace("\n", " ")

EPOCH_SQL = """
SELECT row_to_json(e) FROM (
  SELECT id, status,
    recency_weight, engagement_weight, bridging_weight,
    source_diversity_weight, relevance_weight,
    vote_count, topic_weights::text as topic_weights, created_at::text
  FROM governance_epochs
  WHERE status='active' ORDER BY id DESC LIMIT 1
) e
""".strip().replace("\n", " ")

STATS_SQL = """
SELECT row_to_json(s) FROM (
  SELECT
    (SELECT COUNT(*) FROM posts WHERE deleted=FALSE) as total_posts,
    (SELECT COUNT(*) FROM posts WHERE deleted=FALSE
     AND indexed_at > NOW() - INTERVAL '24 hours') as last_24h,
    (SELECT COUNT(*) FROM post_scores WHERE epoch_id = (
      SELECT id FROM governance_epochs
      WHERE status='active' ORDER BY id DESC LIMIT 1
    )) as scored_count
) s
""".strip().replace("\n", " ")


# ---------------------------------------------------------------------------
# Data Extraction
# ---------------------------------------------------------------------------

def fetch_from_vps():
    """Pull all three datasets from VPS in a single SSH call."""
    combined_cmd = (
        f'docker exec bluesky-feed-postgres psql -U feed -d bluesky_feed -c "{POSTS_SQL}" '
        f'&& echo "{MARKER}" '
        f'&& docker exec bluesky-feed-postgres psql -U feed -d bluesky_feed -t -A -c "{EPOCH_SQL}" '
        f'&& echo "{MARKER}" '
        f'&& docker exec bluesky-feed-postgres psql -U feed -d bluesky_feed -t -A -c "{STATS_SQL}"'
    )
    print("Connecting to VPS and pulling data...")
    result = subprocess.run(
        ["ssh", "corgi-vps", combined_cmd],
        capture_output=True, text=True, timeout=60,
    )
    if result.returncode != 0:
        print(f"SSH failed (exit {result.returncode}):", file=sys.stderr)
        print(result.stderr, file=sys.stderr)
        sys.exit(1)

    parts = result.stdout.split(MARKER)
    if len(parts) < 3:
        print(f"Expected 3 data sections, got {len(parts)}", file=sys.stderr)
        print("Raw output preview:", result.stdout[:500], file=sys.stderr)
        sys.exit(1)

    posts_csv = parts[0].strip()
    epoch_json_str = parts[1].strip()
    stats_json_str = parts[2].strip()

    df = pd.read_csv(io.StringIO(posts_csv))
    epoch = json.loads(epoch_json_str) if epoch_json_str else {}
    stats = json.loads(stats_json_str) if stats_json_str else {}

    # Parse topic_weights from nested string
    if "topic_weights" in epoch and isinstance(epoch["topic_weights"], str):
        try:
            epoch["topic_weights"] = json.loads(epoch["topic_weights"])
        except (json.JSONDecodeError, TypeError):
            epoch["topic_weights"] = {}

    print(f"  Posts: {len(df)}, Epoch: {epoch.get('id', '?')}, "
          f"Total indexed: {stats.get('total_posts', '?')}")
    return df, epoch, stats


def load_from_csv(csv_path, epoch_json_path=None):
    """Load data from local CSV file."""
    df = pd.read_csv(csv_path)
    epoch = {}
    stats = {"total_posts": len(df), "last_24h": 0, "scored_count": len(df)}
    if epoch_json_path and os.path.exists(epoch_json_path):
        with open(epoch_json_path) as f:
            epoch = json.load(f)
    return df, epoch, stats


def parse_topic_vector(tv_str):
    """Parse a topic_vector JSONB string into a dict."""
    if not tv_str or pd.isna(tv_str) or tv_str in ("", "null", "None"):
        return {}
    try:
        return json.loads(tv_str.replace("'", '"'))
    except (json.JSONDecodeError, TypeError):
        return {}


def extract_primary_topic(tv_str):
    """Get the highest-confidence topic from a topic_vector."""
    tv = parse_topic_vector(tv_str)
    if not tv:
        return "uncategorized"
    return max(tv, key=tv.get)


def extract_topic_confidence(tv_str):
    """Get the confidence of the primary topic."""
    tv = parse_topic_vector(tv_str)
    if not tv:
        return 0.0
    return max(tv.values())


# ---------------------------------------------------------------------------
# Chart Generation (each returns PNG bytes)
# ---------------------------------------------------------------------------

def generate_topic_chart(df):
    """Horizontal bar chart of top 15 topics."""
    topics = df["primary_topic"].value_counts().head(15)
    fig, ax = plt.subplots(figsize=(7, 4))
    topics.sort_values().plot.barh(ax=ax, color=ACCENT_COLOR, edgecolor="white")
    ax.set_xlabel("Post Count", fontsize=9)
    ax.set_title("Top 15 Topics in Feed", fontsize=11, fontweight="bold",
                 color=ACCENT_COLOR)
    ax.tick_params(labelsize=8)
    ax.spines["top"].set_visible(False)
    ax.spines["right"].set_visible(False)
    fig.tight_layout()
    buf = io.BytesIO()
    fig.savefig(buf, format="png", dpi=150, bbox_inches="tight")
    plt.close(fig)
    buf.seek(0)
    return buf.read()


def generate_score_boxplot(df):
    """Box plot of the 5 score components."""
    data = [df[col].dropna() for col in SCORE_COMPONENTS]
    fig, ax = plt.subplots(figsize=(7, 3.5))
    bp = ax.boxplot(data, tick_labels=COMPONENT_LABELS, patch_artist=True,
                    medianprops=dict(color="white", linewidth=1.5))
    for patch in bp["boxes"]:
        patch.set_facecolor(ACCENT_COLOR)
        patch.set_alpha(0.8)
    ax.set_ylabel("Raw Score (0-1)", fontsize=9)
    ax.set_title("Score Component Distribution", fontsize=11,
                 fontweight="bold", color=ACCENT_COLOR)
    ax.tick_params(labelsize=8)
    ax.spines["top"].set_visible(False)
    ax.spines["right"].set_visible(False)
    fig.tight_layout()
    buf = io.BytesIO()
    fig.savefig(buf, format="png", dpi=150, bbox_inches="tight")
    plt.close(fig)
    buf.seek(0)
    return buf.read()


def generate_classification_donut(df):
    """Donut chart showing keyword vs embedding classification split."""
    counts = df["classification_method"].fillna("unknown").value_counts()
    labels = [m.capitalize() for m in counts.index]
    colors = [ACCENT_COLOR, "#AED6F1", "#D5DBDB"][:len(counts)]

    fig, ax = plt.subplots(figsize=(4, 4))
    wedges, texts, autotexts = ax.pie(
        counts.values, labels=labels, autopct="%1.1f%%",
        colors=colors, startangle=90, pctdistance=0.75,
        wedgeprops=dict(width=0.4, edgecolor="white"),
    )
    for t in autotexts:
        t.set_fontsize(9)
        t.set_fontweight("bold")
    for t in texts:
        t.set_fontsize(9)
    ax.set_title("Classification Method", fontsize=11,
                 fontweight="bold", color=ACCENT_COLOR)
    fig.tight_layout()
    buf = io.BytesIO()
    fig.savefig(buf, format="png", dpi=150, bbox_inches="tight")
    plt.close(fig)
    buf.seek(0)
    return buf.read()


# ---------------------------------------------------------------------------
# Document Helpers
# ---------------------------------------------------------------------------

def set_cell_shading(cell, hex_color):
    """Apply background shading to a table cell."""
    shading_elm = cell._element.get_or_add_tcPr()
    shading = shading_elm.makeelement(qn("w:shd"), {
        qn("w:fill"): hex_color.replace("#", ""),
        qn("w:val"): "clear",
    })
    shading_elm.append(shading)


def styled_heading(doc, text, level=1):
    """Add a styled heading."""
    h = doc.add_heading(text, level=level)
    for run in h.runs:
        run.font.name = FONT
        run.font.color.rgb = ACCENT_RGB
    return h


def styled_paragraph(doc, text, bold=False, size=None):
    """Add a styled body paragraph."""
    p = doc.add_paragraph()
    run = p.add_run(text)
    run.font.name = FONT
    run.font.size = size or BODY_SIZE
    run.bold = bold
    return p


def add_styled_table(doc, headers, rows, col_widths=None):
    """Add a formatted table with accent header row."""
    table = doc.add_table(rows=1 + len(rows), cols=len(headers))
    table.alignment = WD_TABLE_ALIGNMENT.CENTER
    table.style = "Table Grid"

    # Header row
    for i, header in enumerate(headers):
        cell = table.rows[0].cells[i]
        cell.text = header
        set_cell_shading(cell, ACCENT_COLOR)
        for paragraph in cell.paragraphs:
            paragraph.alignment = WD_ALIGN_PARAGRAPH.CENTER
            for run in paragraph.runs:
                run.font.name = FONT
                run.font.size = SMALL_SIZE
                run.font.color.rgb = RGBColor(0xFF, 0xFF, 0xFF)
                run.bold = True

    # Data rows
    for r, row_data in enumerate(rows):
        for c, value in enumerate(row_data):
            cell = table.rows[r + 1].cells[c]
            cell.text = str(value)
            if r % 2 == 1:
                set_cell_shading(cell, LIGHT_ACCENT)
            for paragraph in cell.paragraphs:
                for run in paragraph.runs:
                    run.font.name = FONT
                    run.font.size = SMALL_SIZE

    return table


# ---------------------------------------------------------------------------
# Page Builders
# ---------------------------------------------------------------------------

def build_executive_summary(doc, df, epoch, stats, date_label):
    """Page 1: Executive summary with key metrics and governance state."""
    # Title
    title = doc.add_paragraph()
    title.alignment = WD_ALIGN_PARAGRAPH.CENTER
    run = title.add_run(f"Feed Quality Analysis \u2014 {date_label}")
    run.font.name = FONT
    run.font.size = TITLE_SIZE
    run.font.color.rgb = ACCENT_RGB
    run.bold = True

    # Subtitle
    epoch_id = epoch.get("id", "?")
    sub = doc.add_paragraph()
    sub.alignment = WD_ALIGN_PARAGRAPH.CENTER
    run = sub.add_run(
        f"Community Governed Feed | feed.corgi.network | Epoch {epoch_id}"
    )
    run.font.name = FONT
    run.font.size = BODY_SIZE
    run.font.color.rgb = RGBColor(0x80, 0x80, 0x80)

    # 4-stat banner
    unique_authors = df["author_did"].nunique() if "author_did" in df.columns else 0
    median_score = df["total_score"].median() if "total_score" in df.columns else 0
    embedding_pct = 0
    if "classification_method" in df.columns:
        emb_count = (df["classification_method"] == "embedding").sum()
        embedding_pct = (emb_count / len(df) * 100) if len(df) > 0 else 0

    banner_data = [
        ("Posts in Feed", str(len(df))),
        ("Unique Authors", str(unique_authors)),
        ("Median Score", f"{median_score:.3f}"),
        ("% Embedding", f"{embedding_pct:.1f}%"),
    ]
    table = doc.add_table(rows=2, cols=4)
    table.alignment = WD_TABLE_ALIGNMENT.CENTER
    for i, (label, value) in enumerate(banner_data):
        # Value row (large number)
        cell = table.rows[0].cells[i]
        cell.text = value
        set_cell_shading(cell, ACCENT_COLOR)
        for p in cell.paragraphs:
            p.alignment = WD_ALIGN_PARAGRAPH.CENTER
            for run in p.runs:
                run.font.name = FONT
                run.font.size = Pt(16)
                run.font.color.rgb = RGBColor(0xFF, 0xFF, 0xFF)
                run.bold = True
        # Label row
        cell = table.rows[1].cells[i]
        cell.text = label
        set_cell_shading(cell, LIGHT_ACCENT)
        for p in cell.paragraphs:
            p.alignment = WD_ALIGN_PARAGRAPH.CENTER
            for run in p.runs:
                run.font.name = FONT
                run.font.size = SMALL_SIZE
                run.font.color.rgb = ACCENT_RGB

    doc.add_paragraph()  # spacer

    # Summary paragraph
    total_posts = stats.get("total_posts", "?")
    last_24h = stats.get("last_24h", "?")
    scored_count = stats.get("scored_count", len(df))
    top_topic = df["primary_topic"].value_counts().index[0] if "primary_topic" in df.columns and len(df) > 0 else "unknown"
    summary = (
        f"The feed currently contains {scored_count} scored posts from "
        f"{unique_authors} unique authors across {df['primary_topic'].nunique() if 'primary_topic' in df.columns else 0} "
        f"topic categories. "
        f"The most common topic is \"{top_topic.replace('-', ' ').title()}\". "
        f"In the last 24 hours, {last_24h} new posts were ingested out of "
        f"{total_posts} total indexed posts."
    )
    styled_paragraph(doc, summary)

    # Governance weights table
    styled_heading(doc, "Epoch Weights", level=2)
    weight_names = ["Recency", "Engagement", "Bridging", "Source Diversity", "Relevance"]
    weight_keys = ["recency_weight", "engagement_weight", "bridging_weight",
                   "source_diversity_weight", "relevance_weight"]
    weight_rows = []
    for name, key in zip(weight_names, weight_keys):
        val = epoch.get(key, "?")
        weight_rows.append((name, f"{val:.2f}" if isinstance(val, (int, float)) else str(val)))
    weight_rows.append(("Vote Count", str(epoch.get("vote_count", "?"))))
    add_styled_table(doc, ["Parameter", "Value"], weight_rows)

    # Top 10 topic weights
    topic_weights = epoch.get("topic_weights", {})
    if topic_weights and isinstance(topic_weights, dict):
        doc.add_paragraph()
        styled_heading(doc, "Top 10 Topic Weights", level=2)
        sorted_tw = sorted(topic_weights.items(), key=lambda x: x[1], reverse=True)[:10]
        tw_rows = [(slug.replace("-", " ").title(), f"{w:.3f}") for slug, w in sorted_tw]
        add_styled_table(doc, ["Topic", "Weight"], tw_rows)

    doc.add_page_break()


def build_topic_page(doc, df):
    """Page 2: Topic distribution chart and stats table."""
    styled_heading(doc, "Topic Distribution")

    # Chart
    chart_bytes = generate_topic_chart(df)
    doc.add_picture(io.BytesIO(chart_bytes), width=Inches(6))
    last_paragraph = doc.paragraphs[-1]
    last_paragraph.alignment = WD_ALIGN_PARAGRAPH.CENTER

    doc.add_paragraph()

    # Stats table
    topic_stats = df.groupby("primary_topic").agg(
        count=("total_score", "size"),
        avg_relevance=("relevance_score", "mean"),
    ).sort_values("count", ascending=False).head(15)

    total = len(df)
    rows = []
    for topic, row in topic_stats.iterrows():
        pct = (row["count"] / total * 100) if total > 0 else 0
        rows.append((
            str(topic).replace("-", " ").title(),
            str(int(row["count"])),
            f"{pct:.1f}%",
            f"{row['avg_relevance']:.3f}",
        ))
    add_styled_table(doc, ["Topic", "Post Count", "% of Feed", "Avg Relevance"], rows)

    doc.add_page_break()


def build_score_page(doc, df):
    """Page 3: Score composition box plot and stats."""
    styled_heading(doc, "Score Composition")

    # Box plot chart
    chart_bytes = generate_score_boxplot(df)
    doc.add_picture(io.BytesIO(chart_bytes), width=Inches(6))
    last_paragraph = doc.paragraphs[-1]
    last_paragraph.alignment = WD_ALIGN_PARAGRAPH.CENTER

    doc.add_paragraph()

    # Stats table
    headers = ["Component", "Min", "P25", "Median", "P75", "Max", "Weight"]
    rows = []
    for col, label, wcol in zip(SCORE_COMPONENTS, COMPONENT_LABELS, WEIGHT_COLUMNS):
        series = df[col].dropna()
        weight_val = df[wcol].iloc[0] if wcol in df.columns and len(df) > 0 else "?"
        rows.append((
            label,
            f"{series.min():.3f}" if len(series) > 0 else "N/A",
            f"{series.quantile(0.25):.3f}" if len(series) > 0 else "N/A",
            f"{series.median():.3f}" if len(series) > 0 else "N/A",
            f"{series.quantile(0.75):.3f}" if len(series) > 0 else "N/A",
            f"{series.max():.3f}" if len(series) > 0 else "N/A",
            f"{weight_val:.2f}" if isinstance(weight_val, (int, float)) else str(weight_val),
        ))
    add_styled_table(doc, headers, rows)

    # Key finding
    doc.add_paragraph()
    medians = {label: df[col].median() for col, label in zip(SCORE_COMPONENTS, COMPONENT_LABELS)}
    highest = max(medians, key=medians.get)
    lowest = min(medians, key=medians.get)
    styled_paragraph(
        doc,
        f"Key finding: {highest} has the highest median raw score "
        f"({medians[highest]:.3f}), while {lowest} has the lowest "
        f"({medians[lowest]:.3f}). This suggests the feed's posts tend to "
        f"score well on {highest.lower()} but have room for improvement in "
        f"{lowest.lower()}.",
    )

    doc.add_page_break()


def build_classification_page(doc, df):
    """Page 4: Classification method split + author diversity."""
    styled_heading(doc, "Classification & Diversity")

    # Donut chart
    chart_bytes = generate_classification_donut(df)
    doc.add_picture(io.BytesIO(chart_bytes), width=Inches(3.5))
    last_paragraph = doc.paragraphs[-1]
    last_paragraph.alignment = WD_ALIGN_PARAGRAPH.CENTER

    doc.add_paragraph()

    # Classification stats
    method_counts = df["classification_method"].fillna("unknown").value_counts()
    method_rows = [(m.capitalize(), str(c), f"{c/len(df)*100:.1f}%")
                   for m, c in method_counts.items()]
    add_styled_table(doc, ["Method", "Count", "% of Feed"], method_rows)

    doc.add_paragraph()

    # Author diversity
    styled_heading(doc, "Author Diversity", level=2)
    author_counts = df["author_did"].value_counts()
    styled_paragraph(
        doc,
        f"Total unique authors: {author_counts.nunique()}. "
        f"Average posts per author: {author_counts.mean():.1f}. "
        f"Max posts by single author: {author_counts.max()}.",
    )

    # Flag authors with 5+ posts
    heavy_posters = author_counts[author_counts >= 5]
    if len(heavy_posters) > 0:
        doc.add_paragraph()
        rows = [(did[:20] + "...", str(count)) for did, count in heavy_posters.head(10).items()]
        add_styled_table(doc, ["Author DID (truncated)", "Post Count"], rows)

    # URL dedup stats
    if "uri" in df.columns:
        doc.add_paragraph()
        styled_heading(doc, "URL Deduplication", level=2)
        total = len(df)
        unique_uris = df["uri"].nunique()
        styled_paragraph(
            doc,
            f"All {unique_uris} post URIs are unique (no duplicates detected "
            f"out of {total} scored posts)." if unique_uris == total else
            f"Warning: {total - unique_uris} duplicate URIs detected.",
        )

    doc.add_page_break()


def build_engagement_page(doc, df):
    """Page 5: Engagement profile — top vs bottom comparison."""
    styled_heading(doc, "Engagement Profile")

    if len(df) < 200:
        styled_paragraph(doc, f"Insufficient data for top/bottom comparison "
                         f"(need 200+ posts, have {len(df)}).")
        doc.add_page_break()
        return

    top100 = df.head(100)
    bottom100 = df.tail(100)

    metrics = ["likes", "reposts", "replies"]
    rows = []
    for metric in metrics:
        if metric not in df.columns:
            continue
        top_med = top100[metric].median()
        bot_med = bottom100[metric].median()
        ratio = f"{top_med / bot_med:.1f}x" if bot_med > 0 else "inf"
        rows.append((
            metric.capitalize(),
            f"{top_med:.1f}",
            f"{bot_med:.1f}",
            ratio,
        ))

    add_styled_table(
        doc,
        ["Metric", "Top 100 Median", "Bottom 100 Median", "Ratio"],
        rows,
    )

    doc.add_paragraph()

    # Key finding
    if "likes" in df.columns:
        top_likes = top100["likes"].median()
        bot_likes = bottom100["likes"].median()
        styled_paragraph(
            doc,
            f"Key finding: The top-scoring 100 posts have a median of "
            f"{top_likes:.0f} likes compared to {bot_likes:.0f} for the "
            f"bottom 100, suggesting the scoring algorithm is effectively "
            f"surfacing content that resonates with the community.",
        )

    doc.add_page_break()


def build_sample_posts_page(doc, df):
    """Page 6: Top 10 and bottom 10 sample posts."""
    styled_heading(doc, "Sample Posts")

    def post_table(doc, subset, title):
        styled_heading(doc, title, level=2)
        rows = []
        for _, row in subset.iterrows():
            text = str(row.get("text", ""))[:120]
            if len(str(row.get("text", ""))) > 120:
                text += "..."
            topic = str(row.get("primary_topic", "?")).replace("-", " ").title()
            score = f"{row.get('total_score', 0):.3f}"
            likes = str(int(row.get("likes", 0)))
            method = str(row.get("classification_method", "?"))
            rows.append((text, topic, score, likes, method))
        add_styled_table(
            doc,
            ["Text Preview", "Topic", "Score", "Likes", "Method"],
            rows,
        )

    post_table(doc, df.head(10), "Top 10 Posts")
    doc.add_paragraph()
    post_table(doc, df.tail(10), "Bottom 10 Posts")


# ---------------------------------------------------------------------------
# Dry Run
# ---------------------------------------------------------------------------

def print_dry_run(df, epoch, stats):
    """Print data summary to stdout without generating docx."""
    print("\n" + "=" * 60)
    print("DRY RUN \u2014 Data Summary")
    print("=" * 60)

    print(f"\nPosts loaded: {len(df)}")
    print(f"Unique authors: {df['author_did'].nunique()}")
    print(f"Median total score: {df['total_score'].median():.4f}")

    if "classification_method" in df.columns:
        print(f"\nClassification methods:")
        for method, count in df["classification_method"].fillna("unknown").value_counts().items():
            print(f"  {method}: {count} ({count/len(df)*100:.1f}%)")

    if "primary_topic" in df.columns:
        print(f"\nTop 10 topics:")
        for topic, count in df["primary_topic"].value_counts().head(10).items():
            print(f"  {topic}: {count}")

    print(f"\nScore components (medians):")
    for col, label in zip(SCORE_COMPONENTS, COMPONENT_LABELS):
        if col in df.columns:
            print(f"  {label}: {df[col].median():.4f}")

    if "likes" in df.columns:
        print(f"\nEngagement (medians): likes={df['likes'].median():.0f}, "
              f"reposts={df['reposts'].median():.0f}, "
              f"replies={df['replies'].median():.0f}")

    print(f"\nEpoch: {epoch.get('id', '?')} (status: {epoch.get('status', '?')}, "
          f"votes: {epoch.get('vote_count', '?')})")
    print(f"System stats: {stats.get('total_posts', '?')} total posts, "
          f"{stats.get('last_24h', '?')} last 24h, "
          f"{stats.get('scored_count', '?')} scored")
    print("\n" + "=" * 60)
    print("Dry run complete. No docx generated.")


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(
        description="Generate feed quality analysis report (.docx)",
    )
    parser.add_argument("--csv", help="Read from local CSV instead of VPS")
    parser.add_argument("--epoch-json", help="Epoch data as JSON file (for offline mode)")
    parser.add_argument("--output", help="Output file path")
    parser.add_argument("--date", help="Date label for report title")
    parser.add_argument("--dry-run", action="store_true",
                        help="Print data summary without generating docx")
    args = parser.parse_args()

    # Date label
    date_label = args.date or datetime.now().strftime("%B %d, %Y")

    # Default output path
    date_slug = datetime.now().strftime("%b%d").lower()
    default_output = f"reports/sprint-data-analysis-{date_slug}.docx"
    output_path = args.output or default_output

    # Data extraction
    if args.csv:
        print(f"Loading from CSV: {args.csv}")
        df, epoch, stats = load_from_csv(args.csv, args.epoch_json)
    else:
        df, epoch, stats = fetch_from_vps()

    if len(df) == 0:
        print("No data returned. Check VPS connectivity and epoch state.",
              file=sys.stderr)
        sys.exit(1)

    # Derived columns
    df["primary_topic"] = df["topics"].apply(extract_primary_topic)
    df["topic_confidence"] = df["topics"].apply(extract_topic_confidence)

    # Dry run
    if args.dry_run:
        print_dry_run(df, epoch, stats)
        return

    # Build document
    print(f"Generating report: {output_path}")
    doc = Document()

    # Set default font
    style = doc.styles["Normal"]
    style.font.name = FONT
    style.font.size = BODY_SIZE

    build_executive_summary(doc, df, epoch, stats, date_label)
    build_topic_page(doc, df)
    build_score_page(doc, df)
    build_classification_page(doc, df)
    build_engagement_page(doc, df)
    build_sample_posts_page(doc, df)

    # Ensure output directory exists
    os.makedirs(os.path.dirname(output_path) or ".", exist_ok=True)
    doc.save(output_path)

    file_size = os.path.getsize(output_path) / 1024
    print(f"Report saved: {output_path} ({file_size:.0f} KB)")


if __name__ == "__main__":
    main()
