/**
 * Embedding Model Loader
 *
 * Manages the all-MiniLM-L6-v2 sentence embedding model via Transformers.js.
 * Provides batch embedding and cosine similarity for the Tier 2 topic classifier.
 *
 * The model outputs 384-dimensional normalized vectors. Since they're pre-normalized,
 * cosine similarity reduces to a simple dot product.
 *
 * Performance: ~20ms per text on CPU, ~23MB model (q8 quantized).
 */

import { pipeline, type FeatureExtractionPipeline } from '@huggingface/transformers';
import { logger } from '../../lib/logger.js';

/** ONNX-optimized sentence transformer (Apache 2.0 license). */
const MODEL_ID = 'Xenova/all-MiniLM-L6-v2';

/** Embedding dimensionality for all-MiniLM-L6-v2. */
export const EMBEDDING_DIM = 384;

/** Maximum texts per batch to control memory usage. */
const BATCH_SIZE = 32;

let extractor: FeatureExtractionPipeline | null = null;

/**
 * Initialize the embedding model. Call once at startup.
 * First call downloads ~23MB ONNX model (cached thereafter).
 * Subsequent calls return immediately.
 */
export async function initEmbedder(): Promise<void> {
  if (extractor) return;

  const startMs = Date.now();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Transformers.js pipeline() returns a complex union type
  extractor = await (pipeline as any)('feature-extraction', MODEL_ID, {
    dtype: 'q8',
  }) as FeatureExtractionPipeline;
  const elapsed = Date.now() - startMs;

  logger.info({ model: MODEL_ID, elapsed_ms: elapsed }, 'Embedding model loaded');
}

/**
 * Check whether the embedding model is loaded and ready.
 */
export function isEmbedderReady(): boolean {
  return extractor !== null;
}

/**
 * Embed a batch of texts. Returns array of 384-dim Float32Arrays.
 *
 * Processes in sub-batches of 32 to control memory. Each text is
 * mean-pooled and L2-normalized by the model pipeline.
 *
 * @param texts - Array of strings to embed
 * @returns Array of normalized 384-dim Float32Arrays (one per input text)
 * @throws If embedder is not initialized
 */
export async function embedTexts(texts: string[]): Promise<Float32Array[]> {
  if (!extractor) {
    throw new Error('Embedder not initialized. Call initEmbedder() first.');
  }

  const results: Float32Array[] = [];

  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const batch = texts.slice(i, i + BATCH_SIZE);
    const output = await extractor(batch, { pooling: 'mean', normalize: true });
    const embeddings = output.tolist() as number[][];

    for (const emb of embeddings) {
      results.push(new Float32Array(emb));
    }
  }

  return results;
}

/**
 * Compute cosine similarity between two normalized vectors.
 *
 * Since all-MiniLM-L6-v2 outputs L2-normalized vectors,
 * cosine similarity is equivalent to the dot product.
 *
 * @param a - First normalized vector (384-dim)
 * @param b - Second normalized vector (384-dim)
 * @returns Similarity score between -1.0 and 1.0
 */
export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  let dot = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
  }
  return dot;
}
