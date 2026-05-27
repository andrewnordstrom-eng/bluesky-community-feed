# Contributing a scoring component

This guide walks through proposing and registering a new scoring
component for the bluesky-community-feed. Reading time ~10 min;
implementing time depends on your scoring logic.

A scoring component takes a `PostForScoring` plus a `ScoringContext` and
returns a `0..1` score. Community-voted weights multiply the per-component
scores into the post's total ranking. Adding a component is a true
plug-in after the [PROJ-814..820 refactor](adr/ADR-0001-extensible-scoring-components.md) — no
schema changes, no type-system edits, just a new file plus a registry
append.

A working end-to-end example lives at
[`examples/civility-component/`](../examples/civility-component/). If you
need a starting point, copy that directory.

## At a glance

1. Implement [`ScoringComponent`](../packages/feed-sdk/src/index.ts) using
   only `@corgi/feed-sdk` imports.
2. Write a unit test that exercises your `score()` function.
3. Open a Linear issue under the `bluesky-feed` project describing the
   component (purpose, expected score distribution, external
   dependencies, governance implications).
4. Open a PR that registers your component in
   `src/scoring/registry.ts` and adds a matching entry to
   `src/config/votable-params.ts`. The registry drift check at module
   load enforces the pairing.
5. (Optional) Seed an initial weight in the active `governance_epochs`
   row so the community starts voting on it immediately.

## Step-by-step

### 1. Set up

You can develop your component either in a fork of this repo or in a
separate package that depends on `@corgi/feed-sdk`. The example uses the
in-repo `examples/civility-component/` layout — copy it as a template:

```bash
cp -r examples/civility-component examples/my-component
cd examples/my-component
# edit package.json, change "name" to "@corgi-example/my-component"
```

If you're developing outside this repo, install the SDK from npm (once
published) or from a packed tarball:

```bash
cd packages/feed-sdk && npm pack
# produces corgi-feed-sdk-0.1.0.tgz
cd ~/your-fork
npm install /path/to/corgi-feed-sdk-0.1.0.tgz
```

### 2. Implement the contract

The minimum surface is `ScoringComponent`:

```ts
import {
  createComponent,
  type PostForScoring,
  type ScoringComponent,
  type ScoringContext,
} from '@corgi/feed-sdk';

export const myComponent: ScoringComponent = createComponent({
  key: 'myComponent',         // camelCase; matches votable-params entry
  name: 'My Component',       // shown in transparency UIs and audit logs
  async score(post: PostForScoring, _context: ScoringContext): Promise<number> {
    // Return a number in [0, 1]. The runtime multiplies by the community
    // vote weight to produce the per-post weighted contribution.
    return computeYourSignal(post);
  },
});

function computeYourSignal(post: PostForScoring): number {
  // Your logic.
  return 0.5;
}
```

`ScoringContext` exposes the current `epoch` (with weights), the
`scoringWindowHours` constant, and an `authorCounts` map shared across
components in the same pipeline run — use the last one only if your
component needs to coordinate across posts (e.g. source-diversity does).

### 3. Write a test

Use any test framework. The example uses Node's built-in `node:test` so
external contributors have zero monorepo dependencies. Minimum test:

```ts
import { strict as assert } from 'node:assert';
import test from 'node:test';

import { myComponent } from './my-component.js';

test('score is in [0, 1]', async () => {
  const post = /* hand-build a PostForScoring */;
  const ctx = /* hand-build a ScoringContext */;
  const score = await myComponent.score(post, ctx);
  assert.ok(score >= 0 && score <= 1);
});
```

See [`examples/civility-component/src/civility.test.ts`](../examples/civility-component/src/civility.test.ts)
for a complete example with helper functions.

### 4. Open a Linear issue

