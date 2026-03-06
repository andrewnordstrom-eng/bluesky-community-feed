import { beforeEach, describe, expect, it, vi } from 'vitest';

// --- Mocks (vi.hoisted runs before imports) ---
const { dbQueryMock } = vi.hoisted(() => ({
  dbQueryMock: vi.fn(),
}));

vi.mock('../src/db/client.js', () => ({
  db: {
    query: dbQueryMock,
  },
}));

vi.mock('../src/lib/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

import {
  loadTaxonomy,
  getTaxonomy,
  invalidateTaxonomyCache,
  isTaxonomyCacheStale,
} from '../src/scoring/topics/taxonomy.js';

const MOCK_TOPICS = [
  {
    slug: 'ai-machine-learning',
    name: 'AI & Machine Learning',
    description: 'Artificial intelligence and ML',
    parent_slug: null,
    terms: ['AI', 'machine learning', 'LLM'],
    context_terms: ['dataset', 'training'],
    anti_terms: ['artificial turf'],
  },
  {
    slug: 'dogs-pets',
    name: 'Dogs & Pets',
    description: 'Dogs and other pets',
    parent_slug: null,
    terms: ['dog', 'puppy', 'corgi'],
    context_terms: ['walk', 'treat'],
    anti_terms: ['pet peeve'],
  },
];

describe('taxonomy module', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    invalidateTaxonomyCache();
  });

  it('throws when getTaxonomy is called before loadTaxonomy', () => {
    expect(() => getTaxonomy()).toThrow('Topic taxonomy not loaded');
  });

  it('loads topics from database and caches them', async () => {
    dbQueryMock.mockResolvedValue({ rows: MOCK_TOPICS });

    const topics = await loadTaxonomy();

    expect(topics).toHaveLength(2);
    expect(topics[0].slug).toBe('ai-machine-learning');
    expect(topics[0].terms).toEqual(['AI', 'machine learning', 'LLM']);
    expect(topics[0].contextTerms).toEqual(['dataset', 'training']);
    expect(topics[0].antiTerms).toEqual(['artificial turf']);
    expect(topics[0].parentSlug).toBeNull();

    // Should have queried the DB
    expect(dbQueryMock).toHaveBeenCalledOnce();
    expect(dbQueryMock.mock.calls[0][0]).toContain('SELECT slug');
    expect(dbQueryMock.mock.calls[0][0]).toContain('WHERE is_active = TRUE');
  });

  it('returns cached topics from getTaxonomy after loadTaxonomy', async () => {
    dbQueryMock.mockResolvedValue({ rows: MOCK_TOPICS });

    await loadTaxonomy();
    const cached = getTaxonomy();

    expect(cached).toHaveLength(2);
    expect(cached[0].slug).toBe('ai-machine-learning');
    expect(cached[1].slug).toBe('dogs-pets');
  });

  it('invalidates cache correctly', async () => {
    dbQueryMock.mockResolvedValue({ rows: MOCK_TOPICS });

    await loadTaxonomy();
    expect(() => getTaxonomy()).not.toThrow();

    invalidateTaxonomyCache();
    expect(() => getTaxonomy()).toThrow('Topic taxonomy not loaded');
  });

  it('reports cache as stale before loading', () => {
    expect(isTaxonomyCacheStale()).toBe(true);
  });

  it('reports cache as fresh after loading', async () => {
    dbQueryMock.mockResolvedValue({ rows: MOCK_TOPICS });

    await loadTaxonomy();
    expect(isTaxonomyCacheStale()).toBe(false);
  });

  it('reports cache as stale after invalidation', async () => {
    dbQueryMock.mockResolvedValue({ rows: MOCK_TOPICS });

    await loadTaxonomy();
    invalidateTaxonomyCache();
    expect(isTaxonomyCacheStale()).toBe(true);
  });

  it('handles empty topic catalog', async () => {
    dbQueryMock.mockResolvedValue({ rows: [] });

    const topics = await loadTaxonomy();
    expect(topics).toHaveLength(0);

    const cached = getTaxonomy();
    expect(cached).toHaveLength(0);
  });
});
