import type { Metadata } from "next"
import { Header } from "@/components/header"
import { FooterSection } from "@/components/footer-section"
import { HowItWorksReplay } from "@/components/how-it-works-replay"
import { ModalityPreview } from "@/components/modality-preview"
import { DemoCTA, SignInCTA } from "@/components/landing-ctas"
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
                subtitle="Corgi scores candidate posts once, then applies the active community policy. Change the epoch and the feed order changes with it."
              />
            </div>
          </Container>
        </section>

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
          <div className="flex justify-center">
            <ModalityPreview />
          </div>
        </Section>

        <Section bordered spacing="default">
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

        <Section bordered spacing="default">
          <div className="flex flex-col gap-5 md:flex-row md:items-center md:justify-between">
            <div className="max-w-2xl">
              <h2 className="font-display text-3xl font-bold leading-tight tracking-tight">
                Inspect the live receipt path.
              </h2>
              <p className="mt-3 text-base leading-relaxed text-foreground/55">
                The walkthrough above is illustrative. The public demo is where live ranking claims use Corgi receipts and snapshot data.
              </p>
            </div>
            <div className="flex flex-col gap-3 sm:flex-row md:flex-shrink-0">
              <DemoCTA />
              <SignInCTA />
            </div>
          </div>
          <p className="mt-8 max-w-3xl text-xs leading-relaxed text-foreground/55">
            Demo posts are illustrative; live ranking claims use Corgi receipts and snapshot data.
          </p>
        </Section>
      </main>

      <FooterSection />
    </div>
  )
}
