# Lab Artifact Retention

This directory keeps the durable retention contract for Corgi validation runs.
Per-run payloads are intentionally ignored by git:

```text
artifacts/lab/PROJ-1551/<run-id>/
```

Each run directory should contain:

- `manifest.json` matching `manifest.schema.json`
- `checksums.sha256`
- one subdirectory per harness phase, for example `jetstream-replay/`, `vote-load/`, or `memory-isolated/`
- raw stdout/stderr receipts when a phase is launched as a subprocess
- summary JSON files used by lab-journal claims

The protocol is: claims in docs must cite a manifest path and a summary path.
Raw campaign files may remain local, but every claim needs a reproducible
command, git state, thresholds, and SHA-256 checksums.
