import type { Metadata } from "next"
import { Plus_Jakarta_Sans, Inter, IBM_Plex_Mono } from "next/font/google"
import { Analytics } from "@vercel/analytics/react"
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
    "Corgi is a Bluesky feed with no hidden algorithm. Your community votes on how posts rank, and anyone can see exactly why a post showed up.",
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
        {children}
        {process.env.NODE_ENV === "production" && <Analytics />}
      </body>
    </html>
  )
}
