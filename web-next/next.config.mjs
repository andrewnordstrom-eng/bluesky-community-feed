import { fileURLToPath } from 'node:url'
import { dirname } from 'node:path'

// Pin the workspace root to this app. The monorepo has several package-lock.json
// files (root, web-next, web, cli), so Next otherwise infers the wrong root, which
// destabilizes dev module/CSS chunk resolution (the "/_app" + "./331.js" errors).
const appDir = dirname(fileURLToPath(import.meta.url))

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'export',
  trailingSlash: true,
  outputFileTracingRoot: appDir,
  turbopack: {
    root: appDir,
  },
  eslint: {
    ignoreDuringBuilds: true,
  },
  typescript: {
    ignoreBuildErrors: true,
  },
  images: {
    unoptimized: true,
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'cdn.bsky.app',
      },
    ],
  },
}

export default nextConfig
