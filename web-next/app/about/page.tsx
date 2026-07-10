import type { Metadata } from "next"
import { AppShell } from "@/components/app-shell"
import { LegalLayout, P, UL, LI, Strong, InlineLink } from "@/components/legal-layout"

export const metadata: Metadata = {
  title: "About Corgi — who runs it and how it's governed",
  description:
    "Corgi is an open-source, community-governed Bluesky feed. Learn who operates it, how the feed is governed, and what happens to your vote and your account.",
}

// NOTE: first-pass copy — edit the [DRAFT] specifics (stewardship, funding, team).
const SECTIONS = [
  {
    id: "mission",
    heading: "Why Corgi exists",
    body: (
      <>
        <P>
          Most feeds rank for engagement. The loudest, most viral post wins — even when it&rsquo;s a weak match for the
          people actually in the room. Corgi is a bet on a different idea: that a community should be able to decide,
          together and in the open, what its own feed rewards.
        </P>
        <P>
          Corgi is a <Strong>community-governed feed for Bluesky</Strong>. Members vote on how much each ranking signal
          matters, the feed reranks accordingly, and every post carries a receipt showing exactly why it landed where it
          did. Bluesky renders the ordered posts; Corgi shows the math.
        </P>
      </>
    ),
  },
  {
    id: "who",
    heading: "Who runs Corgi",
    body: (
      <>
        <P>
          Corgi is an <Strong>independent, open-source project</Strong> — not an ad-funded company. The ranking engine,
          the governance pipeline, and this site are all developed in the open on{" "}
          <InlineLink href="https://github.com/andrewnordstrom-eng/bluesky-community-feed">GitHub</InlineLink>, so anyone
          can read the code that decides the order.
          {/* TODO: name the maintainer(s)/org and any funding or affiliations once confirmed. */}
        </P>
        <P>
          There are no ads, and we don&rsquo;t sell or rent your data. If that ever changes, it will be announced in the
          open and reflected here first.
        </P>
      </>
    ),
  },
  {
    id: "governance",
    heading: "How the feed is governed",
    body: (
      <>
        <P>The governance loop is deliberately simple and auditable:</P>
        <UL>
          <LI><Strong>Propose &amp; vote</Strong> — during an open round, members set weights for five signals: recency, engagement, bridging, source diversity, and topic relevance.</LI>
          <LI><Strong>Aggregate</Strong> — votes are combined with a trimmed mean (outliers on each end are dropped) so no single voter can swing the feed.</LI>
          <LI><Strong>Apply</Strong> — when the round closes, the aggregated weights become the next <Strong>epoch</Strong>, and the live feed reranks.</LI>
          <LI><Strong>Record</Strong> — every weight change and operator action is written to an append-only audit log that anyone can inspect.</LI>
        </UL>
        <P>
          You can watch this happen on the <InlineLink href="/how-it-works">how-it-works</InlineLink> page, or inspect the
          live feed and receipts on the <InlineLink href="/demo">demo</InlineLink>.
        </P>
      </>
    ),
  },
  {
    id: "principles",
    heading: "The principles we hold ourselves to",
    body: (
      <>
        <UL>
          <LI><Strong>Inspectable by default</Strong> — the ranking weights, the per-post score breakdowns, and the audit log are always public.</LI>
          <LI><Strong>Your vote is private, the outcome is public</Strong> — individual votes are never exposed; only the aggregated result is.</LI>
          <LI><Strong>Open source</Strong> — the implementation is public so the community can verify, fork, and improve it.</LI>
          <LI><Strong>No dark patterns</Strong> — no ads, no engagement bait, no selling data.</LI>
        </UL>
      </>
    ),
  },
  {
    id: "your-account",
    heading: "Your account and your data",
    body: (
      <>
        <P>
          Corgi connects through a Bluesky <Strong>app password</Strong> — a scoped credential you generate in Bluesky.
          We never receive your main password, and you can revoke access at any time from your Bluesky settings.
        </P>
        <P>
          We collect only what&rsquo;s needed to run governance: your Bluesky handle/DID, your vote preferences, and your
          research-consent status. Full details are in the{" "}
          <InlineLink href="/privacy">Privacy Policy</InlineLink>.
        </P>
      </>
    ),
  },
  {
    id: "contact",
    heading: "Get involved",
    body: (
      <>
        <P>
          Read the code, open an issue, or suggest a change on{" "}
          <InlineLink href="https://github.com/andrewnordstrom-eng/bluesky-community-feed">GitHub</InlineLink>. Questions
          or feedback: <InlineLink href="mailto:hello@corgi.network">hello@corgi.network</InlineLink>.
          {/* TODO: confirm the contact address before launch. */} Ready to try it? See{" "}
          <InlineLink href="/start">how to add the feed in Bluesky</InlineLink>.
        </P>
      </>
    ),
  },
]

export default function AboutPage() {
  return (
    <AppShell user={null}>
      <LegalLayout title="About Corgi" lastUpdated="July 2026" sections={SECTIONS} backHref="/" backLabel="Back to home" />
    </AppShell>
  )
}
