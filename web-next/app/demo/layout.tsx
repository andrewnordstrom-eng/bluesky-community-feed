import type { Metadata } from "next"

export const metadata: Metadata = {
  title: "Governance demo — re-rank a Corgi Commons snapshot | Corgi",
  description:
    "Propose a ranking policy, combine it with 24 scripted deterministic voter archetypes, and inspect how a frozen Corgi Commons comparison corpus reorders.",
  alternates: { canonical: "/demo/" },
}

export default function DemoLayout({ children }: { children: React.ReactNode }) {
  return children
}
