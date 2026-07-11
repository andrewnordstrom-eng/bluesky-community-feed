import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Fastify from 'fastify';
import helmet from '@fastify/helmet';
import fastifyStatic from '@fastify/static';
import { afterEach, describe, expect, it } from 'vitest';
import { applyStaticExportResponseHeaders } from '../src/feed/static-export-headers.js';

const HTML_ACCEPT = 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8';
const HTML_SCRIPT_POLICY = "script-src 'self' 'unsafe-inline'";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map(async (directory) => {
      await rm(directory, { force: true, recursive: true });
    }),
  );
});

describe('static-export response headers', () => {
  it('preserves the HTML CSP and cache policy on conditional 304 responses', async () => {
    const webDistDir = await mkdtemp(join(tmpdir(), 'corgi-static-export-'));
    temporaryDirectories.push(webDistDir);
    await writeFile(
      join(webDistDir, 'index.html'),
      '<!doctype html><html><body><main>Corgi</main><script>self.__next_f=[]</script></body></html>',
      'utf8',
    );

    const app = Fastify({ logger: false });
    await app.register(helmet, {
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
        },
      },
    });
    await app.register(fastifyStatic, {
      root: webDistDir,
      prefix: '/',
      wildcard: false,
    });
    app.addHook('onSend', async (request, reply) => {
      applyStaticExportResponseHeaders(request, reply);
    });
    await app.ready();

    try {
      const initial = await app.inject({
        method: 'GET',
        url: '/',
        headers: { accept: HTML_ACCEPT },
      });

      expect(initial.statusCode).toBe(200);
      expect(initial.headers['content-security-policy']).toContain(HTML_SCRIPT_POLICY);
      expect(initial.headers['cache-control']).toBe('no-cache');
      expect(initial.headers.etag).toBeTypeOf('string');

      const conditional = await app.inject({
        method: 'GET',
        url: '/',
        headers: {
          accept: HTML_ACCEPT,
          'if-none-match': initial.headers.etag as string,
        },
      });

      expect(conditional.statusCode).toBe(304);
      expect(conditional.headers['content-security-policy']).toContain(HTML_SCRIPT_POLICY);
      expect(conditional.headers['cache-control']).toBe('no-cache');
    } finally {
      await app.close();
    }
  });
});
