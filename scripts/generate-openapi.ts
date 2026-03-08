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

const ADMIN_TAGS = new Set(['Admin', 'Export']);
const DEFAULT_OUTPUT = path.resolve(process.cwd(), 'docs', 'openapi.json');

interface OpenApiSpec {
  paths: Record<string, Record<string, { tags?: string[] }>>;
  [key: string]: unknown;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const publicOnly = args.includes('--public-only');
  const outputIdx = args.indexOf('--output');
  const outputPath = outputIdx !== -1 && args[outputIdx + 1]
    ? path.resolve(args[outputIdx + 1])
    : DEFAULT_OUTPUT;

  // Dynamically import the server builder to avoid top-level side effects
  const { buildApp } = await import('../src/feed/server.js');
  const app = await buildApp();

  // Start listening on a random port
  await app.listen({ port: 0, host: '127.0.0.1' });

  try {
    const response = await app.inject({
      method: 'GET',
      url: '/api/openapi.json',
    });

    if (response.statusCode !== 200) {
      console.error(`Failed to fetch spec: HTTP ${response.statusCode}`);
      process.exit(1);
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
  } finally {
    await app.close();
  }
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

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
