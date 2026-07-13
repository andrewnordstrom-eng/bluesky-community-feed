import type { Metadata } from "next"
import { Header } from "@/components/header"
import { FooterSection } from "@/components/footer-section"
import { HowItWorksReplay } from "@/components/how-it-works-replay"
import { DemoCTA, WaitlistCTA } from "@/components/landing-ctas"
import { Container, Section } from "@/components/ui/layout"
import { PageHero, HeroGlow, HERO_TOP } from "@/components/ui/page-hero"

export const metadata: Metadata = {
  title: "How Corgi Works - Community-governed Bluesky ranking",
  description:
    "Replay how the same posts become a different Bluesky feed when a community changes Corgi's ranking policy.",
  alternates: { canonical: "/how-it-works/" },
}

const surfaceBoundaries = [
  {
    label: "Bluesky",
    heading: "Shows the ordered posts.",
    body: "Standard Bluesky clients render a normal custom feed in the order Corgi returns.",
  },
  {
    label: "Corgi",
    heading: "Shows why that order happened.",
    body: "Corgi hosts the score, receipt, community weights, and why-ranked explanation.",
  },
  {
    label: "Future clients",
    heading: "Could bring more context inline.",
    body: "A custom client could show explanations beside posts, but the current public path keeps them on Corgi.",
  },
] as const

const rankingJourney = [
  { label: "Candidate posts", body: "Corgi ingests public Bluesky posts and computes reusable post signals." },
  { label: "Ballot", body: "Approved participants can vote on signals, topic priorities, and content rules." },
  { label: "Aggregation", body: "Corgi aggregates complete ballots after the configurable voting window closes." },
  { label: "Review and approval", body: "Results are reviewed before an operator approves or rejects the proposed policy." },
  { label: "Publish in Bluesky", body: "After approval and rescoring, Bluesky receives the posts in Corgi's order." },
  { label: "Inspect in Corgi", body: "Corgi shows the policy, score components, publication adjustments, and receipts." },
] as const

const communityExamples = [
  "Neighborhood mutual aid can prioritize urgent, well-sourced local updates.",
  "Open-source maintainers can lift patches, docs, and release notes over generic project chatter.",
  "Tabletop creators can favor indie releases, safety tools, and useful play resources.",
] as const

export default function HowItWorksPage() {
  return (
    <div className="min-h-screen overflow-hidden bg-background text-foreground">
      <Header />

      <main className="relative z-10">
        {/* Hero — shared warm glow + border, single column on the standard frame. */}
        <section className={`relative border-b border-border/60 pb-12 md:pb-16 ${HERO_TOP}`}>
          <HeroGlow />

          <Container className="relative">
            <div className="max-w-3xl">
              <PageHero
                size="lg"
                align="left"
                eyebrow="Replay a policy change"
                title="Watch the same posts become a different feed."
                subtitle="Follow a post from candidate set to community ballot, approved policy, Bluesky feed, and inspectable Corgi receipt."
              />
            </div>
          </Container>
        </section>

        <Section bordered spacing="tight">
          <ol className="grid gap-0 border-y border-border/60 md:grid-cols-2 xl:grid-cols-6">
            {rankingJourney.map((step, index) => (
              <li
                key={step.label}
                className="border-b border-border/60 px-4 py-5 last:border-b-0 md:border-r md:[&:nth-child(2n)]:border-r-0 xl:border-b-0 xl:[&:nth-child(2n)]:border-r xl:last:border-r-0"
              >
                <p className="font-mono text-[11px] font-semibold text-primary/75">{String(index + 1).padStart(2, "0")}</p>
                <h2 className="mt-2 text-sm font-bold leading-snug text-foreground">{step.label}</h2>
                <p className="mt-1.5 text-xs leading-relaxed text-foreground/58">{step.body}</p>
              </li>
            ))}
          </ol>
        </Section>

        <HowItWorksReplay />

        <Section id="modality" bordered spacing="default">
          <div className="mx-auto mb-8 max-w-3xl text-center">
            <p className="mb-2 text-[11px] font-mono uppercase tracking-[0.2em] text-foreground/55">
              Where ranking lives
            </p>
            <h2 className="font-display text-3xl font-bold leading-tight tracking-tight text-foreground md:text-5xl">
              The feed changes in Bluesky. The receipt lives on Corgi.
            </h2>
            <p className="mx-auto mt-3 max-w-2xl text-base font-medium leading-relaxed text-foreground/55">
              This separation is intentional: people get a normal Bluesky feed, and the explanation layer stays inspectable on Corgi.
            </p>
          </div>
          <div className="grid gap-4 md:grid-cols-3">
            {surfaceBoundaries.map((boundary) => (
              <div
                key={boundary.label}
                className="rounded-2xl border border-border bg-card p-5 shadow-[0_2px_10px_rgba(46,38,32,0.05)]"
              >
                <p className="text-[11px] font-mono uppercase tracking-[0.18em] text-foreground/55">
                  {boundary.label}
                </p>
                <h3 className="mt-3 text-lg font-bold leading-snug text-foreground">{boundary.heading}</h3>
                <p className="mt-2 text-sm leading-relaxed text-foreground/58">{boundary.body}</p>
              </div>
            ))}
          </div>
          <div className="mt-8 rounded-2xl border border-primary/15 bg-primary/[0.06] px-5 py-4 text-sm leading-relaxed text-foreground/65">
            Rank badges and receipt panels in this page are Corgi annotations. They explain the order, but they are not native Bluesky UI.
          </div>
        </Section>

        <Section bordered spacing="tight">
          <div className="grid gap-5 md:grid-cols-[0.8fr_1.2fr] md:items-start">
            <div>
              <p className="text-[11px] font-mono uppercase tracking-[0.2em] text-foreground/55">Any community</p>
              <h2 className="mt-2 font-display text-2xl font-bold leading-tight text-foreground md:text-3xl">
                The mechanism is general. The policy is local.
              </h2>
            </div>
            <ul className="divide-y divide-border/60 border-y border-border/60">
              {communityExamples.map((example) => (
                <li key={example} className="py-3 text-sm leading-relaxed text-foreground/62">{example}</li>
              ))}
            </ul>
          </div>
        </Section>

        <Section bordered spacing="default">
          <div className="flex flex-col gap-5 md:flex-row md:items-center md:justify-between">
            <div className="max-w-2xl">
              <h2 className="font-display text-3xl font-bold leading-tight tracking-tight">
                Inspect the live receipt path.
              </h2>
              <p className="mt-3 text-base leading-relaxed text-foreground/55">
                The walkthrough above is illustrative. The public demo starts from a frozen comparison corpus sourced from Corgi Commons and keeps every shadow vote isolated from production.
              </p>
            </div>
            <div className="flex flex-col gap-3 sm:flex-row md:flex-shrink-0">
              <DemoCTA />
              <WaitlistCTA />
            </div>
          </div>
          <p className="mt-8 max-w-3xl text-xs leading-relaxed text-foreground/55">
            Demo posts on this page are illustrative. The reviewer demo identifies its frozen live-public snapshot and links back to source posts.
          </p>
        </Section>
      </main>

      <FooterSection />
    </div>
  )
}
