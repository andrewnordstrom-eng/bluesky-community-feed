import type { Metadata } from "next"

export const metadata: Metadata = {
  title: "Governance ledger — every epoch, weight change, and audit event | Corgi",
  description:
    "The full public record of Corgi's feed governance: applied ranking weights per round, content-rule changes, and the append-only audit log.",
  alternates: { canonical: "/history/" },
}

export default function HistoryLayout({ children }: { children: React.ReactNode }) {
  return children
}
