## PROJ-313 backup-volume move

- Decision executed: keep Bluesky runtime, Bluesky active Postgres data, Igor production, and Igor staging on root; move backup storage to `/mnt/host-backups`.
- Control plane used: authenticated DigitalOcean API via existing `DIGITALOCEAN_API_TOKEN`.
- New volume: `corgi-vps-backups`, 100 GB, attached to `corgi-vps`, mounted at `/mnt/host-backups`.

### Before

- Root disk: `96G total / 83G used / 14G free / 86%`.
- Root backup pressure:
  - `/opt/backups/postgres`: `23G`
  - `/opt/igor/backups`: `1.8G`
- Bluesky/Postgres retained dumps: 5 files at roughly `4.5G` each.
- Igor production health: healthy.
- Igor staging health: healthy.
- Bluesky app service: already failed before the move.
- Bluesky Postgres and Redis containers: healthy.

### What changed

- Provisioned and attached DigitalOcean volume `corgi-vps-backups`.
- Formatted the new device as `ext4`.
- Mounted it persistently at `/mnt/host-backups` using `/etc/fstab`.
- Copied retained Bluesky/Postgres dumps to `/mnt/host-backups/postgres`.
- Copied Igor timer-managed backups and release snapshots to `/mnt/host-backups/igor`.
- Updated the live Bluesky backup producer and retention script to target `/mnt/host-backups` and fail closed if the mount is absent.
- Updated the live Igor backup service and deploy path to target `/mnt/host-backups/igor` and require the mount before writing.
- Triggered one real Bluesky backup run and one real Igor backup service run after cutover.
- Pruned historical backup contents from root after the new-volume runs succeeded.

### PROJ-388 review-fix addendum (2026-05-01)

- The `PROJ-388` review pass tightened the Bluesky backup mount guard to require
  an exact `findmnt -n -o TARGET --target "$BACKUP_MOUNT_ROOT"` match before
  creating backup data directories.
- The retention script now validates the mount before treating a missing
  PostgreSQL backup directory as a skip condition.
- `/opt/backups` remains the installed script/log path for root cron
  compatibility; backup data is still rooted under `/mnt/host-backups`.
- Newly captured read-only host proof and terminal provider proof are recorded
  in `10_review_fix_proof_20260501T235534Z.txt` and
  `control-plane/05-volume-attach-terminal-20260501T2355Z.json`.
- The pre-existing `bluesky-feed.service` failure was routed to existing
  runtime-stabilization issue `PROJ-110`; evidence is recorded in
  `11_bluesky_service_followup_20260502T001223Z.txt`.

### After

- Root disk: `96G total / 59G used / 38G free / 61%`.
- New backup volume: `98G total / 25G used / 69G free / 27%`.
- Root usage dropped materially and is now below the steady-state `75%` target.
- Bluesky/Postgres dumps no longer land on root.
- Igor timer-managed backups no longer land on root.
- Igor release rollback snapshots no longer land on root.
- Igor production health: healthy.
- Igor staging health: healthy.
- Bluesky app service: still failed, unchanged from pre-move state.
- Bluesky Postgres and Redis containers: healthy.

### Remaining explicit host risk

- Active Bluesky Postgres volume growth still lives on root.
- Backup and rollback storage no longer compete with active runtime on root.
- If root pressure later becomes unacceptable again, the next topology packet should be Bluesky data/runtime relocation rather than more pruning.

### Receipt map

- `01_prechange_measurements.txt`: root usage, sizes, dump inventory, mounts, `fstab`.
- `02_runtime_before.txt`: Igor and Bluesky pre-change runtime truth.
- `03_copy_phase.txt`: copy of retained backup trees onto the mounted volume.
- `04_install_cutover.txt`: live producer/service path cutover verification.
- `05_bluesky_backup_run.txt`: real Bluesky/Postgres backup run on the new volume with retention validation.
- `06_igor_backup_run.txt`: real Igor state backup service run on the new volume.
- `07_prune_root_backups.txt` and `07b_prune_root_backups_explicit.txt`: root cleanup evidence.
- `08_postchange_state.txt`: post-cutover disk usage, backup trees, and runtime non-regression.
- `09_mount_proof.txt`: mount, filesystem, and persistent `fstab` proof.
- `10_review_fix_proof_20260501T235534Z.txt`: `PROJ-388` read-only
  host/provider proof for mount exactness, root-backup cleanup, and terminal
  DigitalOcean action state.
- `11_bluesky_service_followup_20260502T001223Z.txt`: read-only evidence and
  routing note for the pre-existing `bluesky-feed.service` failure.
- `control-plane/05-volume-attach-terminal-20260501T2355Z.json`: terminal
  DigitalOcean action receipt for action `3138450041`.
