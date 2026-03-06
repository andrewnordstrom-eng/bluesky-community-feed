/**
 * Route Generator
 *
 * Scaffolds a new API route with Zod validation, AppError handling,
 * JSDoc, and proper Fastify patterns.
 *
 * Usage: npx tsx scripts/generate-route.ts <routeName> [method]
 *
 * Example: npx tsx scripts/generate-route.ts user-preferences GET
 *   Creates: src/feed/routes/user-preferences.ts
 *
 * Example: npx tsx scripts/generate-route.ts submit-feedback POST
 *   Creates: src/feed/routes/submit-feedback.ts
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

function toCamelCase(name: string): string {
  return name.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
}

function toPascalCase(name: string): string {
  const camel = toCamelCase(name);
  return camel.charAt(0).toUpperCase() + camel.slice(1);
}

function toTitleCase(name: string): string {
  return name
    .split('-')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

function generateGetRoute(kebabName: string, pascalName: string, titleName: string, registerFn: string): string {
  return `/**
 * ${titleName} Route
 *
 * GET /api/${kebabName}
 *
 * TODO: Implement route logic.
 */

import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { Errors } from '../../lib/errors.js';
import { logger } from '../../lib/logger.js';

const ${pascalName}QuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

/** JSON Schema for OpenAPI documentation. */
const ${pascalName}QueryJsonSchema = zodToJsonSchema(${pascalName}QuerySchema, {
  target: 'openApi3',
});

/**
 * Register the ${titleName.toLowerCase()} route.
 */
export function ${registerFn}(app: FastifyInstance): void {
  app.get(
    '/api/${kebabName}',
    {
      schema: {
        querystring: ${pascalName}QueryJsonSchema,
      },
    },
    async (request: FastifyRequest) => {
      const parseResult = ${pascalName}QuerySchema.safeParse(request.query);
      if (!parseResult.success) {
        throw Errors.VALIDATION_ERROR(
          'Invalid query parameters',
          parseResult.error.issues
        );
      }

      const { limit } = parseResult.data;

      logger.info({ limit }, '${titleName} request');

      // TODO: Implement route logic
      return { data: [], total: 0 };
    }
  );
}
`;
}

function generatePostRoute(kebabName: string, pascalName: string, titleName: string, registerFn: string): string {
  return `/**
 * ${titleName} Route
 *
 * POST /api/${kebabName}
 *
 * TODO: Implement route logic.
 */

import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { Errors } from '../../lib/errors.js';
import { logger } from '../../lib/logger.js';

const ${pascalName}BodySchema = z.object({
  // TODO: Define request body schema
});

/** JSON Schema for OpenAPI documentation. */
const ${pascalName}BodyJsonSchema = zodToJsonSchema(${pascalName}BodySchema, {
  target: 'openApi3',
});

/**
 * Register the ${titleName.toLowerCase()} route.
 */
export function ${registerFn}(app: FastifyInstance): void {
  app.post(
    '/api/${kebabName}',
    {
      schema: {
        body: ${pascalName}BodyJsonSchema,
      },
    },
    async (request: FastifyRequest) => {
      const parseResult = ${pascalName}BodySchema.safeParse(request.body);
      if (!parseResult.success) {
        throw Errors.VALIDATION_ERROR(
          'Invalid request body',
          parseResult.error.issues
        );
      }

      const data = parseResult.data;

      logger.info({ data }, '${titleName} request');

      // TODO: Implement route logic
      return { success: true };
    }
  );
}
`;
}

function main(): void {
  const rawName = process.argv[2];
  const method = (process.argv[3] ?? 'GET').toUpperCase();

  if (!rawName) {
    console.error('Usage: npx tsx scripts/generate-route.ts <routeName> [GET|POST]');
    console.error('Example: npx tsx scripts/generate-route.ts user-preferences GET');
    process.exit(1);
  }

  if (method !== 'GET' && method !== 'POST') {
    console.error(`Unsupported method: ${method}. Use GET or POST.`);
    process.exit(1);
  }

  const kebabName = rawName.toLowerCase();
  const pascalName = toPascalCase(kebabName);
  const titleName = toTitleCase(kebabName);
  const registerFn = `register${pascalName}`;

  const routePath = path.join(ROOT, 'src/feed/routes', `${kebabName}.ts`);
  if (fs.existsSync(routePath)) {
    console.error(`Route file already exists: ${routePath}`);
    process.exit(1);
  }

  const content = method === 'GET'
    ? generateGetRoute(kebabName, pascalName, titleName, registerFn)
    : generatePostRoute(kebabName, pascalName, titleName, registerFn);

  fs.writeFileSync(routePath, content);
  console.log(`Created: src/feed/routes/${kebabName}.ts`);

  console.log('\n--- Remaining manual steps ---');
  console.log(`1. Import and register in the appropriate router file:`);
  console.log(`   import { ${registerFn} } from './routes/${kebabName}.js';`);
  console.log(`   ${registerFn}(app);`);
  console.log(`2. Implement the route logic`);
  console.log(`3. Run: npm run build && npm test -- --run`);
}

main();
