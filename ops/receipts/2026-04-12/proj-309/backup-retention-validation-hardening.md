# PROJ-309 — Harden PostgreSQL backup retention and validation to prevent VPS disk recurrence

Date: 2026-04-12
Host: `corgi-vps`
Service: `bluesky-community-feed`

## Summary

This packet fixed the exact recurrence path behind the recent VPS disk emergency:

- the live PostgreSQL backup producer now writes to a temp file, validates it
  with `gzip -t`, and only then promotes it into the retained dump set
- PostgreSQL backup retention is now deterministic on the real
  `/opt/backups/postgres` path: keep only the latest 5 valid dumps
- invalid or truncated `.sql.gz` dumps are removed automatically and are not
  counted as retained backups
- the fix was deployed live to `corgi-vps`
- one real backup run produced a new valid `dump-2026-04-12.sql.gz` and pruned
  the oldest valid retained dump automatically
- one sequential retention replay removed a synthetic invalid candidate and
  reported `invalid_removed=1`

This slice did **not** widen into storage migration, public-feed recovery, or
broader Docker cleanup.

## Current backup automation truth before changes

### Root cron wiring

Command:

```bash
ssh corgi-vps 'sudo crontab -l | grep -E "daily-backup|bluesky-ops-retention|bluesky-disk-alert"'
```

Output:

```text
*/5 * * * * /usr/local/bin/bluesky-disk-alert.sh
30 3 * * * /usr/local/bin/bluesky-ops-retention.sh
0 3 * * * /opt/backups/daily-backup.sh >> /opt/backups/backup.log 2>&1
```

### Live producer behavior before changes

Command:

```bash
ssh corgi-vps 'sudo sed -n "1,260p" /opt/backups/daily-backup.sh'
```

Output excerpt:

```bash
RETENTION_DAYS=7
DUMP_FILE="/opt/backups/postgres/dump-${DATE}.sql.gz"

docker exec bluesky-feed-postgres pg_dumpall -U feed 2>/dev/null | gzip > "$DUMP_FILE"

DUMP_SIZE=$(stat -c%s "$DUMP_FILE" 2>/dev/null || echo 0)
if [ "$DUMP_SIZE" -lt 1048576 ]; then
    echo "ERROR: Dump file suspiciously small (${DUMP_SIZE} bytes) — possible partial dump"
    rm -f "$DUMP_FILE"
    exit 1
fi

find /opt/backups/postgres -name "dump-*.sql.gz" -mtime +${RETENTION_DAYS} -delete -print
```

Current truth from that script:

- writes directly to the final retained dump path
- only rejects files smaller than `1MB`
- does **not** run `gzip -t`
- prunes by age (`-mtime +7`), not by “latest 5 valid dumps”

### Live retention helper behavior before changes

Command:

```bash
ssh corgi-vps 'sudo sed -n "1,260p" /usr/local/bin/bluesky-ops-retention.sh'
```

Output excerpt:

```bash
BACKUP_DIR="/home/corgi/backups"
if [ -d "$BACKUP_DIR" ]; then
  mapfile -t backups < <(ls -1t "$BACKUP_DIR"/db_*.sql.gz 2>/dev/null || true)
  if (( ${#backups[@]} > 5 )); then
    printf '%s\n' "${backups[@]:5}" | xargs -r rm -f
  fi
  find "$BACKUP_DIR" -maxdepth 1 -type f -name 'db_*.sql' -mtime +1 -delete || true
  find "$BACKUP_DIR" -maxdepth 1 -type f -name 'db_*.sql.gz' -mtime +14 -delete || true
fi
```

Current truth from that helper:

- it enforced retention on the **wrong path**
- it never touched the real PostgreSQL backup directory `/opt/backups/postgres`
- it never validated `gzip` integrity before counting or deleting dumps

## Exact recurrence bug

The recurrence risk came from two separate drifts lining up:

1. The producer wrote to `/opt/backups/postgres` but only performed a size
   check (`> 1MB`), so a truncated `2.2GB` gzip still looked “large enough” to
   keep.
2. The retention helper enforced “latest 5” on `/home/corgi/backups`, while the
   live PostgreSQL dumps were accumulating under `/opt/backups/postgres`.

That is why the emergency packet found:

- a truncated `dump-2026-04-12.sql.gz`
- 9 retained dumps in `/opt/backups/postgres`
- root-disk growth driven by backup accumulation, not by Docker image cruft

## Narrow fix implemented

Tracked files added:

- `ops/daily-backup.sh`
- `ops/bluesky-ops-retention.sh`

Tracked files updated:

- `ops/install.sh`
- `docs/OPS_RUNBOOK.md`
- `docs/OPERABILITY.md`
- `docs/agent/REPO_CONTRACT.md`

### Producer behavior after changes

Installed script:

```bash
ssh corgi-vps 'sudo sed -n "1,220p" /opt/backups/daily-backup.sh'
```

Key logic now:

