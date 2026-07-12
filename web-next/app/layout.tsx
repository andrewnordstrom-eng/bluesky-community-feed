import type { Metadata } from "next"
import { Plus_Jakarta_Sans, Inter, IBM_Plex_Mono } from "next/font/google"
import { Providers } from "@/components/providers"
import "./globals.css"

const _plusJakartaSans = Plus_Jakarta_Sans({
  subsets: ["latin"],
  weight: ["600", "700", "800"],
  variable: "--font-display",
})

const _inter = Inter({ subsets: ["latin"], variable: "--font-sans" })

const _ibmPlexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-mono",
})

const SITE_URL = "https://feed.corgi.network"
const SITE_TITLE = "Corgi — Your community runs the feed."
const SITE_DESCRIPTION =
  "Corgi is a community-governed Bluesky feed with inspectable ranking. Bluesky shows the ordered posts and Corgi shows the receipt."

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: SITE_TITLE,
  description: SITE_DESCRIPTION,
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    siteName: "Corgi",
    url: "/",
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
    images: [
      {
        url: "/images/og/og-card.png",
        width: 1200,
        height: 630,
        alt: "Corgi — a community-governed Bluesky feed with inspectable ranking",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
    images: ["/images/og/og-card.png"],
  },
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    // suppressHydrationWarning: next-themes writes the theme class + color-scheme
    // onto <html> on the client, which intentionally differs from SSR. Required by
    // next-themes; shallow (one level), so real hydration bugs elsewhere still warn.
    <html lang="en" className="bg-background" suppressHydrationWarning>
      <body
        className={`${_plusJakartaSans.variable} ${_inter.variable} ${_ibmPlexMono.variable} font-sans antialiased`}
      >
        <Providers>{children}</Providers>
      </body>
    </html>
  )
}
