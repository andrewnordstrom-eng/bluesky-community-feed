# 24-Hour Stability Test Plan

This document outlines the procedure for running a 24-hour stability test to verify the Community Feed Generator is production-ready.

## Overview

The stability test validates that the system can:
1. Run continuously without crashes or memory leaks
2. Handle normal load with acceptable latency
3. Recover from temporary failures (DB/Redis/Jetstream disconnects)
4. Maintain data integrity (no lost events, correct scores)

## Pre-Test Checklist

Before starting the test, verify:

- [ ] Local lab artifact protocol exists (`artifacts/lab/manifest.schema.json`)
- [ ] Jetstream replay lab passes locally:
  `npm run lab:jetstream-replay -- --ephemeral --events 1200`
- [ ] Real HTTP voting lab passes locally:
  `npm run lab:vote-load -- --ephemeral --valid-requests 8000 --users 500 --connections 100`
- [ ] Process-isolated memory lab passes locally:
  `npm run lab:memory-isolated -- --ephemeral --runs 5 --amount 10000 --connections 100`
- [ ] Compiled prod-parity memory lab passes locally:
  `npm run lab:memory-prod-parity -- --ephemeral --runs 5 --amount 10000 --connections 100`
- [ ] Each lab run has `manifest.json`, `checksums.sha256`, and cited summary artifacts under `artifacts/lab/PROJ-1551/<run-id>/`
- [ ] Docker containers running (`docker compose ps`)
- [ ] PostgreSQL has recent data (`SELECT COUNT(*) FROM posts`)
- [ ] Redis is operational (`redis-cli ping`)
- [ ] Application starts without errors (`npm run dev`)
- [ ] Health endpoint returns healthy (`curl http://localhost:3000/health`)
- [ ] Feed endpoint returns data (`curl "http://localhost:3000/xrpc/app.bsky.feed.getFeedSkeleton?feed=..."`)
- [ ] Log files configured (or `docker logs` available)

Current PROJ-1551 status: the Jetstream replay, real HTTP voting, and process-isolated memory lab gates have passing local receipts. The current Jetstream receipt is `artifacts/lab/PROJ-1551/2026-07-06T19-37-49-725Z/`; the HTTP voting receipt is `artifacts/lab/PROJ-1551/2026-07-06T19-38-04-859Z/`. The fixed tsx memory receipt is `artifacts/lab/PROJ-1551/2026-07-06T19-38-23-532Z/`. The compiled prod-parity memory receipt is `artifacts/lab/PROJ-1551/2026-07-06T19-42-01-707Z/`, with compiled heap-snapshot diagnostics in `artifacts/lab/PROJ-1551/2026-07-05T17-42-12-174Z/`. One preceding local 100-connection vote-load attempt failed with PostgreSQL pool connection timeouts before the current pass, so the staging gate must record repeated voting runs and DB pool utilization. The memory gates use `--max-old-space-size=896 --max-semi-space-size=16` and a 1,000-request external warmup baseline before the before-GC snapshot. The tracked systemd unit already has `--max-old-space-size=896`; the approval-gated next step is verifying/adopting the missing `--max-semi-space-size=16` on an approved staging or shadow target. This does not authorize staging or production saturation by itself; shared-environment load still requires an approved target, abort thresholds, rollback plan, and no production blast radius.

## Starting the Test

```bash
# Start in production mode
NODE_ENV=production npm run start

# Or with Docker
docker compose up -d
```

Record start time: `_____________`

## Monitoring Schedule

### Every 5 Minutes (Automated)

Set up a cron job or monitoring tool to check:

```bash
# Health check
curl -s http://localhost:3000/health | jq '.status'
# Expected: "ok"

# Verify feed is returning data
curl -s "http://localhost:3000/xrpc/app.bsky.feed.getFeedSkeleton?feed=at://...&limit=1" | jq '.feed | length'
# Expected: > 0
```

### Every Hour (Manual or Automated)

| Check | Command | Expected |
|-------|---------|----------|
| Process running | `pgrep -f "node dist/index.js"` | PID returned |
| Memory usage | `ps -o rss= -p <PID>` | < 1GB, stable |
| CPU usage | `top -l 1 -pid <PID>` | < 50% avg |
| Error count | `grep -c ERROR logs/app.log` | Minimal growth |
| DB connections | `SELECT count(*) FROM pg_stat_activity WHERE datname='community_feed'` | < 20 |
| Redis memory | `redis-cli INFO memory \| grep used_memory_human` | Stable |

```sql
-- Verify scoring is running
SELECT COUNT(*), MAX(scored_at) as last_score
FROM post_scores
WHERE scored_at > NOW() - INTERVAL '1 hour';
-- Expected: COUNT > 0, last_score within 5 minutes

-- Verify Jetstream is ingesting
SELECT COUNT(*), MAX(indexed_at) as last_post
FROM posts
WHERE indexed_at > NOW() - INTERVAL '1 hour';
-- Expected: COUNT > 0 (varies by network activity)

-- Verify cursor advancing
SELECT cursor_us, updated_at FROM jetstream_cursor WHERE id = 1;
-- Expected: updated_at within last few minutes
```

### Every 4 Hours