```bash
TMP_DUMP="$(mktemp "${POSTGRES_DIR}/.dump-${DATE}.sql.gz.tmp.XXXXXX")"

if ! docker exec bluesky-feed-postgres pg_dumpall -U feed 2>/dev/null | gzip -c > "${TMP_DUMP}"; then
  log "ERROR: PostgreSQL dump failed before validation"
  exit 1
fi

if ! validate_gzip_dump "${TMP_DUMP}"; then
  log "ERROR: Dump file failed gzip integrity validation — refusing to retain"
  exit 1
fi

mv -f "${TMP_DUMP}" "${DUMP_FILE}"
prune_postgres_backups
```

Effect:

- a bad dump never becomes the retained `dump-YYYY-MM-DD.sql.gz`
- a failed or truncated gzip is rejected before promotion
- the same run prunes the retained set back to the latest 5 valid dumps

### Retention behavior after changes

Installed helper:

```bash
ssh corgi-vps 'sudo sed -n "1,220p" /usr/local/bin/bluesky-ops-retention.sh'
```

Key logic now:

```bash
POSTGRES_DIR="${POSTGRES_BACKUP_DIR:-/opt/backups/postgres}"

mapfile -t backups < <(
  find "${POSTGRES_DIR}" -maxdepth 1 -type f -name 'dump-*.sql.gz' -printf '%f\n' | sort -r
)

if ! validate_gzip_dump "${backup_path}"; then
  rm -f "${backup_path}"
  log "remove_invalid_dump file=${backup_path}"
  continue
fi

if (( valid_count > KEEP_VALID_DUMPS )); then
  rm -f "${backup_path}"
  log "remove_out_of_retention_dump file=${backup_path}"
fi
```

Effect:

- retention now targets the real dump directory
- invalid dumps are removed before they can count toward the retention floor
- the retained set is deterministic and bounded to 5 valid dumps

## Preservation step before live install

Command:

```bash
ssh corgi-vps 'stamp=$(date -u +%Y%m%dT%H%M%SZ); sudo cp /opt/backups/daily-backup.sh /opt/backups/daily-backup.sh.${stamp}.bak && sudo cp /usr/local/bin/bluesky-ops-retention.sh /usr/local/bin/bluesky-ops-retention.sh.${stamp}.bak && printf "%s\n%s\n" "/opt/backups/daily-backup.sh.${stamp}.bak" "/usr/local/bin/bluesky-ops-retention.sh.${stamp}.bak"'
```

Output:

```text
/opt/backups/daily-backup.sh.20260412T223752Z.bak
/usr/local/bin/bluesky-ops-retention.sh.20260412T223752Z.bak
```

## Live install

Commands:

```bash
scp /tmp/proj309-bluesky/ops/daily-backup.sh /tmp/proj309-bluesky/ops/bluesky-ops-retention.sh /tmp/proj309-bluesky/ops/install.sh corgi-vps:/tmp/

ssh corgi-vps 'sudo install -d -m 0755 /opt/bluesky-feed/ops && sudo cp /tmp/daily-backup.sh /opt/bluesky-feed/ops/daily-backup.sh && sudo cp /tmp/bluesky-ops-retention.sh /opt/bluesky-feed/ops/bluesky-ops-retention.sh && sudo cp /tmp/install.sh /opt/bluesky-feed/ops/install.sh && sudo bash /opt/bluesky-feed/ops/install.sh'
```

Install output excerpt:

```text
✓ ops/daily-backup.sh
✓ ops/bluesky-ops-retention.sh
✓ /opt/backups directories
✓ /opt/backups/daily-backup.sh
✓ /usr/local/bin/bluesky-ops-retention.sh
✓ systemctl daemon-reload
```

## Live directory state before the fix was exercised

Command:

```bash
ssh corgi-vps 'sudo find /opt/backups/postgres -maxdepth 1 -type f -name "dump-*.sql.gz" -printf "%f %s\n" | sort'
```

Output:

```text
dump-2026-04-07.sql.gz 4803716517
dump-2026-04-08.sql.gz 4803717491
dump-2026-04-09.sql.gz 4803716513
dump-2026-04-10.sql.gz 4803716516
dump-2026-04-11.sql.gz 4803717208
```

At this point the emergency cleanup had already removed the invalid/truncated
`dump-2026-04-12.sql.gz`, so the goal here was to prove the recurring producer
and retention behavior going forward.

## Real proof: backup run leaves only the latest 5 valid dumps

Command:

```bash
ssh corgi-vps 'sudo /opt/backups/daily-backup.sh'
```

Observed behavior during the live run:

- temporary validated dump file appeared as:
  - `/opt/backups/postgres/.dump-2026-04-12.sql.gz.tmp.Nz8l34`
- root usage rose to `89%` while the temp file existed
- once validation and retention finished, root returned to `84%`

After-state commands:

```bash
ssh corgi-vps 'sudo find /opt/backups/postgres -maxdepth 1 -type f -name "dump-*.sql.gz" -printf "%f %s\n" | sort'
ssh corgi-vps 'df -h /'
```

Outputs:

```text
dump-2026-04-08.sql.gz 4803717491
dump-2026-04-09.sql.gz 4803716513
dump-2026-04-10.sql.gz 4803716516
dump-2026-04-11.sql.gz 4803717208
dump-2026-04-12.sql.gz 4803717486
```

