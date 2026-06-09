/**
 * Scoring Component Registry
 *
 * Central registry of all scoring components. Validates that every
 * component key matches a votable weight param and vice versa,
 * catching drift between the scoring pipeline and governance config.
 *
 * To add a new scoring component:
 * 1. Implement the ScoringComponent interface in src/scoring/components/
 * 2. Add to DEFAULT_COMPONENTS below
 * 3. Add a corresponding entry in src/config/votable-params.ts
 * 4. Add DB columns for raw/weight/weighted in post_scores
 * 5. The frontend auto-generates sliders from votable-params
 */

import type { ScoringComponent } from './component.interface.js';
import { GOVERNANCE_WEIGHT_KEYS } from '../config/votable-params.js';

import { recencyComponent } from './components/recency.js';
import { engagementComponent } from './components/engagement.js';
import { bridgingComponent } from './components/bridging.js';
import { sourceDiversityComponent } from './components/source-diversity.js';
import { relevanceComponent } from './components/relevance.js';
// GENERATOR_IMPORT_ANCHOR — do not remove

/** All registered scoring components in evaluation order. */
export const DEFAULT_COMPONENTS: readonly ScoringComponent[] = [
  recencyComponent,
  engagementComponent,
  bridgingComponent,
  sourceDiversityComponent,
  relevanceComponent,
  // GENERATOR_COMPONENT_ANCHOR — do not remove
];

/**
 * The canonical set of registered component keys.
 *
 * PROJ-816: surfaced as a Set so the vote route and other callers can do O(1)
 * runtime validation of incoming component keys. Pairs with the type widening
 * of `GovernanceWeightKey` from a literal union to `string` — keys are now
 * validated at runtime rather than at compile time.
 */
export const REGISTERED_COMPONENT_KEYS: ReadonlySet<string> = new Set(
  DEFAULT_COMPONENTS.map((c) => c.key)
);

/**
 * Validate that the registry is consistent with votable-params.
 * Throws if a component key is missing from votable-params or vice versa.
 * Called at module load to catch drift immediately.
 */
export function validateRegistry(components: readonly ScoringComponent[]): void {
  const componentKeys = new Set(components.map((c) => c.key));
  const paramKeys = new Set(GOVERNANCE_WEIGHT_KEYS);

  // Check for duplicate component keys
  if (componentKeys.size !== components.length) {
    const seen = new Set<string>();
    for (const c of components) {
      if (seen.has(c.key)) {
        throw new Error(`Duplicate scoring component key: "${c.key}"`);
      }
      seen.add(c.key);
    }
  }

  // Every component must have a corresponding votable param
  for (const key of componentKeys) {
    if (!paramKeys.has(key)) {
      throw new Error(
        `Scoring component "${key}" has no matching votable weight param`
      );
    }
  }

  // Every votable param must have a corresponding component
  for (const key of paramKeys) {
    if (!componentKeys.has(key)) {
      throw new Error(
        `Votable weight param "${key}" has no matching scoring component`
      );
    }
  }
}

/**
 * The component keys the `post_scores` wide columns (and the `storeScore` writer
 * in src/scoring/pipeline.ts) depend on. PROJ-816 widened `GovernanceWeightKey`
 * to `string`, so a renamed/removed registry key is no longer a compile error;
 * without this guard it would write `undefined` → NULL into a NOT NULL wide
 * column and the post would be silently dropped by `scoreAllPosts`' per-post
 * catch. PROJ-819 (P5) removes the wide columns and this coupling.
 */
export const WIDE_COLUMN_COMPONENT_KEYS: readonly string[] = [
  'recency',
  'engagement',
  'bridging',
  'sourceDiversity',
  'relevance',
];

/**
 * Assert every wide-column key the writer relies on is a registered component,
 * so registry↔wide-column drift fails fast at load instead of silently
 * inserting NULLs (and dropping rows) in production.
 */
export function assertWideColumnsRegistered(
  registeredKeys: ReadonlySet<string> = REGISTERED_COMPONENT_KEYS,
  wideKeys: readonly string[] = WIDE_COLUMN_COMPONENT_KEYS
): void {
  for (const key of wideKeys) {
    if (!registeredKeys.has(key)) {
      throw new Error(
        `post_scores wide column "${key}" has no matching registered scoring ` +
        `component; storeScore would write NULL into a NOT NULL column. ` +
        `Update the registry and the wide columns together.`
      );
    }
  }
}

// Validate at module load to catch drift early
validateRegistry(DEFAULT_COMPONENTS);
assertWideColumnsRegistered();
