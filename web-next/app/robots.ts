import type { MetadataRoute } from "next"

export const dynamic = "force-static"

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        // Authenticated/operator surfaces — nothing useful to index there.
        disallow: ["/admin/", "/dashboard/", "/settings/", "/research-consent/"],
      },
    ],
    sitemap: "https://feed.corgi.network/sitemap.xml",
  }
}
