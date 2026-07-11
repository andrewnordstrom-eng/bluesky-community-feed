import type { FastifyReply, FastifyRequest } from 'fastify';

const STATIC_EXPORT_HTML_CSP = [
  "default-src 'self'",
  "base-uri 'self'",
  "frame-ancestors 'none'",
  "object-src 'none'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: https:",
  "font-src 'self' data: https:",
  "connect-src 'self' https: wss:",
  "form-action 'self'",
  "script-src-attr 'none'",
  "upgrade-insecure-requests",
].join('; ');

function acceptsHtml(request: FastifyRequest): boolean {
  return request.headers.accept
    ?.split(',')
    .some((mediaRange) => mediaRange.trim().split(';', 1)[0].toLowerCase() === 'text/html') ?? false;
}

export function applyStaticExportResponseHeaders(
  request: FastifyRequest,
  reply: FastifyReply,
): void {
  if (request.url.startsWith('/_next/static/')) {
    reply.header('cache-control', 'public, max-age=31536000, immutable');
  }

  const contentType = reply.getHeader('content-type');
  const isHtmlResponse = typeof contentType === 'string' && contentType.startsWith('text/html');
  const isRevalidatedHtml = reply.statusCode === 304 && acceptsHtml(request);
  if (isHtmlResponse || isRevalidatedHtml) {
    reply.header('cache-control', 'no-cache');
    reply.header('content-security-policy', STATIC_EXPORT_HTML_CSP);
  }
}
