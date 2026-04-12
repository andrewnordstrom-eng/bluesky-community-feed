#!/usr/bin/env bash
# Install ops scripts and systemd units on the VPS.
# Run from local: ssh root@64.23.239.212 'bash -s' < ops/install.sh
# Or from VPS:    cd /opt/bluesky-feed && bash ops/install.sh
set -euo pipefail

APP_DIR="/opt/bluesky-feed"

# ── Make ops scripts executable ──────────────────────────────────
SCRIPTS="db redis logs deploy feed-check status health-watchdog daily-backup.sh bluesky-ops-retention.sh"
for script in $SCRIPTS; do
  if [ -f "$APP_DIR/ops/$script" ]; then
    chmod +x "$APP_DIR/ops/$script"
    echo "✓ ops/$script"
  fi
done

# ── Install systemd service file ─────────────────────────────────
echo ""
echo "=== Installing systemd units ==="

# Main application service
if [ -f "$APP_DIR/ops/bluesky-feed.service" ]; then
  cp "$APP_DIR/ops/bluesky-feed.service" /etc/systemd/system/bluesky-feed.service
  echo "✓ bluesky-feed.service"
fi

# Health watchdog timer
if [ -f "$APP_DIR/ops/health-watchdog.service" ]; then
  cp "$APP_DIR/ops/health-watchdog.service" /etc/systemd/system/health-watchdog.service
  echo "✓ health-watchdog.service"
fi

if [ -f "$APP_DIR/ops/health-watchdog.timer" ]; then
  cp "$APP_DIR/ops/health-watchdog.timer" /etc/systemd/system/health-watchdog.timer
  echo "✓ health-watchdog.timer"
fi

# Backup and retention scripts
install -d -m 0755 /opt/backups /opt/backups/postgres /opt/backups/igor
echo "✓ /opt/backups directories"

if [ -f "$APP_DIR/ops/daily-backup.sh" ]; then
  install -m 0755 "$APP_DIR/ops/daily-backup.sh" /opt/backups/daily-backup.sh
  echo "✓ /opt/backups/daily-backup.sh"
fi

if [ -f "$APP_DIR/ops/bluesky-ops-retention.sh" ]; then
  install -m 0755 "$APP_DIR/ops/bluesky-ops-retention.sh" /usr/local/bin/bluesky-ops-retention.sh
  echo "✓ /usr/local/bin/bluesky-ops-retention.sh"
fi

# Reload systemd and enable units
systemctl daemon-reload
echo "✓ systemctl daemon-reload"

systemctl enable bluesky-feed 2>/dev/null || true
echo "✓ bluesky-feed enabled"

systemctl enable --now health-watchdog.timer 2>/dev/null || true
echo "✓ health-watchdog.timer enabled"

# ── Summary ──────────────────────────────────────────────────────
echo ""
echo "Installation complete. Usage:"
echo "  ops/db \"SELECT COUNT(*) FROM posts\""
echo "  ops/redis GET feed:count"
echo "  ops/logs -f"
echo "  ops/deploy"
echo "  ops/feed-check 50"
echo "  ops/status"
echo "  /opt/backups/daily-backup.sh"
echo "  /usr/local/bin/bluesky-ops-retention.sh"
echo ""
echo "Systemd units:"
echo "  systemctl status bluesky-feed"
echo "  systemctl list-timers health-watchdog.timer"
echo "  journalctl -t health-watchdog --since '1 hour ago'"
