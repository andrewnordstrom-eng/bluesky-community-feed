# @corgi/feed-sdk

Public type contract for implementing custom scoring components for the
[bluesky-community-feed](https://github.com/andrewnordstrom-eng/bluesky-community-feed).

The package exports the minimum surface a third-party component author needs:

| Export | Purpose |
|---|---|
| `ScoringComponent`, `ScoringContext` | The component contract |
| `PostForScoring` | The post shape components score against |
| `ScoreComponents`, `WeightedScore`, `ScoredPost` | The per-component decomposition contract |
| `GovernanceEpoch`, `GovernanceWeights`, `GovernanceWeightKey` | The community-voted weights in effect |
| `VotableWeightParam` | Voting-UI param config |
| `createComponent({ key, name, score })` | Helper that returns a typed `ScoringComponent` |
| `voteFieldForKey(key)` | Helper mapping camelCase keys to snake_case wide-column names (transitional; removed after PROJ-819) |

## Quickstart

```ts
import { createComponent, type PostForScoring, type ScoringContext } from '@corgi/feed-sdk';

export const civilityComponent = createComponent({
  key: 'civility',
  name: 'Civility',
  async score(post: PostForScoring, _context: ScoringContext): Promise<number> {
    if (!post.text) return 0.5;
    return classifyCivility(post.text);
  },
});

async function classifyCivility(text: string): Promise<number> {
  // Your model goes here.
  return 0.5;
}
```

## Contributing the component upstream

This package is the type contract. To register a component for community
voting, follow the contribution flow in
[`docs/contributing-scoring-components.md`](../../docs/contributing-scoring-components.md)
in the main repo (added in PROJ-820 / P7).

The short version:

1. Implement `ScoringComponent` against this SDK.
2. Open a Linear issue in the `bluesky-feed` project.
3. Add the component to `src/scoring/registry.ts` `DEFAULT_COMPONENTS`.
4. Seed an initial weight in `governance_epoch_weights` if you want it to count
   from epoch 1.
5. Open a PR.

After PROJ-819 (P5) lands, no DB migration is needed for the addition — the
long-table schema accepts any registered key.

## Versioning

The SDK lives in the same monorepo as the feed implementation. Type changes
that would break component authors get a major-version bump and a Linear
issue annotating the migration. PROJ-816 (P3) was the first such change — the
literal-union widening to `string`.

## Architecture context

For the rationale behind the registry-driven, long-table-backed contract, see
[`docs/adr/0001-extensible-scoring-components.md`](../../docs/adr/0001-extensible-scoring-components.md).

License: MIT.
