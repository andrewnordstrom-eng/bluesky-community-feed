-- Migration 018: Topic Embedding Classifier Support
--
-- Adds infrastructure for the semantic embedding classifier (Tier 2):
-- 1. topic_embedding column on topic_catalog to cache pre-computed topic embeddings
-- 2. classification_method column on post_scores to track which classifier produced each score

-- Cache pre-computed 384-dim topic embeddings (from all-MiniLM-L6-v2).
-- Stored as REAL[] to survive restarts without re-computation.
-- Re-computed when topic terms change or embeddings are invalidated.
ALTER TABLE topic_catalog ADD COLUMN IF NOT EXISTS topic_embedding REAL[];

-- Track which classifier produced each score: "keyword" (winkNLP) or "embedding" (Transformers.js).
-- Critical for research: enables comparison of classifier impact on community dynamics.
ALTER TABLE post_scores ADD COLUMN IF NOT EXISTS classification_method VARCHAR(16) DEFAULT 'keyword';
