/**
 * Scoring Component Generator
 *
 * Scaffolds a new scoring component with all required wiring:
 * - Creates src/scoring/components/{name}.ts from template
 * - Inserts import + component entry in registry.ts
 * - Inserts param entry in votable-params.ts
 *
 * Usage: npx tsx scripts/generate-scoring-component.ts <componentName>
 *
 * Example: npx tsx scripts/generate-scoring-component.ts sentiment
 *   Creates: src/scoring/components/sentiment.ts
 *   Updates: src/scoring/registry.ts, src/config/votable-params.ts
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

function toCamelCase(name: string): string {
  return name.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
}

function toKebabCase(name: string): string {
  return name.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase();
}

function toPascalCase(name: string): string {
  const camel = toCamelCase(name);
  return camel.charAt(0).toUpperCase() + camel.slice(1);
}

function toSnakeCase(name: string): string {
  return name.replace(/([a-z])([A-Z])/g, '$1_$2').toLowerCase();
}

function toTitleCase(name: string): string {
  return toKebabCase(name)
    .split('-')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

function generateComponentFile(camelName: string, pascalName: string, titleName: string): string {
  return `/**
 * ${titleName} Scoring Component
 *
 * TODO: Implement scoring logic.
 * Must return a value between 0.0 and 1.0.
 */

import type { PostForScoring } from '../score.types.js';
import type { ScoringComponent, ScoringContext } from '../component.interface.js';

/**
 * Calculate ${titleName.toLowerCase()} score for a post.
 *
 * @param _post - The post to score
 * @param _context - Shared scoring context (epoch, author counts, etc.)
 * @returns Score between 0.0 and 1.0
 */
export function score${pascalName}(_post: PostForScoring, _context: ScoringContext): number {
  // TODO: Implement scoring logic
  return 0.5;
}

/** ScoringComponent wrapper for the ${titleName.toLowerCase()} scorer. */
export const ${camelName}Component: ScoringComponent = {
  key: '${camelName}',
  name: '${titleName}',
  async score(post, context) {
    return score${pascalName}(post, context);
  },
};
`;
}

function insertAtAnchor(filePath: string, anchor: string, insertion: string): void {
  const content = fs.readFileSync(filePath, 'utf-8');
  if (!content.includes(anchor)) {
    console.error(`Anchor "${anchor}" not found in ${filePath}`);
    process.exit(1);
  }
  const updated = content.replace(anchor, `${insertion}\n${anchor}`);
  fs.writeFileSync(filePath, updated);
}

function main(): void {
  const rawName = process.argv[2];
  if (!rawName) {
    console.error('Usage: npx tsx scripts/generate-scoring-component.ts <componentName>');
    console.error('Example: npx tsx scripts/generate-scoring-component.ts sentiment');
    process.exit(1);
  }

  const camelName = toCamelCase(rawName);
  const kebabName = toKebabCase(rawName);
  const pascalName = toPascalCase(rawName);
  const snakeName = toSnakeCase(rawName);
  const titleName = toTitleCase(rawName);

  // 1. Create the component file
  const componentPath = path.join(ROOT, 'src/scoring/components', `${kebabName}.ts`);
  if (fs.existsSync(componentPath)) {
    console.error(`Component file already exists: ${componentPath}`);
    process.exit(1);
  }
  fs.writeFileSync(componentPath, generateComponentFile(camelName, pascalName, titleName));
  console.log(`Created: src/scoring/components/${kebabName}.ts`);

  // 2. Update registry.ts — add import and component entry
  const registryPath = path.join(ROOT, 'src/scoring/registry.ts');

  insertAtAnchor(
    registryPath,
    '// GENERATOR_IMPORT_ANCHOR — do not remove',
    `import { ${camelName}Component } from './components/${kebabName}.js';`
  );

  insertAtAnchor(
    registryPath,
    '  // GENERATOR_COMPONENT_ANCHOR — do not remove',
    `  ${camelName}Component,`
  );

  console.log('Updated: src/scoring/registry.ts');

  // 3. Update votable-params.ts — add param entry
  const votableParamsPath = path.join(ROOT, 'src/config/votable-params.ts');

  insertAtAnchor(
    votableParamsPath,
    '  // GENERATOR_PARAM_ANCHOR — do not remove',
    `  {
    key: '${camelName}',
    voteField: '${snakeName}_weight',
    label: '${titleName}',
    description: 'TODO: Add description',
    min: 0,
    max: 1,
    defaultValue: 0.1,
  },`
  );

  console.log('Updated: src/config/votable-params.ts');

  // 4. Print reminders
  console.log('\n--- Remaining manual steps ---');
  console.log(`1. Add '${camelName}' to GovernanceWeightKey union in src/shared/api-types.ts`);
  console.log(`2. Add '${snakeName}_weight' to VotableWeightParam.voteField union in src/config/votable-params.ts`);
  console.log(`3. Add '${camelName}' field to GovernanceWeights interface in src/shared/api-types.ts`);
  console.log(`4. Add matching entry to web/src/config/votable-params.ts`);
  console.log(`5. Create DB migration: ALTER TABLE post_scores ADD COLUMN ${snakeName}_raw REAL, ${snakeName}_weight REAL, ${snakeName}_weighted REAL`);
  console.log(`6. ALTER TABLE governance_epochs ADD COLUMN ${snakeName}_weight REAL DEFAULT 0.1`);
  console.log(`7. Run: npm run build && npm test -- --run`);
}

main();