Under the
[`bluesky-feed`](https://linear.app/andrewnord/project/bluesky-corgi-8f5a0fc7a693)
project, file an issue describing:

- **Purpose:** What signal does this component capture? Why does
  community-voted weighting matter for it?
- **Expected distribution:** Roughly what fraction of posts get high vs
  low scores? Is the distribution roughly uniform, skewed, or bimodal?
- **External dependencies:** Does it need network calls, models, or
  third-party services? If so, what's the latency budget per post?
- **Governance implications:** Are there manipulation risks if a
  community votes this weight very high or very low?
- **Acceptance criteria:** Falsifiable checks that pass when the
  component is correctly integrated.

Follow the [Issue Quality Rubric](../../.github/ops/ISSUE_QUALITY_RUBRIC.md)
shape. Add the `agent-task` label if the work is implementation-ready.

### 5. Open the PR

Two edits register your component:

```ts
// src/scoring/registry.ts
import { myComponent } from '@corgi-example/my-component';  // or relative path
// or import the inline implementation

export const DEFAULT_COMPONENTS: readonly ScoringComponent[] = [
  recencyComponent,
  engagementComponent,
  bridgingComponent,
  sourceDiversityComponent,
  relevanceComponent,
  myComponent,                    // ← add here
];
```

```ts
// src/config/votable-params.ts
export const VOTABLE_WEIGHT_PARAMS: readonly VotableWeightParam[] = [
  // ... existing entries
  {
    key: 'myComponent',                 // must match the component's key
    label: 'My Component',              // shown in the voting UI
    description: 'What this component scores',
    min: 0,
    max: 1,
    defaultValue: 0.1,                  // initial weight if the community hasn't voted
  },
];
```

The `validateRegistry` drift check at module load enforces the pairing —
add to one without the other and the process refuses to start with a
clear error.

### 6. (Optional) Seed an initial weight

If you want your component contributing from epoch 1 (rather than
defaulting to 0 until votes shift it):

```sql
INSERT INTO governance_epoch_weights (epoch_id, component_key, weight)
SELECT id, 'myComponent', 0.1
FROM governance_epochs WHERE status = 'active' ORDER BY id DESC LIMIT 1
ON CONFLICT (epoch_id, component_key) DO NOTHING;
```

Then re-normalize the existing weights so they sum to 1.0 (the constraint
trigger added in PROJ-819 enforces this).

### 7. CI

The
[`examples-build.yml`](../.github/workflows/examples-build.yml) workflow
builds and tests every example component on every PR. If your component
lives in `examples/`, you get this gate for free. If it lives in a
separate repo, run your own CI.

## Constraints worth knowing

- **Scoring is synchronous within the pipeline tick.** Components run
  sequentially per post; a slow component slows the whole pipeline. Keep
  per-post cost well under 100ms; for anything heavier, pre-compute and
  cache via the embedding pattern in `src/scoring/topics/`.
- **Components see only the post and shared run context.** No DB access
  from inside `score()`. If you need cross-post state, accumulate it via
  `context.authorCounts` (or a similarly-shared map).
- **Scores must be deterministic per `(post, epoch)` for auditability.**
  A randomized score breaks counterfactual analysis. If you need
  randomness, derive it from `post.uri + epoch.id` so a re-run yields
  the same value.
- **Don't import from `src/` of the monolith.** If you find yourself
  reaching for an internal helper, ask whether it belongs in the SDK
  instead — file an issue and propose adding it.

## References

- ADR: [`docs/adr/ADR-0001-extensible-scoring-components.md`](adr/ADR-0001-extensible-scoring-components.md)
- SDK source: [`packages/feed-sdk/src/index.ts`](../packages/feed-sdk/src/index.ts)
- Working example: [`examples/civility-component/`](../examples/civility-component/)
- Registry: [`src/scoring/registry.ts`](../src/scoring/registry.ts)
- Vote-UI param config: [`src/config/votable-params.ts`](../src/config/votable-params.ts)
- Issue quality rubric: [`.github/ops/ISSUE_QUALITY_RUBRIC.md`](../../.github/ops/ISSUE_QUALITY_RUBRIC.md)
