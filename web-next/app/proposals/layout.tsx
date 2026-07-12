import type { Metadata } from "next"

export const metadata: Metadata = {
  title: "Proposals — how governance rounds reshape the feed | Corgi",
  description:
    "Each governance round is a proposal to reweight Corgi's Bluesky feed. See the current round and every enacted policy.",
  alternates: { canonical: "/proposals/" },
}

export default function ProposalsLayout({ children }: { children: React.ReactNode }) {
  return children
}
