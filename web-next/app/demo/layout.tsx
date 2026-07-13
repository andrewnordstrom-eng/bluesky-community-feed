import type { Metadata } from "next"

export const metadata: Metadata = {
  title: "Live demo — re-rank a Community Governed Feed snapshot | Corgi",
  description:
    "Propose a ranking policy, combine it with 24 scripted ballots, and watch a frozen snapshot of Corgi's live Bluesky feed reorder — every move explained by a receipt.",
  alternates: { canonical: "/demo/" },
}

export default function DemoLayout({ children }: { children: React.ReactNode }) {
  return children
}
