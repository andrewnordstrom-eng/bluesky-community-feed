import type { Metadata } from "next"
import { AppShell } from "@/components/app-shell"
import { LegalLayout, P, UL, LI, Strong, InlineLink } from "@/components/legal-layout"

export const metadata: Metadata = {
  title: "Corgi support — get help and report issues",
  description: "How to get help with Corgi: contact, bug reports, feature requests, security disclosure, and account help.",
}

const GITHUB_ISSUES = "https://github.com/andrewnordstrom-eng/bluesky-community-feed/issues"
const PRIVATE_SECURITY_REPORT = "https://github.com/andrewnordstrom-eng/bluesky-community-feed/security/advisories/new"
const SUPPORT_EMAIL = "mailto:hello@corgi.network"

const SECTIONS = [
  {
    id: "get-help",
    heading: "Get help",
    body: (
      <>
        <P>The fastest ways to reach us:</P>
        <UL>
          <LI><Strong>Public support</Strong> — email <InlineLink href={SUPPORT_EMAIL}>hello@corgi.network</InlineLink> for product questions, bugs, and feature requests.</LI>
          <LI><Strong>GitHub issues</Strong> — search existing public threads or open a new one at <InlineLink href={GITHUB_ISSUES}>the issue tracker</InlineLink>.</LI>
          <LI><Strong>Security</Strong> — email <InlineLink href={SUPPORT_EMAIL}>hello@corgi.network</InlineLink>, or use <InlineLink href={PRIVATE_SECURITY_REPORT}>GitHub private vulnerability reporting</InlineLink> when it is available to you.</LI>
        </UL>
        <P>
          Many questions are already answered on the <InlineLink href="/#faq-section">FAQ</InlineLink> and in the{" "}
          <InlineLink href="/docs">docs</InlineLink>.
        </P>
      </>
    ),
  },
  {
    id: "report-bug",
    heading: "Report a bug",
    body: (
      <>
        <P>Email <InlineLink href={SUPPORT_EMAIL}>hello@corgi.network</InlineLink> and, where you can, include:</P>
        <UL>
          <LI>What you expected to happen and what actually happened.</LI>
          <LI>The page or feed you were on, and steps to reproduce.</LI>
          <LI>Your browser/OS, and a screenshot if it&rsquo;s visual.</LI>
          <LI>If it involves a specific post&rsquo;s ranking, the post link or its receipt.</LI>
        </UL>
        <P>Please don&rsquo;t include your app password or any credential in a support request.</P>
      </>
    ),
  },
  {
    id: "feature-requests",
    heading: "Feature requests & feedback",
    body: (
      <>
        <P>
          Corgi is community-governed by design, and the roadmap benefits from the same input. Suggest changes to the
          product — or to how governance itself works — at <InlineLink href={SUPPORT_EMAIL}>hello@corgi.network</InlineLink> or on the public <InlineLink href={GITHUB_ISSUES}>GitHub issue tracker</InlineLink>. For
          ranking-policy changes specifically, that&rsquo;s what <InlineLink href="/vote">voting</InlineLink> and{" "}
          <InlineLink href="/proposals">proposals</InlineLink> are for.
        </P>
      </>
    ),
  },
  {
    id: "security",
    heading: "Security disclosure",
    body: (
      <>
        <P>
          Found a security or privacy issue? Email <InlineLink href={SUPPORT_EMAIL}>hello@corgi.network</InlineLink> or use{" "}
          <InlineLink href={PRIVATE_SECURITY_REPORT}>GitHub private vulnerability reporting</InlineLink> when available,
          and give us a reasonable window to fix it before disclosure.
        </P>
      </>
    ),
  },
  {
    id: "account-help",
    heading: "Account help",
    body: (
      <>
        <UL>
          <LI><Strong>Revoke access</Strong> — remove the Corgi app password from your Bluesky settings; Corgi loses access immediately.</LI>
          <LI><Strong>Manage participation</Strong> — see your session, research-consent status, and sign out from your <InlineLink href="/settings">account settings</InlineLink>.</LI>
          <LI><Strong>Data requests</Strong> — see the <InlineLink href="/privacy">Privacy Policy</InlineLink> for access and deletion.</LI>
          <LI><Strong>Sensitive account details</Strong> — do not send credentials, app passwords, or sensitive account identifiers through support requests. Revoke the app password and use the settings and privacy self-service paths above.</LI>
        </UL>
      </>
    ),
  },
]

export default function SupportPage() {
  return (
    <AppShell user={null}>
      <LegalLayout title="Support" lastUpdated="July 2026" sections={SECTIONS} backHref="/" backLabel="Back to home" />
    </AppShell>
  )
}
