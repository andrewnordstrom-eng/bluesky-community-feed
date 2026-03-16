#!/usr/bin/env python3
"""
Feed Quality Analysis PDF Report Generator

Generates a print-friendly PDF report from live feed data using:
1) SQL data pulls from VPS (or local CSV),
2) structured HTML + CSS paged layout,
3) Playwright Chromium PDF rendering.

This approach avoids Word layout unpredictability and provides deterministic
pagination for future reports with varying data sizes.

Usage:
    python3 scripts/generate-report-pdf.py
    python3 scripts/generate-report-pdf.py --date "March 15, 2026"
    python3 scripts/generate-report-pdf.py --output reports/my-report.pdf
    python3 scripts/generate-report-pdf.py --csv data.csv --epoch-json epoch.json
    python3 scripts/generate-report-pdf.py --dry-run
"""

from __future__ import annotations

import argparse
import html
import io
import json
import os
import subprocess
import sys
from datetime import datetime
from typing import Any

import pandas as pd

# Keep matplotlib cache writable in restricted environments.
os.environ.setdefault("MPLCONFIGDIR", "/tmp")
import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt


# ---------------------------------------------------------------------------
# Design Tokens (aligned with web voting UI, light-mode for print)
# ---------------------------------------------------------------------------

ACCENT = "#1083FE"
ACCENT_DARK = "#0A74E8"
BORDER = "#D7E6FB"
SOFT_BG = "#F8FBFF"
CALLOUT_BG = "#EAF4FF"
TEXT = "#1F2937"
TEXT_MUTED = "#5F6B7A"
CHART_GRID = "#E8EEF8"

FONT_STACK = (
    "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, "
    "Helvetica, Arial, sans-serif"
)

SCORE_COMPONENTS = [
    "recency_score",
    "engagement_score",
    "bridging_score",
    "source_diversity_score",
    "relevance_score",
]
COMPONENT_LABELS = [
    "Recency",
    "Engagement",
    "Bridging",
    "Source Diversity",
    "Relevance",
]
WEIGHT_COLUMNS = [
    "recency_weight",
    "engagement_weight",
    "bridging_weight",
    "source_diversity_weight",
    "relevance_weight",
]


# ---------------------------------------------------------------------------
# SQL
# ---------------------------------------------------------------------------

MARKER = "---REPORT-MARKER---"

