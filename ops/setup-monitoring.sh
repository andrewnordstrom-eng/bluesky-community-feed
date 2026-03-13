#!/usr/bin/env bash
# External Monitoring Setup Guide
#
# This script prints setup instructions for external uptime monitoring.
# It does NOT create accounts automatically — you set them up manually.
#
# Two complementary services (both free tier):
# 1. UptimeRobot — pings /health/live every 5 min, emails on failure
# 2. Healthchecks.io — expects daily ping from GitHub Actions, alerts if missed
#
# Usage: bash ops/setup-monitoring.sh
set -euo pipefail

cat << 'GUIDE'
╔══════════════════════════════════════════════════════════════════╗
║           External Monitoring Setup Guide                       ║
╚══════════════════════════════════════════════════════════════════╝

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
1. UptimeRobot (real-time uptime monitoring)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

What: Pings your feed every 5 minutes, emails you if it goes down.
Free tier: 50 monitors, 5-minute interval.

Setup:
  1. Go to https://uptimerobot.com and create a free account
  2. Click "Add New Monitor"
  3. Configure:
     - Monitor Type: HTTP(s)
     - Friendly Name: Corgi Feed
     - URL: https://feed.corgi.network/health/live
     - Monitoring Interval: 5 minutes
  4. Add your email as an alert contact
  5. Save

What it catches:
  ✓ Server completely down
  ✓ Nginx/TLS issues
  ✓ DNS resolution failures
  ✓ HTTP hangs (timeout-based detection)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
2. Healthchecks.io (cron/pipeline monitoring)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

What: Expects a daily ping from your GitHub Actions health check.
      If no ping arrives within 24h, it emails you.
Free tier: 20 checks, 3-month retention.

Setup:
  1. Go to https://healthchecks.io and create a free account
  2. Create a new check:
     - Name: Corgi Daily Health
     - Period: 1 day
     - Grace: 1 hour
  3. Copy the ping URL (looks like: https://hc-ping.com/xxxxxxxx-...)
  4. Add it as a GitHub Actions secret:
     - Go to your repo → Settings → Secrets → Actions
     - Create: HEALTHCHECK_PING_URL = <your ping URL>
  5. The daily-health.yml workflow will ping it automatically

What it catches:
  ✓ GitHub Actions workflow failures
  ✓ Database connectivity issues (caught by CLI health check)
  ✓ Silent failures where the cron job itself stops running

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
3. GitHub Secrets Required
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

After setup, add this secret to your GitHub repo:

  HEALTHCHECK_PING_URL  — The ping URL from Healthchecks.io

The deploy and daily-health workflows will use this automatically.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
4. Verify
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  # Test UptimeRobot:
  # Check the UptimeRobot dashboard — should show "Up" status

  # Test Healthchecks.io (manual ping):
  # curl -fsS https://hc-ping.com/YOUR-UUID-HERE

  # Test failure alert:
  # Pause UptimeRobot monitor, wait 5 min → should get email
  # Skip a daily health run → Healthchecks.io alerts after 25h

GUIDE