```text
Filesystem      Size  Used Avail Use% Mounted on
/dev/vda1        96G   81G   16G  84% /
```

Result:

- a new valid `dump-2026-04-12.sql.gz` was produced
- the oldest previously kept dump (`dump-2026-04-07.sql.gz`) was pruned
- the retained set stayed bounded at exactly 5 valid dumps

## Real proof: retained dumps pass integrity checks

Command:

```bash
ssh corgi-vps 'for dump in /opt/backups/postgres/dump-*.sql.gz; do sudo gzip -t "$dump" && echo "$(basename "$dump") OK"; done'
```

Output:

```text
dump-2026-04-08.sql.gz OK
dump-2026-04-09.sql.gz OK
dump-2026-04-10.sql.gz OK
dump-2026-04-11.sql.gz OK
dump-2026-04-12.sql.gz OK
```

## Real proof: invalid/truncated candidate is rejected

### Create a synthetic invalid candidate

Command:

```bash
ssh corgi-vps 'sudo sh -c "printf not-a-gzip > /opt/backups/postgres/dump-2099-01-01.sql.gz" && sudo ls -lah /opt/backups/postgres/dump-2099-01-01.sql.gz'
```

Output:

```text
-rw-r--r-- 1 root root 10 Apr 12 18:59 /opt/backups/postgres/dump-2099-01-01.sql.gz
```

### Run retention sequentially

Command:

```bash
ssh corgi-vps 'sudo /usr/local/bin/bluesky-ops-retention.sh --postgres-only'
```

Retention evidence:

```bash
ssh corgi-vps 'sudo journalctl -t bluesky-ops-retention -n 20 --no-pager'
```

Output excerpt:

```text
Apr 12 19:12:35 Corgi-Services bluesky-ops-retention[3249714]: remove_invalid_dump file=/opt/backups/postgres/dump-2099-01-01.sql.gz
Apr 12 19:20:30 Corgi-Services bluesky-ops-retention[3252135]: postgres_backup_retention kept=5 invalid_removed=1 old_removed=0 limit=5
```

And the directory afterwards:

```bash
ssh corgi-vps 'sudo find /opt/backups/postgres -maxdepth 1 -type f -name "dump-*.sql.gz" -printf "%f %s\n" | sort'
```

Output:

```text
dump-2026-04-08.sql.gz 4803717491
dump-2026-04-09.sql.gz 4803716513
dump-2026-04-10.sql.gz 4803716516
dump-2026-04-11.sql.gz 4803717208
dump-2026-04-12.sql.gz 4803717486
```

Result:

- the fake invalid candidate was removed
- the retained set stayed at 5 valid dumps
- a bad dump no longer silently counts as “one of the 5”

## Documentation updates

Docs updated to make the installed contract truthful:

- `docs/OPS_RUNBOOK.md`
  - now points to `/opt/backups/daily-backup.sh`
  - now documents root cron, `/opt/backups/postgres`, `gzip -t`, and latest-5-valid retention
- `docs/OPERABILITY.md`
  - now describes validated producer behavior and real retention semantics
- `docs/agent/REPO_CONTRACT.md`
  - now points to `/opt/backups/postgres` and the deterministic latest-5-valid contract

## Local validation

Worktree: `/tmp/proj309-bluesky`

### Shell syntax

Command:

```bash
bash -n ops/daily-backup.sh ops/bluesky-ops-retention.sh ops/install.sh
```

Result:

- exit `0`

### Docs verification

Command:

```bash
npm run docs:verify
```

Output:

```text
Docs verification passed (13 tracked docs, 23 markdown files scanned).
```

### Build

Command:

```bash
npm run build
```

Result:

- exit `0`

### Diff hygiene

Command:

```bash
git diff --check
```

Result:

- exit `0`

### Contract check note

Command:

```bash
python3 /Users/andrewnordstrom/Desktop/Projects/AndrewNordstrom-eng/.github/.github/scripts/contract_policy_check.py --repo-root /tmp/proj309-bluesky --org-root /Users/andrewnordstrom/Desktop/Projects/AndrewNordstrom-eng/.github --project-key bluesky-feed --strict-warnings
```

Result:

- exit `1`
- blocker is a **pre-existing repo baseline gap**, not this packet:
  - missing required workflow for production_service: `.github/workflows/aikido-thread-check.yml`

## Remaining risks intentionally left out of scope

- PostgreSQL backups still live on the VPS root disk; this packet did **not**
  move them off-root.
- The live Bluesky Postgres Docker volume remains large and stateful; this packet
  did **not** touch it.
- Public feed recovery remains separate from backup hygiene.

## Outcome

- backup retention is now deterministic and bounded
- truncated/invalid dumps no longer silently count as successful retained backups
- the exact backup-hygiene failure mode that filled root disk is materially reduced
- the remaining risk is now storage topology and capacity planning, not broken
  backup retention or validation

## Recommended next follow-up issues

1. Move Bluesky backups or retention pressure off the root disk so backup growth
   cannot threaten host stability again.
2. Review the public `feed.corgi.network` runtime separately from this backup
   hygiene lane if it still needs recovery.
