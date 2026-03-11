# Ops Helper Scripts

Quick wrappers for common VPS operations. Reduces verbose `docker exec ... psql ...` commands to simple one-liners.

## Setup

On the VPS:
```bash
cd /opt/bluesky-feed
git pull
bash ops/install.sh
```

Or from local:
```bash
ssh corgi-vps 'cd /opt/bluesky-feed && bash ops/install.sh'
```

## SSH Alias

Add to `~/.ssh/config` on your local machine:
```
Host corgi-vps
    HostName 64.23.239.212
    User root
    ControlMaster auto
    ControlPath ~/.ssh/sockets/%r@%h-%p
    ControlPersist 600
```

Create the sockets directory: `mkdir -p ~/.ssh/sockets`

`ControlMaster` keeps the SSH connection alive for 10 minutes — subsequent commands reuse it instead of re-authenticating.

## Scripts

| Script | Usage | Description |
|--------|-------|-------------|
| `ops/db` | `ops/db "SELECT ..."` | Run SQL against the feed database |
| `ops/redis` | `ops/redis GET key` | Run redis-cli command |
| `ops/logs` | `ops/logs` / `ops/logs -f` / `ops/logs grep "term"` | View service logs |
| `ops/status` | `ops/status` | Full system health overview |
| `ops/feed-check` | `ops/feed-check 30` | Audit top N posts in the feed |
| `ops/deploy` | `ops/deploy` | Pull, build, migrate, restart |
| `scripts/generate-report.py` | `python3 scripts/generate-report.py` | Generate feed quality analysis report |

## Report Generation

Generate a styled .docx feed quality report with charts, tables, and scoring analysis.

```bash
# Full report from live VPS data (default)
python3 scripts/generate-report.py

# Dry run — verify VPS connectivity, print data summary, skip docx
python3 scripts/generate-report.py --dry-run

# Generate from a local CSV (offline / testing)
python3 scripts/generate-report.py --csv /tmp/feed-data.csv

# Custom output path
python3 scripts/generate-report.py --output reports/sprint-data-analysis-mar15.docx

# Custom date label
python3 scripts/generate-report.py --date "March 15, 2026"
```

**Dependencies:** Python 3.12+, pandas, matplotlib, python-docx (all pre-installed).

**Output:** 6-page report covering executive summary, topic distribution, score composition, classification & diversity, engagement profile, and sample posts.
