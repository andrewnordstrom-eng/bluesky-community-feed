/**
 * Generate Static OpenAPI Spec
 *
 * Starts the server, fetches the generated OpenAPI JSON from /api/openapi.json,
 * optionally strips admin-only routes, and writes the result to a static file.
 *
 * Usage:
 *   npx tsx scripts/generate-openapi.ts                    # full spec
 *   npx tsx scripts/generate-openapi.ts --public-only      # strip admin routes
 *   npx tsx scripts/generate-openapi.ts --output spec.json # custom output path
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ADMIN_TAGS = new Set(['Admin', 'Export']);
const DEFAULT_OUTPUT = path.resolve(process.cwd(), 'docs', 'openapi.json');

interface OpenApiSpec {
  paths: Record<string, Record<string, { tags?: string[] }>>;
  [key: string]: unknown;
}

export async function runWithOpenApiCleanup<T>(
  operation: () => Promise<T>,
  cleanupOperations: readonly (() => Promise<unknown>)[],
  reportCleanupFailure: (error: AggregateError) => void
): Promise<T> {
  const outcome = await operation().then(
    (value) => ({ ok: true as const, value }),
    (error: unknown) => ({ ok: false as const, error })
  );
  const cleanupResults = await Promise.allSettled(
    cleanupOperations.map((cleanup) => Promise.resolve().then(cleanup))
  );
  const cleanupFailures = cleanupResults
    .filter((result): result is PromiseRejectedResult => result.status === 'rejected')
    .map((result) => result.reason);
  const cleanupError = cleanupFailures.length > 0
    ? new AggregateError(cleanupFailures, 'OpenAPI generator cleanup failed')
    : null;

  if (!outcome.ok) {
    if (cleanupError) reportCleanupFailure(cleanupError);
    throw outcome.error;
  }
  if (cleanupError) throw cleanupError;
  return outcome.value;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const publicOnly = args.includes('--public-only');
  const outputIdx = args.indexOf('--output');
  const outputPath = outputIdx !== -1 && args[outputIdx + 1]
    ? path.resolve(args[outputIdx + 1])
    : DEFAULT_OUTPUT;

  // Dynamically import the server builder to avoid top-level side effects
  const { createServer } = await import('../src/feed/server.js');
  const app = await createServer();

  await runWithOpenApiCleanup(async () => {
    // Start listening on a random port
    await app.listen({ port: 0, host: '127.0.0.1' });
    const response = await app.inject({
      method: 'GET',
      url: '/api/openapi.json',
    });

    if (response.statusCode !== 200) {
      throw new Error(`Failed to fetch spec: HTTP ${response.statusCode}`);
    }

    let spec: OpenApiSpec = JSON.parse(response.body);

    if (publicOnly) {
      spec = stripAdminRoutes(spec);
    }

    // Ensure output directory exists
    const outputDir = path.dirname(outputPath);
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    fs.writeFileSync(outputPath, JSON.stringify(spec, null, 2) + '\n');

    const routeCount = Object.values(spec.paths).reduce(
      (sum, methods) => sum + Object.keys(methods).length,
      0
    );

    console.log(`OpenAPI spec written to ${outputPath}`);
    console.log(`  Routes: ${routeCount}`);
    console.log(`  Mode: ${publicOnly ? 'public-only' : 'full'}`);
  }, [
    () => app.close(),
    () => import('../src/db/client.js').then(({ db }) => db.end()),
    () => import('../src/db/redis.js').then(({ redis }) => redis.quit()),
  ], (cleanupError) => {
    console.error('OpenAPI generator cleanup also failed after the primary error:', cleanupError);
  });
}

function stripAdminRoutes(spec: OpenApiSpec): OpenApiSpec {
  const filtered = { ...spec, paths: { ...spec.paths } };

  for (const [routePath, methods] of Object.entries(filtered.paths)) {
    const filteredMethods: Record<string, unknown> = {};

    for (const [method, details] of Object.entries(methods)) {
      const tags = (details as { tags?: string[] }).tags ?? [];
      const isAdmin = tags.some((tag) => ADMIN_TAGS.has(tag));
      if (!isAdmin) {
        filteredMethods[method] = details;
      }
    }

    if (Object.keys(filteredMethods).length === 0) {
      delete filtered.paths[routePath];
    } else {
      filtered.paths[routePath] = filteredMethods as Record<string, { tags?: string[] }>;
    }
  }

  return filtered;
}

const isEntrypoint = process.argv[1] !== undefined
  && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isEntrypoint) {
  main().catch((err) => {
    console.error('Fatal error:', err);
    process.exit(1);
  });
}
