import { AppShell } from "@/components/app-shell"
import { LegalLayout } from "@/components/legal-layout"
import { getLegalDocument } from "@/lib/legal-docs"

export default function PrivacyPage() {
  const legalDoc = getLegalDocument("privacy")

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
