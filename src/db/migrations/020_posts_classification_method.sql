-- Migration 020: Track classification method on posts
--
-- The embedding classifier runs at ingestion time and replaces keyword-based
-- topic vectors with cosine-similarity vectors, but the posts table didn't
-- record which method produced the topic_vector. The scoring pipeline was
-- forced to hardcode 'keyword' for every post_scores row.
--
-- This column lets the pipeline read the actual classification method and
-- store it accurately in post_scores.

ALTER TABLE posts ADD COLUMN IF NOT EXISTS classification_method TEXT DEFAULT 'keyword';

CREATE INDEX IF NOT EXISTS idx_posts_classification_method
  ON posts(classification_method)
  WHERE classification_method IS NOT NULL;
