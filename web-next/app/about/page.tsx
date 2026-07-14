import type { Metadata } from "next"
import { AppShell } from "@/components/app-shell"
import { LegalLayout, P, UL, LI, Strong, InlineLink } from "@/components/legal-layout"

export const metadata: Metadata = {
  title: "About Corgi — who runs it and how it's governed",
  description:
    "Corgi is an open-source Bluesky feed with inspectable, community-shaped ranking. Learn how the pilot, policy review, and receipts work.",
  alternates: { canonical: "/about/" },
}

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
          Corgi is a <Strong>community-shaped feed for Bluesky</Strong>. During the limited pilot, approved participants
          can vote on ranking signals, topic priorities, and content rules. Approved policy changes are applied before
          the feed is rescored. Bluesky renders the ordered posts; Corgi shows the policy and available ranking receipts.
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
          Corgi is maintained by Andrew Nordstrom as an <Strong>independent, open-source project</Strong> — not an
          ad-funded company. The ranking engine, the governance pipeline, and this site are all developed in the open on{" "}
          <InlineLink href="https://github.com/andrewnordstrom-eng/bluesky-community-feed">GitHub</InlineLink>, so anyone
          can read the code that decides the order.
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
          <LI><Strong>Open a round</Strong> — a vote can be scheduled or opened manually, with a configurable response window.</LI>
          <LI><Strong>Vote</Strong> — approved participants can submit five global signal weights, topic priorities that shape relevance, and include or exclude content rules.</LI>
          <LI><Strong>Aggregate</Strong> — fewer than 10 ballots use an arithmetic mean; 10 or more use a 10% trimmed mean. Content rules require at least 30% support among content-rule ballots.</LI>
          <LI><Strong>Review &amp; approve</Strong> — closed-round results are reviewed before an operator approves or rejects the complete proposed policy.</LI>
          <LI><Strong>Apply &amp; rescore</Strong> — approval applies signals, topics, and adopted rules together to the active <Strong>epoch</Strong>, returns it to running, and queues a durable feed rescore.</LI>
          <LI><Strong>Record</Strong> — policy changes and operator actions are written to the governance audit trail.</LI>
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
          <LI><Strong>Inspectable by default</Strong> — active ranking policy, available per-post score breakdowns, and governance history are exposed on Corgi.</LI>
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
          Governance access is currently an approved waitlist pilot. For participants, we collect only what is needed to
          operate the pilot: your Bluesky handle/DID, ballot preferences, and research-consent status. Full details are in the{" "}
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
          <InlineLink href="https://github.com/andrewnordstrom-eng/bluesky-community-feed">GitHub</InlineLink>. For help,
          feedback, and private security-reporting guidance, visit <InlineLink href="/support">Support</InlineLink>. Ready
          to try it? See{" "}
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
