import type { Metadata } from "next"

export const metadata: Metadata = {
  title: "Community ballot — vote on the feed's ranking weights | Corgi",
  description:
    "Set how much recency, engagement, bridging, source diversity, and relevance should matter in Corgi's community-governed Bluesky feed.",
  alternates: { canonical: "/vote/" },
}

export default function VoteLayout({ children }: { children: React.ReactNode }) {
  return children
}
