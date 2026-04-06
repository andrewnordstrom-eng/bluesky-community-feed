# PRD — bluesky-community-feed

Status: canonical product brief
Owner: bluesky-feed
Service class: production_service
Last updated: 2026-04-05

## Mission

Prove that a real social feed can be community-governed without becoming opaque,
slow, or unserious. Subscribers should be able to influence ranking behavior and
see exactly how those choices affect the feed.

## Problem

Most social ranking systems are black boxes controlled by a platform operator.
Users cannot see why posts rank the way they do, cannot meaningfully shape the
algorithm, and cannot audit the consequences of policy changes.

## Outcomes

- Subscribers can vote on ranking weights and content rules through a usable
  governance surface.
- The ranking pipeline persists full score decomposition so every result is
  explainable.
- Feed serving stays production-fast while governance and transparency remain
  research-grade and auditable.
- The system can support research workflows such as consent-aware exports and
  participant gating without forking a separate product architecture.

## Non-goals

- This repo is not a general-purpose social app; it is a governed feed service.
- It does not replace Bluesky moderation or the broader AT Protocol ecosystem.
- It is not trying to solve every recommendation problem at once; the current
  focus is governed ranking plus transparent measurement.