POSTS_SQL = """
COPY (
  SELECT
    p.uri,
    LEFT(p.text, 280) as text,
    p.author_did,
    p.embed_url,
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
# Data Helpers
# ---------------------------------------------------------------------------


def format_int(value: Any) -> str:
    """Format integer-like values with thousands separators."""
    try:
        return f"{int(value):,}"
    except (TypeError, ValueError):
        return str(value)


def format_float(value: Any, precision: int = 3) -> str:
    """Format float safely with configurable precision."""
    try:
        return f"{float(value):.{precision}f}"
    except (TypeError, ValueError):
        return "N/A"


def safe_text(value: Any) -> str:
    """HTML-escape arbitrary text values."""
    return html.escape(str(value) if value is not None else "")


def parse_topic_vector(tv_str: Any) -> dict[str, float]:
    """Parse topic_vector JSON string into a dict."""
    if not tv_str or pd.isna(tv_str) or tv_str in ("", "null", "None"):
        return {}
    try:
        return json.loads(str(tv_str).replace("'", '"'))
    except (json.JSONDecodeError, TypeError, ValueError):
        return {}


def extract_primary_topic(tv_str: Any) -> str:
    """Get top-confidence topic slug from topic vector."""
    tv = parse_topic_vector(tv_str)
    if not tv:
        return "uncategorized"
    return max(tv, key=tv.get)


def normalize_embed_urls(series: pd.Series) -> pd.Series:
    """Normalize embed URLs and drop empty/null placeholders."""
    urls = series.dropna().astype(str).str.strip()
    return urls[~urls.isin(["", "null", "None"])]


def fetch_from_vps() -> tuple[pd.DataFrame, dict[str, Any], dict[str, Any]]:
    """Pull posts + epoch + stats from VPS in a single SSH call."""
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
        capture_output=True,
        text=True,
        timeout=90,
    )
    if result.returncode != 0:
        print(f"SSH failed (exit {result.returncode}):", file=sys.stderr)
        print(result.stderr, file=sys.stderr)
        sys.exit(1)

    parts = result.stdout.split(MARKER)
    if len(parts) < 3:
        print(f"Expected 3 data sections, got {len(parts)}", file=sys.stderr)
        print("Raw output preview:", result.stdout[:800], file=sys.stderr)
        sys.exit(1)

    posts_csv = parts[0].strip()
    epoch_json_str = parts[1].strip()
    stats_json_str = parts[2].strip()

    df = pd.read_csv(io.StringIO(posts_csv))
    epoch = json.loads(epoch_json_str) if epoch_json_str else {}
    stats = json.loads(stats_json_str) if stats_json_str else {}

    if "topic_weights" in epoch and isinstance(epoch["topic_weights"], str):
        try:
            epoch["topic_weights"] = json.loads(epoch["topic_weights"])
        except (json.JSONDecodeError, TypeError):
            epoch["topic_weights"] = {}

    print(
        f"  Posts: {len(df)}, Epoch: {epoch.get('id', '?')}, "
        f"Total indexed: {stats.get('total_posts', '?')}"
    )
    return df, epoch, stats


def load_from_csv(
    csv_path: str, epoch_json_path: str | None = None
) -> tuple[pd.DataFrame, dict[str, Any], dict[str, Any]]:
    """Load report data from local files for offline generation."""
    df = pd.read_csv(csv_path)
    epoch: dict[str, Any] = {}
    stats: dict[str, Any] = {
        "total_posts": len(df),
        "last_24h": 0,
        "scored_count": len(df),
    }
    if epoch_json_path and os.path.exists(epoch_json_path):
        with open(epoch_json_path, encoding="utf-8") as f:
            epoch = json.load(f)
    return df, epoch, stats


# ---------------------------------------------------------------------------
# Chart Rendering
# ---------------------------------------------------------------------------


def fig_to_data_uri(fig: plt.Figure) -> str:
    """Convert matplotlib figure to base64 PNG data URI."""
    buf = io.BytesIO()
    fig.savefig(buf, format="png", dpi=150, bbox_inches="tight")
    plt.close(fig)
    buf.seek(0)
    data = buf.read()
    import base64

    return f"data:image/png;base64,{base64.b64encode(data).decode('ascii')}"


def chart_topics(df: pd.DataFrame) -> str:
    """Top 15 topic horizontal bar chart."""
    counts = df["primary_topic"].value_counts().head(15).sort_values()
    fig, ax = plt.subplots(figsize=(8.0, 4.0))
    fig.patch.set_facecolor("white")
    counts.plot.barh(ax=ax, color=ACCENT, edgecolor="white")
    ax.set_xlabel("Post Count", fontsize=9, color=TEXT_MUTED)
    ax.set_title("Top 15 Topics in Feed", fontsize=11, fontweight="bold", color=ACCENT_DARK)
    ax.tick_params(labelsize=8, colors=TEXT_MUTED)
    ax.grid(axis="x", color=CHART_GRID, linewidth=0.8)
    ax.set_axisbelow(True)
    ax.spines["top"].set_visible(False)
    ax.spines["right"].set_visible(False)
    ax.spines["left"].set_color(BORDER)
    ax.spines["bottom"].set_color(BORDER)
    fig.tight_layout()
    return fig_to_data_uri(fig)


def chart_score_boxplot(df: pd.DataFrame) -> str:
    """Score component distribution boxplot."""
    data = [df[col].dropna() for col in SCORE_COMPONENTS]
    fig, ax = plt.subplots(figsize=(8.0, 3.8))
    fig.patch.set_facecolor("white")
    bp = ax.boxplot(
        data,
        tick_labels=COMPONENT_LABELS,
        patch_artist=True,
        medianprops=dict(color="white", linewidth=1.5),
    )
    for patch in bp["boxes"]:
        patch.set_facecolor(ACCENT)
        patch.set_alpha(0.85)
    ax.set_ylabel("Raw Score (0-1)", fontsize=9, color=TEXT_MUTED)
    ax.set_title(
        "Score Component Distribution", fontsize=11, fontweight="bold", color=ACCENT_DARK
    )
    ax.tick_params(labelsize=8, colors=TEXT_MUTED)
    ax.grid(axis="y", color=CHART_GRID, linewidth=0.8)
    ax.set_axisbelow(True)
    ax.spines["top"].set_visible(False)
    ax.spines["right"].set_visible(False)
    ax.spines["left"].set_color(BORDER)
    ax.spines["bottom"].set_color(BORDER)
    fig.tight_layout()
    return fig_to_data_uri(fig)


def chart_classification(df: pd.DataFrame) -> str:
    """Classification-method donut chart."""
    counts = df["classification_method"].fillna("unknown").value_counts()
    labels = [m.capitalize() for m in counts.index]
    colors = [ACCENT, "#7CB9FF", "#C8DCFA"][: len(counts)]
    fig, ax = plt.subplots(figsize=(4.2, 4.2))
    fig.patch.set_facecolor("white")
    wedges, texts, autotexts = ax.pie(
        counts.values,
        labels=labels,
        autopct="%1.1f%%",
        colors=colors,
        startangle=90,
        pctdistance=0.75,
        wedgeprops=dict(width=0.4, edgecolor="white"),
    )
    for t in autotexts:
        t.set_fontsize(9)
        t.set_fontweight("bold")
    for t in texts:
        t.set_fontsize(9)
    ax.set_title("Classification Method Share", fontsize=11, fontweight="bold", color=ACCENT_DARK)
    fig.tight_layout()
    return fig_to_data_uri(fig)


# ---------------------------------------------------------------------------
# HTML Builders
# ---------------------------------------------------------------------------


def table_html(
    headers: list[str],
    rows: list[list[str]],
    numeric_cols: set[int] | None = None,
    compact: bool = False,
) -> str:
    """Render standard report table."""
    numeric_cols = numeric_cols or set()
    cls = "report-table compact" if compact else "report-table"
    head = "".join(f"<th>{safe_text(h)}</th>" for h in headers)
    body_rows = []
    for row in rows:
        cells = []
        for i, cell in enumerate(row):
            align_class = "num" if i in numeric_cols else "txt"
            cells.append(f'<td class="{align_class}">{safe_text(cell)}</td>')
        body_rows.append(f"<tr>{''.join(cells)}</tr>")
    return f"""
    <table class="{cls}">
      <thead><tr>{head}</tr></thead>
      <tbody>{''.join(body_rows)}</tbody>
    </table>
    """


def callout_html(text: str, label: str = "Key takeaway") -> str:
    """Render callout card."""
    return (
        f'<div class="callout"><strong>{safe_text(label)}:</strong> {safe_text(text)}</div>'
    )


def section_html(title: str, body: str, section_class: str = "") -> str:
    """Render content section with optional class."""
    cls = f'section {section_class}'.strip()
    return f'<section class="{cls}"><h2>{safe_text(title)}</h2>{body}</section>'


def build_report_html(
    df: pd.DataFrame, epoch: dict[str, Any], stats: dict[str, Any], date_label: str
) -> str:
    """Build full HTML report with robust print-oriented layout."""
    epoch_id = epoch.get("id", "?")
    unique_authors = int(df["author_did"].dropna().nunique()) if "author_did" in df else 0
    topic_count = int(df["primary_topic"].nunique()) if "primary_topic" in df else 0
    scored_count = stats.get("scored_count", len(df))
    total_posts = stats.get("total_posts", "?")
    median_score = float(df["total_score"].median()) if "total_score" in df else 0.0

    method_counts = df["classification_method"].fillna("unknown").value_counts()
    embedding_pct = (
        float((df["classification_method"] == "embedding").sum()) / len(df) * 100
        if "classification_method" in df and len(df) > 0
        else 0.0
    )
    top_topic = (
        str(df["primary_topic"].value_counts().index[0])
        if "primary_topic" in df and len(df) > 0
        else "unknown"
    )

    # Author diversity
    author_counts = df["author_did"].dropna().value_counts()
    avg_posts_per_author = float(author_counts.mean()) if len(author_counts) > 0 else 0.0
    max_posts_single_author = int(author_counts.max()) if len(author_counts) > 0 else 0
    heavy_posters = author_counts[author_counts >= 5].head(10)

    # URL dedup
    normalized_urls = normalize_embed_urls(df["embed_url"]) if "embed_url" in df else pd.Series(dtype=str)
    url_counts = normalized_urls.value_counts()
    duplicate_urls = url_counts[url_counts > 1]
    duplicate_posts = int(duplicate_urls.sum()) if len(duplicate_urls) > 0 else 0
    max_duplicates = int(duplicate_urls.max()) if len(duplicate_urls) > 0 else 0

    # Topic table
    topic_stats = (
        df.groupby("primary_topic")
        .agg(count=("total_score", "size"), avg_relevance=("relevance_score", "mean"))
        .sort_values("count", ascending=False)
        .head(10)
    )
    topic_rows: list[list[str]] = []
    for topic, row in topic_stats.iterrows():
        pct = (row["count"] / len(df) * 100) if len(df) > 0 else 0
        topic_rows.append(
            [
                str(topic).replace("-", " ").title(),
                format_int(row["count"]),
                f"{pct:.1f}%",
                f"{row['avg_relevance']:.3f}",
            ]
        )

    # Score table
    score_rows: list[list[str]] = []
    medians: dict[str, float] = {}
    for col, label, wcol in zip(SCORE_COMPONENTS, COMPONENT_LABELS, WEIGHT_COLUMNS):
        series = df[col].dropna()
        med = float(series.median()) if len(series) > 0 else 0.0
        medians[label] = med
        weight_val = df[wcol].iloc[0] if wcol in df.columns and len(df) > 0 else "N/A"
        score_rows.append(
            [
                label,
                format_float(series.min()),
                format_float(series.quantile(0.25)),
                format_float(series.median()),
                format_float(series.quantile(0.75)),
                format_float(series.max()),
                format_float(weight_val, 2),
            ]
        )
    highest = max(medians, key=medians.get) if medians else "N/A"
    lowest = min(medians, key=medians.get) if medians else "N/A"

    # Classification rows
    method_rows = [
        [str(method).capitalize(), format_int(count), f"{count / len(df) * 100:.1f}%"]
        for method, count in method_counts.items()
    ]

    # Engagement
    top100 = df.head(100) if len(df) >= 100 else df
    bottom100 = df.tail(100) if len(df) >= 100 else df
    engagement_rows: list[list[str]] = []
    for metric in ["likes", "reposts", "replies"]:
        if metric not in df.columns:
            continue
        top_med = float(top100[metric].median())
        bot_med = float(bottom100[metric].median())
        ratio = f"{top_med / bot_med:.1f}x" if bot_med > 0 else "inf"
        engagement_rows.append(
            [metric.capitalize(), f"{top_med:.1f}", f"{bot_med:.1f}", ratio]
        )

    # Topic weights
    topic_weights = epoch.get("topic_weights", {})
    topic_weight_rows: list[list[str]] = []
    if topic_weights and isinstance(topic_weights, dict):
        sorted_tw = sorted(topic_weights.items(), key=lambda x: x[1], reverse=True)[:10]
        topic_weight_rows = [
            [slug.replace("-", " ").title(), f"{weight:.3f}"] for slug, weight in sorted_tw
        ]

    # Sample posts tables
    def sample_rows(subset: pd.DataFrame) -> list[list[str]]:
        rows: list[list[str]] = []
        for _, row in subset.iterrows():
            text = str(row.get("text", "")).strip()
            if len(text) > 90:
                text = text[:90] + "..."
            topic = str(row.get("primary_topic", "unknown")).replace("-", " ").title()
            rows.append(
                [
                    text,
                    topic,
                    format_float(row.get("total_score", 0), 3),
                    format_int(int(row.get("likes", 0))),
                    str(row.get("classification_method", "unknown")).capitalize(),
                ]
            )
        return rows

    top_sample_rows = sample_rows(df.head(10))
    bottom_sample_rows = sample_rows(df.tail(10))

    # Charts
    topic_chart = chart_topics(df)
    score_chart = chart_score_boxplot(df)
    method_chart = chart_classification(df)

    summary_sentence = (
        f"The top 1000 feed posts span {format_int(unique_authors)} unique authors across "
        f"{format_int(topic_count)} topics. The database contains {format_int(total_posts)} "
        f"indexed posts with {format_int(scored_count)} scored in the current epoch."
    )

    top3_pct = (
        df["primary_topic"].value_counts().head(3).sum() / len(df) * 100
        if len(df) > 0 and "primary_topic" in df.columns
        else 0.0
    )

    methodology = f"""
    <div class="method-grid">
      <div class="method-card">
        <h3>Scope</h3>
        <p>Top 1,000 scored posts in active epoch <strong>{safe_text(epoch_id)}</strong>.</p>
      </div>
      <div class="method-card">
        <h3>Data Source</h3>
        <p>PostgreSQL snapshots pulled at report generation time from feed.corgi.network.</p>
      </div>
      <div class="method-card">
        <h3>Scoring Window</h3>
        <p>All rows tagged to current active epoch; soft-deleted posts excluded.</p>
      </div>
      <div class="method-card">
        <h3>Generated</h3>
        <p>{safe_text(date_label)} (live data).</p>
      </div>
    </div>
    """

    executive_section = section_html(
        "Executive Summary",
        f"""
        <div class="metric-grid">
          <div class="metric-card"><div class="metric-value">{format_int(len(df))}</div><div class="metric-label">Posts in Scope</div></div>
          <div class="metric-card"><div class="metric-value">{format_int(unique_authors)}</div><div class="metric-label">Unique Authors</div></div>
          <div class="metric-card"><div class="metric-value">{median_score:.3f}</div><div class="metric-label">Median Score</div></div>
          <div class="metric-card"><div class="metric-value">{embedding_pct:.1f}%</div><div class="metric-label">Embedding Classified</div></div>
        </div>
        <p class="lead">{safe_text(summary_sentence)}</p>
        {callout_html(f"Most represented topic is {top_topic.replace('-', ' ').title()}.")}
        <h3>Epoch Weights</h3>
        {table_html(
            ["Parameter", "Value"],
            [
                ["Recency", format_float(epoch.get("recency_weight", "N/A"), 2)],
                ["Engagement", format_float(epoch.get("engagement_weight", "N/A"), 2)],
                ["Bridging", format_float(epoch.get("bridging_weight", "N/A"), 2)],
                ["Source Diversity", format_float(epoch.get("source_diversity_weight", "N/A"), 2)],
                ["Relevance", format_float(epoch.get("relevance_weight", "N/A"), 2)],
                ["Vote Count", format_int(epoch.get("vote_count", "N/A"))],
            ],
            numeric_cols={1},
            compact=True,
        )}
        <h3>Methodology</h3>
        {methodology}
        """,
    )

    topic_weight_section = ""
    if topic_weight_rows:
        topic_weight_section = section_html(
            "Top 10 Topic Weights",
            table_html(["Topic", "Weight"], topic_weight_rows, numeric_cols={1}, compact=True),
            "",
        )

    topic_section = section_html(
        "Topic Distribution",
        f"""
        <div class="chart-wrap">
          <img src="{topic_chart}" alt="Top topics chart" />
          <p class="caption">Figure 1. Top topics among the top 1,000 scored posts.</p>
        </div>
        {table_html(["Topic", "Post Count", "% of Feed", "Avg Relevance"], topic_rows, numeric_cols={1,2,3})}
        {callout_html(f"The top 3 topics account for {top3_pct:.1f}% of the analyzed feed sample.")}
        """,
        "page-break",
    )

    score_section = section_html(
        "Score Composition",
        f"""
        <div class="chart-wrap">
          <img src="{score_chart}" alt="Score component distribution chart" />
          <p class="caption">Figure 2. Distribution of raw score components before weighting.</p>
        </div>
        {table_html(["Component", "Min", "P25", "Median", "P75", "Max", "Weight"], score_rows, numeric_cols={1,2,3,4,5,6})}
        {callout_html(f"{highest} has the highest median raw score while {lowest} is lowest.")}
        """,
        "page-break",
    )

    class_section = section_html(
        "Classification Methods",
        f"""
        <div class="split-grid">
          <div class="chart-wrap small-chart">
            <img src="{method_chart}" alt="Classification method chart" />
            <p class="caption">Figure 3. Classification method share in analyzed sample.</p>
          </div>
          <div>
            {table_html(["Method", "Count", "% of Feed"], method_rows, numeric_cols={1,2}, compact=True)}
            {callout_html(f"{str(method_counts.index[0]).capitalize()} is dominant at {method_counts.iloc[0] / len(df) * 100:.1f}%." if len(method_counts) > 0 else "No classification data available.")}
          </div>
        </div>
        """,
        "page-break",
    )

    heavy_rows = [[f"{did[:22]}...", format_int(count)] for did, count in heavy_posters.items()]
    diversity_section = section_html(
        "Author Diversity and URL Deduplication",
        f"""
        <p>Total unique authors: <strong>{format_int(unique_authors)}</strong>. Average posts per author: <strong>{avg_posts_per_author:.1f}</strong>. Max posts by single author: <strong>{format_int(max_posts_single_author)}</strong>.</p>
        {"<h3>Authors with 5+ posts</h3>" + table_html(["Author DID (truncated)", "Post Count"], heavy_rows, numeric_cols={1}, compact=True) if heavy_rows else ""}
        <h3>URL Deduplication</h3>
        <p>Posts with an embed URL: <strong>{format_int(len(normalized_urls))}</strong>. Posts sharing a duplicated embed URL: <strong>{format_int(duplicate_posts)}</strong> across <strong>{format_int(len(duplicate_urls))}</strong> URLs. Max duplicates for a single URL: <strong>{format_int(max_duplicates)}</strong>.</p>
        {callout_html(f"Most repeated external URL appears {format_int(max_duplicates)} times in this 1,000-post scope." if max_duplicates > 0 else "No duplicated embed URLs detected in the analyzed scope.")}
        """,
        "",
    )

    engagement_section = section_html(
        "Engagement Profile",
        f"""
        {table_html(["Metric", "Top 100 Median", "Bottom 100 Median", "Ratio"], engagement_rows, numeric_cols={1,2,3}, compact=True)}
        {callout_html(f"Top-ranked posts receive approximately {(float(top100['likes'].median()) / float(bottom100['likes'].median())):.1f}x median likes versus bottom-ranked posts." if 'likes' in df.columns and float(bottom100['likes'].median()) > 0 else "Engagement ratio calculation unavailable due zero/insufficient bottom median.")}
        """,
        "",
    )

    appendix_top = section_html(
        "Appendix A: Top 10 Sample Posts",
        table_html(["Text Preview", "Topic", "Score", "Likes", "Method"], top_sample_rows, numeric_cols={2,3}, compact=True),
        "page-break",
    )
    appendix_bottom = section_html(
        "Appendix B: Bottom 10 Sample Posts",
        table_html(["Text Preview", "Topic", "Score", "Likes", "Method"], bottom_sample_rows, numeric_cols={2,3}, compact=True),
        "page-break",
    )

    css = f"""
    @page {{
      size: Letter;
      margin: 0.58in 0.55in 0.70in 0.55in;
    }}

    * {{
      box-sizing: border-box;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }}

    html, body {{
      margin: 0;
      padding: 0;
      color: {TEXT};
      font-family: {FONT_STACK};
      font-size: 11px;
      line-height: 1.35;
      background: #fff;
    }}

    .report {{
      width: 100%;
    }}

    .cover {{
      min-height: 8.3in;
      display: flex;
      flex-direction: column;
      justify-content: center;
      align-items: center;
      text-align: center;
      border: 1px solid {BORDER};
      border-radius: 12px;
      padding: 24px;
      background: linear-gradient(180deg, #ffffff 0%, {SOFT_BG} 100%);
    }}

    .cover h1 {{
      margin: 0 0 8px 0;
      color: {ACCENT_DARK};
      font-size: 30px;
      line-height: 1.15;
      letter-spacing: 0.2px;
    }}

    .cover .sub {{
      color: {TEXT_MUTED};
      font-size: 13px;
      margin-top: 4px;
    }}

    .section {{
      margin-top: 6px;
    }}

    .page-break {{
      break-before: page;
      page-break-before: always;
    }}

    .cover-break {{
      break-after: page;
      page-break-after: always;
    }}

    h2 {{
      margin: 0 0 8px 0;
      color: {ACCENT_DARK};
      font-size: 18px;
      line-height: 1.2;
    }}

    h3 {{
      margin: 10px 0 6px 0;
      color: {ACCENT};
      font-size: 13px;
      line-height: 1.2;
    }}

    p {{
      margin: 4px 0 8px 0;
    }}

    .lead {{
      margin-top: 10px;
      font-size: 12px;
      line-height: 1.4;
    }}

    .metric-grid {{
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 8px;
      margin-bottom: 12px;
    }}

    .metric-card {{
      border: 1px solid {BORDER};
      border-radius: 10px;
      overflow: hidden;
      background: #fff;
      break-inside: avoid;
      page-break-inside: avoid;
    }}

    .metric-value {{
      background: {ACCENT};
      color: white;
      font-weight: 700;
      font-size: 18px;
      text-align: center;
      padding: 8px 6px;
      line-height: 1.1;
    }}

    .metric-label {{
      color: {ACCENT_DARK};
      background: {CALLOUT_BG};
      font-size: 10px;
      text-align: center;
      padding: 6px;
      font-weight: 600;
    }}

    .callout {{
      border: 1px solid #bfd9ff;
      background: {CALLOUT_BG};
      border-radius: 8px;
      padding: 8px 10px;
      margin: 8px 0 10px 0;
      break-inside: avoid;
      page-break-inside: avoid;
    }}

    .method-grid {{
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 8px;
      margin-top: 6px;
    }}

    .method-card {{
      border: 1px solid {BORDER};
      border-radius: 8px;
      background: {SOFT_BG};
      padding: 8px;
      break-inside: avoid;
      page-break-inside: avoid;
    }}

    .method-card h3 {{
      margin: 0 0 4px 0;
      font-size: 11px;
    }}

    .method-card p {{
      margin: 0;
      color: {TEXT_MUTED};
      font-size: 10px;
    }}

    .split-grid {{
      display: grid;
      grid-template-columns: 40% 60%;
      gap: 12px;
      align-items: start;
    }}

    .chart-wrap {{
      break-inside: avoid;
      page-break-inside: avoid;
      margin-bottom: 8px;
    }}

    .chart-wrap img {{
      width: 100%;
      max-width: 100%;
      border: 1px solid {BORDER};
      border-radius: 8px;
      background: #fff;
      display: block;
    }}

    .small-chart img {{
      max-width: 96%;
      margin: 0 auto;
    }}

    .caption {{
      margin: 4px 0 0 0;
      text-align: center;
      font-size: 9px;
      color: {TEXT_MUTED};
    }}

    .report-table {{
      width: 100%;
      border-collapse: collapse;
      border: 1px solid {BORDER};
      margin: 6px 0 10px 0;
      font-size: 10px;
      table-layout: fixed;
    }}

    .report-table.compact {{
      font-size: 9.5px;
    }}

    .report-table thead {{
      display: table-header-group;
    }}

    .report-table th {{
      background: {ACCENT};
      color: #fff;
      border: 1px solid {BORDER};
      padding: 5px 6px;
      text-align: center;
      font-weight: 700;
      line-height: 1.2;
    }}

    .report-table td {{
      border: 1px solid {BORDER};
      padding: 4px 6px;
      vertical-align: top;
      line-height: 1.25;
      word-break: break-word;
      overflow-wrap: anywhere;
    }}

    .report-table tbody tr:nth-child(even) {{
      background: {SOFT_BG};
    }}

    .report-table td.num {{
      text-align: right;
      white-space: nowrap;
    }}

    .report-table td.txt {{
      text-align: left;
    }}

    .report-table tr {{
      break-inside: avoid;
      page-break-inside: avoid;
    }}
    """

    return f"""
    <!DOCTYPE html>
    <html lang="en">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>Feed Quality Analysis - {safe_text(date_label)}</title>
        <style>{css}</style>
      </head>
      <body>
        <div class="report">
          <section class="cover cover-break">
            <h1>Feed Quality Analysis</h1>
            <div class="sub">{safe_text(date_label)}</div>
            <div class="sub">Community-governed feed | feed.corgi.network | Epoch {safe_text(epoch_id)}</div>
          </section>
          {executive_section}
          {topic_weight_section}
          {topic_section}
          {score_section}
          {class_section}
          {diversity_section}
          {engagement_section}
          {appendix_top}
          {appendix_bottom}
        </div>
      </body>
    </html>
    """


def render_pdf_with_playwright(
    html_content: str, output_pdf: str, date_label: str, epoch_id: Any
) -> None:
    """Render HTML to PDF with Playwright Chromium."""
    try:
        from playwright.sync_api import sync_playwright
    except Exception as exc:
        print("Playwright import failed. Install with: pip install playwright", file=sys.stderr)
        raise exc

    header_template = (
        "<div style=\"width:100%;font-size:8px;color:#5F6B7A;padding:0 12px;"
        "font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;\">"
        "Community-Governed Bluesky Feed - Quality Report</div>"
    )
    footer_template = (
        "<div style=\"width:100%;font-size:8px;color:#5F6B7A;padding:0 12px;"
        "display:flex;justify-content:center;"
        "font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;\">"
        f"Epoch {html.escape(str(epoch_id))} | {html.escape(str(date_label))} | "
        "Page <span class=\"pageNumber\"></span> of <span class=\"totalPages\"></span> "
        "</div>"
    )

    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page()
        page.set_content(html_content, wait_until="networkidle")
        page.pdf(
            path=output_pdf,
            format="Letter",
            print_background=True,
            display_header_footer=True,
            header_template=header_template,
            footer_template=footer_template,
            margin={
                "top": "0.75in",
                "bottom": "0.70in",
                "left": "0.55in",
                "right": "0.55in",
            },
            prefer_css_page_size=False,
        )
        browser.close()


def print_dry_run(df: pd.DataFrame, epoch: dict[str, Any], stats: dict[str, Any]) -> None:
    """Print data summary to stdout without generating PDF."""
    print("\n" + "=" * 60)
    print("DRY RUN - Data Summary")
    print("=" * 60)
    print(f"\nPosts loaded: {len(df)}")
    print(f"Unique authors: {df['author_did'].dropna().nunique()}")
    print(f"Median total score: {df['total_score'].median():.4f}")

    if "classification_method" in df.columns:
        print("\nClassification methods:")
        for method, count in df["classification_method"].fillna("unknown").value_counts().items():
            print(f"  {method}: {count} ({count / len(df) * 100:.1f}%)")

    if "primary_topic" in df.columns:
        print("\nTop 10 topics:")
        for topic, count in df["primary_topic"].value_counts().head(10).items():
            print(f"  {topic}: {count}")

    print("\nScore components (medians):")
    for col, label in zip(SCORE_COMPONENTS, COMPONENT_LABELS):
        if col in df.columns:
            print(f"  {label}: {df[col].median():.4f}")

    print(
        f"\nEpoch: {epoch.get('id', '?')} (status: {epoch.get('status', '?')}, "
        f"votes: {epoch.get('vote_count', '?')})"
    )
    print(
        f"System stats: {stats.get('total_posts', '?')} total posts, "
        f"{stats.get('last_24h', '?')} last 24h, "
        f"{stats.get('scored_count', '?')} scored"
    )
    print("\n" + "=" * 60)


def main() -> None:
    """CLI entrypoint."""
    parser = argparse.ArgumentParser(
        description="Generate feed quality analysis report (HTML + PDF)"
    )
    parser.add_argument("--csv", help="Read from local CSV instead of VPS")
    parser.add_argument("--epoch-json", help="Epoch JSON file (offline mode)")
    parser.add_argument("--output", help="Output PDF file path")
    parser.add_argument("--html-output", help="Optional output path for rendered HTML")
    parser.add_argument("--date", help="Date label for report title")
    parser.add_argument(
        "--dry-run", action="store_true", help="Print summary only (no PDF generation)"
    )
    args = parser.parse_args()

    date_label = args.date or datetime.now().strftime("%B %d, %Y")
    date_slug = datetime.now().strftime("%b%d").lower()
    output_path = args.output or f"reports/sprint-data-analysis-{date_slug}.pdf"

    if args.csv:
        print(f"Loading from CSV: {args.csv}")
        df, epoch, stats = load_from_csv(args.csv, args.epoch_json)
    else:
        df, epoch, stats = fetch_from_vps()

    if len(df) == 0:
        print("No data returned. Check VPS connectivity and epoch state.", file=sys.stderr)
        sys.exit(1)

    df["primary_topic"] = df["topics"].apply(extract_primary_topic)

    if args.dry_run:
        print_dry_run(df, epoch, stats)
        return

    print("Rendering report HTML...")
    html_content = build_report_html(df, epoch, stats, date_label)

    if args.html_output:
        os.makedirs(os.path.dirname(args.html_output) or ".", exist_ok=True)
        with open(args.html_output, "w", encoding="utf-8") as f:
            f.write(html_content)
        print(f"Saved HTML preview: {args.html_output}")

    os.makedirs(os.path.dirname(output_path) or ".", exist_ok=True)
    print(f"Generating PDF: {output_path}")
    render_pdf_with_playwright(html_content, output_path, date_label, epoch.get("id", "?"))

    file_size_kb = os.path.getsize(output_path) / 1024
    print(f"Report saved: {output_path} ({file_size_kb:.0f} KB)")


if __name__ == "__main__":
    main()
