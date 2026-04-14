# Anti-Patterns — Bluesky Community Feed

Known mistakes and failure modes discovered during development.
Updated whenever an agent PR is rejected or substantially corrected.
Referenced by agent startup overlays (for example local `CLAUDE.md`) before work in relevant areas.

## Format

Each entry follows: **When** [doing X], **don't** [do Y], **instead** [do Z], **because** [reason].
Added: [date]. Source: [Linear issue key or PR link].

## Entries

### 2026-04-07 — Treating lint rollout as frontend-only in a split stack

**When** doing lint/format rollout, **don't** validate only one package path, **instead** run checks for both backend and `/web` surfaces with their own dependencies, **because** this repo has separate runtime surfaces and drift slips in if one side is skipped.
Added: 2026-04-07. Source: [PROJ-190](https://linear.app/andrewnord/issue/PROJ-190), [PR #143](https://github.com/andrewnordstrom-eng/bluesky-community-feed/pull/143).

### 2026-04-07 — Leaving targeted eslint-disable debt unresolved

**When** introducing temporary lint suppressions, **don't** merge permanent broad disables in scoring/embedding paths, **instead** scope suppressions narrowly and create a tracked cleanup path, **because** lingering suppressions hide real regressions in content-quality logic.
Added: 2026-04-07. Source: [PROJ-190](https://linear.app/andrewnord/issue/PROJ-190), [PR #143](https://github.com/andrewnordstrom-eng/bluesky-community-feed/pull/143).

### 2026-04-07 — Rebrand migration without infra-level domain inventory

**When** changing launch branding/domain posture, **don't** patch strings ad hoc across scripts and docs, **instead** execute a domain + AT Protocol migration checklist first, **because** partial rebrand updates create broken links and inconsistent subscriber flows.
Added: 2026-04-07. Source: [PROJ-139](https://linear.app/andrewnord/issue/PROJ-139), [PROJ-154](https://linear.app/andrewnord/issue/PROJ-154).

### 2026-04-07 — Deferring production hardening until launch week

**When** preparing for public launch, **don't** treat infra hardening as a final-day polish step, **instead** stage hardening as a tracked milestone before launch execution, **because** late hardening drives rushed fixes and weak rollback options.
Added: 2026-04-07. Source: [PROJ-149](https://linear.app/andrewnord/issue/PROJ-149), [PROJ-141](https://linear.app/andrewnord/issue/PROJ-141).

<!-- Add new entries at the top. Never delete entries — mark obsolete ones with [OBSOLETE: reason] -->