Run the load test:

```bash
npx tsx scripts/load-test.ts --duration 60
```

Expected:
- p95 latency < 50ms
- 0 errors
- 0 timeouts
- 0 non-2xx responses
- 0 unexpected statuses
- 0 5xx responses

The load-test script exits non-zero if any of these gates fail.

### Failure Scenario Tests

Run each of these once during the 24-hour period:

#### 1. PostgreSQL Restart (Hour 4)

```bash
docker compose stop postgres
sleep 30
docker compose start postgres
```

**Expected behavior:**
- Application logs connection errors
- Health endpoint shows database unhealthy
- Application reconnects automatically
- No manual intervention needed

**Verify recovery:**
```bash
curl http://localhost:3000/health
# Status should return to "healthy" within 60s
```

#### 2. Redis Restart (Hour 8)

```bash
docker compose stop redis
sleep 30
docker compose start redis
```

**Expected behavior:**
- Feed skeleton returns empty temporarily
- Next scoring run repopulates Redis
- Application recovers automatically

**Verify recovery:**
```bash
redis-cli ZCARD feed:current
# Should have entries after next scoring run (max 5 min)
```

#### 3. Network Interruption (Hour 12)

Simulate Jetstream disconnect:

```bash
# Block Jetstream traffic (requires root)
sudo iptables -A OUTPUT -d jetstream2.us-east.bsky.network -j DROP
sleep 60
sudo iptables -D OUTPUT -d jetstream2.us-east.bsky.network -j DROP
```

**Expected behavior:**
- Jetstream reconnects with exponential backoff
- Falls back to secondary instance if primary unreachable
- Resumes from saved cursor (no data loss)

**Verify recovery:**
```bash
# Check logs for reconnection
grep -i "reconnect\|fallback" logs/app.log | tail -5

# Verify cursor after recovery
SELECT cursor_us, updated_at FROM jetstream_cursor WHERE id = 1;
```

#### 4. High Load (Hour 16)

```bash
npx tsx scripts/load-test.ts --connections 200 --duration 120
```

**Expected behavior:**
- System remains responsive
- No OOM kills
- p95 < 100ms under heavy load

#### 5. Graceful Shutdown (Hour 20)

```bash
# Start app
npm run start &
PID=$!
sleep 10

# Send SIGTERM
kill -TERM $PID

# Monitor logs
```

**Expected behavior:**
- "Shutting down gracefully..." logged
- All components stop in order
- "Graceful shutdown complete" within 30s
- Exit code 0

## At 24 Hours

### Final Verification

```bash
# Uptime
ps -o etime= -p <PID>
# Expected: 24:00:00+

# Total events processed
grep "Cursor saved" logs/app.log | wc -l
# Multiply by 1000 for approximate events

# Total scoring runs
grep "Scoring pipeline complete" logs/app.log | wc -l
# Expected: ~288 (every 5 min for 24h)

# Error count
grep -c "ERROR\|FATAL" logs/app.log
# Expected: Minimal (< 100)
```

### Data Integrity Check

```sql
-- Posts ingested
SELECT COUNT(*) FROM posts WHERE indexed_at > NOW() - INTERVAL '24 hours';

-- Scores generated
SELECT
  COUNT(*) as total_scores,
  COUNT(DISTINCT epoch_id) as epochs,
  MAX(scored_at) as last_score
FROM post_scores
WHERE scored_at > NOW() - INTERVAL '24 hours';

-- No orphaned scores
SELECT COUNT(*) FROM post_scores ps
LEFT JOIN posts p ON ps.post_uri = p.uri
WHERE p.uri IS NULL;
-- Expected: 0
```

### Performance Summary

| Metric | Target | Actual |
|--------|--------|--------|
| Uptime | 24h | |
| p95 Latency | <50ms | |
| Error Rate | <0.1% | |
| Memory Growth | <10% | |
| Scoring Runs | ~288 | |
| Recovery Time | <60s | |

## Success Criteria

The test passes if ALL of the following are true:

- [ ] No unplanned restarts or crashes
- [ ] Memory usage remained stable (no leaks)
- [ ] All failure scenarios recovered automatically
- [ ] p95 latency remained under 50ms (normal load)
- [ ] Error rate < 0.1%
- [ ] Data integrity maintained (no lost events)
- [ ] Graceful shutdown completed successfully

## Failure Investigation

If the test fails, gather:

1. Application logs: `logs/app.log`
2. System metrics: `top`, `vmstat`, `iostat` output
3. Database logs: `docker logs postgres`
4. Redis logs: `docker logs redis`
5. PostgreSQL stats: `pg_stat_activity`, `pg_stat_statements`

Common issues:

| Symptom | Possible Cause | Investigation |
|---------|---------------|---------------|
| Memory growth | Event processing leak | Heap dump, check for unbounded arrays |
| Connection errors | Pool exhaustion | Check pg_stat_activity, increase pool |
| High latency | Missing indexes | Run analyze-queries.sql |
| Scoring gaps | Pipeline timeout | Check scoring duration in logs |

## Sign-off

| Role | Name | Date | Pass/Fail |
|------|------|------|-----------|
| Tester | | | |
| Reviewer | | | |
