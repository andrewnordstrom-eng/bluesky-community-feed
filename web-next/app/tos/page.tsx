import type { Metadata } from "next"
import { AppShell } from "@/components/app-shell"
import { LegalLayout, P, UL, LI, Strong, InlineLink } from "@/components/legal-layout"

export const metadata: Metadata = {
  title: "Terms of Service | Corgi",
  description:
    "The terms that govern using Corgi, the community-governed Bluesky feed — eligibility, governance participation, research consent, and prohibited conduct.",
  alternates: { canonical: "/tos/" },
}

const SECTIONS = [
  {
    id: "acceptance",
    heading: "Acceptance of terms",
    body: (
      <>
        <P>By accessing or using Corgi (the &ldquo;Service&rdquo;), you agree to be bound by these Terms of Service. If you do not agree, do not use the Service.</P>
        <P>Corgi is a community-governed Bluesky feed operated by the Corgi project. Your participation in feed governance (voting, research consent) is entirely voluntary and does not affect your ability to view the feed.</P>
      </>
    ),
  },
  {
    id: "eligibility",
    heading: "Eligibility",
    body: (
      <>
        <P>You must have a valid Bluesky account to participate in feed governance. You connect via an app-specific password — Corgi never receives your main Bluesky password.</P>
        <P>App passwords are revocable at any time from your Bluesky account settings. Revoking access immediately terminates your active session with Corgi.</P>
      </>
    ),
  },
  {
    id: "governance",
    heading: "Feed governance participation",
    body: (
      <>
        <P>When you cast a vote, you provide weight preferences across five signals (Recency, Engagement, Bridging, Source diversity, Relevance) and optional topic and keyword preferences.</P>
        <UL>
          <LI>Votes are aggregated across all participants. No individual vote is exposed publicly.</LI>
          <LI>You may update your vote at any time while a round is open.</LI>
          <LI>Governance rounds are time-limited. Once closed, votes for that round cannot be modified.</LI>
          <LI>Corgi operators may apply weight overrides in exceptional circumstances. All such actions are recorded in the public audit log.</LI>
        </UL>
      </>
    ),
  },
  {
    id: "research",
    heading: "Research participation",
    body: (
      <>
        <P>Separately from feed governance, you may choose to participate in academic research studying community-governed recommendation systems. Research participation is <Strong>entirely optional</Strong> and separate from your ability to vote or view the feed.</P>
        <P>If you consent, anonymised interaction patterns may be shared with research partners. You may withdraw consent at any time by contacting <InlineLink href="mailto:hello@corgi.network">hello@corgi.network</InlineLink>.</P>
      </>
    ),
  },
  {
    id: "prohibited",
    heading: "Prohibited conduct",
    body: (
      <>
        <P>You agree not to:</P>
        <UL>
          <LI>Attempt to manipulate governance outcomes through coordinated inauthentic voting.</LI>
          <LI>Reverse-engineer, scrape, or systematically extract data from the Service beyond what is provided through public API endpoints.</LI>
          <LI>Use the Service for any unlawful purpose.</LI>
          <LI>Submit keywords or content preferences designed to harass or target specific individuals.</LI>
        </UL>
        <P>Corgi operators may suspend or ban accounts found in violation of these terms. Such actions are logged in the public audit trail.</P>
      </>
    ),
  },
  {
    id: "transparency",
    heading: "Transparency and the audit log",
    body: (
      <>
        <P>Corgi is built on a &ldquo;no black box&rdquo; principle. The following information is always publicly accessible:</P>
        <UL>
          <LI>The aggregated weights applied in each governance round.</LI>
          <LI>The full audit log of operator actions (weight overrides, topic changes, keyword changes, round lifecycle events).</LI>
          <LI>Per-post score breakdowns (why any Corgi-scored post ranked as it did).</LI>
        </UL>
        <P>Individual vote data is never exposed. Audit log entries for operator actions include the actor&rsquo;s DID.</P>
      </>
    ),
  },
  {
    id: "disclaimers",
    heading: "Disclaimers and limitation of liability",
    body: (
      <>
        <P>The Service is provided &ldquo;as is&rdquo; without warranty of any kind. Corgi does not guarantee the accuracy, completeness, or availability of the feed at any time.</P>
        <P>To the fullest extent permitted by law, Corgi and its operators shall not be liable for any indirect, incidental, or consequential damages arising from your use of the Service.</P>
      </>
    ),
  },
  {
    id: "changes",
    heading: "Changes to these terms",
    body: (
      <>
        <P>We may update these Terms at any time. Material changes will be announced via the dashboard. Continued use of the Service after changes are posted constitutes acceptance of the revised Terms.</P>
        <P>Questions about these terms? Contact us at <InlineLink href="mailto:hello@corgi.network">hello@corgi.network</InlineLink>.</P>
      </>
    ),
  },
]

export default function TosPage() {
  return (
    <AppShell user={null}>
      <LegalLayout
        title="Terms of Service"
        lastUpdated="27 June 2026"
        sections={SECTIONS}
        backHref="/"
        backLabel="Back to home"
      />
    </AppShell>
  )
}
