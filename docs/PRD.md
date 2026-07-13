# PRD — bluesky-community-feed

Status: canonical product brief
Owner: bluesky-feed
Service class: production_service
Last updated: 2026-07-13

## Mission

Prove that a real social feed can be community-shaped without becoming opaque,
slow, or unserious. Approved pilot participants can propose ranking policy while
anyone can inspect what changed and why.

## Problem

Most social ranking systems are black boxes controlled by a platform operator.
Users cannot see why posts rank the way they do, cannot meaningfully shape the
algorithm, and cannot audit the consequences of policy changes.

## Outcomes

- Approved pilot participants can vote on five global signal weights, topic
  priorities, and content rules through a usable governance surface. Anyone can
  inspect the public feed or use the isolated shadow demo without joining the pilot.
- The ranking pipeline persists full score decomposition so every result is
  explainable — in a normalized long table that supports any-N components,
  not a 5-column fossilized schema.
- Feed serving stays production-fast while governance and transparency remain
  research-grade and auditable.
- The system can support research workflows such as consent-aware exports and
  participant gating without forking a separate product architecture.
- The scoring contract is genuinely pluggable: third-party authors can
  implement and propose a new component using only the `@corgi/feed-sdk`
  public type surface, with no internal-path imports and no schema
  migration. See [`docs/contributing-scoring-components.md`](contributing-scoring-components.md)
  and [`examples/civility-component/`](../examples/civility-component/).

## Non-goals

- This repo is not a general-purpose social app; it is a governed feed service.
- It does not replace Bluesky moderation or the broader AT Protocol ecosystem.
- It is not trying to solve every recommendation problem at once; the current
  focus is governed ranking plus transparent measurement.
