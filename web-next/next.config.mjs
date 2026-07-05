/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'export',
  outputFileTracingRoot: import.meta.dirname,
  trailingSlash: true,
  images: {
    unoptimized: true,
  },
}

export default nextConfig
