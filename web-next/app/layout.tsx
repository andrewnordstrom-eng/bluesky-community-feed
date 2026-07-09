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

export const metadata: Metadata = {
  title: "Corgi — Your community runs the feed.",
  description:
    "Corgi is a community-governed Bluesky feed with inspectable ranking. Bluesky shows the ordered posts and Corgi shows the receipt.",
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en" className="bg-background">
      <body
        className={`${_plusJakartaSans.variable} ${_inter.variable} ${_ibmPlexMono.variable} font-sans antialiased`}
      >
        <Providers>{children}</Providers>
      </body>
    </html>
  )
}
