# Open Science Builders Demo Readiness

Date: 2026-07-10 UTC

Purpose: quantify whether the primary reviewer demo can use live production-scored posts across science, data science, software development, and open source without relying on a thin novelty corpus.

## Method

- Production host: `corgi-vps`.
- Window: the most recent 72 hours.
- Operation: read-only PostgreSQL queries; no feed, governance, post, score, or Redis state was mutated.
- Candidate rule: active-epoch scored, non-deleted posts whose `topic_vector` contains at least one of:
  - `science-research`
  - `data-science`
  - `software-development`
  - `open-source`
- Cross-topic rule: a post contains at least two target topic keys.
- Resource guard: the final query disabled parallel gather and used `work_mem=4MB` after an earlier parallel query encountered a PostgreSQL shared-memory allocation error. This is an operational capacity warning, not a demo-supply failure.

## Results

| Measure | 72-hour result | Approximate daily rate |
| --- | ---: | ---: |
| All ingested posts | 534,522 | 178,174 |
| Active-epoch scored posts | 534,361 | 178,120 |
| Open Science Builders candidates | 84,831 | 28,277 |
| Candidate authors | 46,652 | 15,551 |
| Posts matching at least two target topics | 2,274 | 758 |
| Top-author concentration | 1.7% | n/a |

Topic-level supply:

| Topic | Posts | Unique authors |
| --- | ---: | ---: |
| `science-research` | 45,562 | 27,797 |
| `software-development` | 30,515 | 18,467 |
| `data-science` | 7,754 | 4,830 |
| `open-source` | 3,363 | 2,252 |

All 534,522 posts in the measured ingestion window had a topic vector. Within the Open Science Builders candidate set, 2.7 percent matched at least two target topics.

## Decision

Open Science Builders is the primary live shadow-demo community. It has enough active, scored, author-diverse supply to freeze a high-quality session corpus while still presenting conflicts among recency, engagement, bridging, source diversity, relevance, and topic intent.

Birders Who Code remains useful as a future secondary feed and product-education example, but its strict bird-plus-code scout produced 54 candidates/day and 4.67 strong bridge posts/day. That narrower supply makes it a less reliable primary reviewer path during the current submission closeout.

## Claim Boundary

This evidence supports a production-sourced, session-frozen shadow demo. It does not establish a published Open Science Builders Bluesky feed, real human community preference distributions, Sybil resistance, or external validity for the synthetic electorate.
