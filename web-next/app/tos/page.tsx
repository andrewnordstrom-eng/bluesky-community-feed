import { AppShell } from "@/components/app-shell"
import { LegalLayout } from "@/components/legal-layout"
import { getLegalDocument } from "@/lib/legal-docs"

export default function TosPage() {
  const legalDoc = getLegalDocument("tos")

  return (
    <AppShell user={null}>
      <LegalLayout
        title={legalDoc.title}
        lastUpdated={legalDoc.lastUpdated}
        sections={legalDoc.sections}
        backHref="/"
        backLabel="Back to home"
      />
    </AppShell>
  )
}
