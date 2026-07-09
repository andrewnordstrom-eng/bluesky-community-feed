import type { Metadata } from "next"
import Link from "next/link"
import { Header } from "@/components/header"
import { FooterSection } from "@/components/footer-section"
import { HowItWorksReplay } from "@/components/how-it-works-replay"
import { ModalityPreview } from "@/components/modality-preview"
import { DemoCTA, SignInCTA } from "@/components/landing-ctas"

export const metadata: Metadata = {
  title: "How Corgi Works - Community-governed Bluesky ranking",
  description:
    "Replay how the same posts become a different Bluesky feed when a community changes Corgi's ranking policy.",
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

const walkthroughTopics = ["warbler sightings", "messy CSVs", "bug reports", "deploy jokes"] as const

const walkthroughPolicyNotes = [
  "Freshness can lift today's field context.",
  "Bridge-building can surface posts that connect subgroups.",
  "Engagement can still win when the community wants viral energy.",
] as const

export default function HowItWorksPage() {
  return (
    <div className="min-h-screen overflow-hidden bg-background text-foreground">
      <Header />

      <main className="relative z-10">
        <section className="relative border-b border-border/60 px-5 pb-12 pt-12 md:px-8 md:pb-16 md:pt-[72px] lg:px-12">
          <div className="absolute inset-0 pointer-events-none">
            <div className="absolute left-[10%] top-0 h-[320px] w-[520px] rounded-full bg-primary/10 blur-[120px]" />
            <div className="absolute right-[7%] top-24 h-[260px] w-[420px] rounded-full bg-[#4F8D7A]/10 blur-[120px]" />
          </div>

          <div className="relative mx-auto grid max-w-[1320px] gap-10 lg:grid-cols-[minmax(0,0.95fr)_minmax(420px,0.85fr)] lg:items-center">
            <div className="max-w-3xl">
              <p className="mb-4 text-[11px] font-mono uppercase tracking-[0.22em] text-foreground/35">
                How Corgi works
              </p>
              <h1 className="font-display text-4xl font-bold leading-[0.98] tracking-tight text-balance md:text-6xl lg:text-[76px]">
                See how a community changes its feed.
              </h1>
              <p className="mt-6 max-w-2xl text-lg font-medium leading-relaxed text-foreground/60 md:text-xl">
                Bluesky renders normal posts in the order Corgi returns. Corgi shows the scores, receipts, weights, and why-ranked details that explain that order.
              </p>
              <div className="mt-7 flex flex-col gap-3 sm:flex-row sm:items-center">
                <DemoCTA />
                <Link
                  href="#replay"
                  className="rounded-full px-5 py-3 text-base font-medium text-foreground/70 transition-colors hover:text-foreground"
                >
                  Replay a policy change &rarr;
                </Link>
              </div>
              <p className="mt-5 max-w-xl text-sm font-medium leading-relaxed text-foreground/45">
                Same posts. Same raw scores. Different community policy. Different feed.
              </p>
            </div>

            <div className="rounded-[28px] border border-border bg-card p-5 shadow-[0_18px_70px_rgba(46,38,32,0.12)] sm:p-6">
              <div className="rounded-2xl border border-border/70 bg-background p-5">
                <p className="text-[11px] font-mono uppercase tracking-[0.2em] text-foreground/35">
                  Walkthrough community
                </p>
                <h2 className="mt-2 text-3xl font-bold leading-tight text-foreground">Birders Who Code</h2>
                <p className="mt-3 text-sm font-medium leading-relaxed text-foreground/58">
                  A community feed for field reports, debugging notes, open datasets, and the jokes that make both hobbies feel human.
                </p>

                <div className="mt-5 flex flex-wrap gap-2">
                  {walkthroughTopics.map((topic) => (
                    <span
                      key={topic}
                      className="rounded-full border border-border bg-card px-3 py-1 text-xs font-semibold text-foreground/62"
                    >
                      {topic}
                    </span>
                  ))}
                </div>

                <div className="mt-6 border-t border-border/60 pt-5">
                  <p className="text-[11px] font-mono uppercase tracking-[0.18em] text-foreground/35">
                    What the replay changes
                  </p>
                  <div className="mt-3 flex flex-col gap-3">
                    {walkthroughPolicyNotes.map((note) => (
                      <div key={note} className="flex gap-3 rounded-xl border border-border/70 bg-card px-4 py-3">
                        <span className="mt-1 h-2 w-2 flex-shrink-0 rounded-full bg-primary" />
                        <p className="text-sm font-medium leading-relaxed text-foreground/62">{note}</p>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="mt-5 rounded-xl border border-primary/15 bg-primary/[0.06] px-4 py-3">
                  <p className="text-sm font-medium leading-relaxed text-foreground/68">
                    Use the presets below to watch the same posts reorder under different community policies.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </section>

        <HowItWorksReplay />

        <section id="modality" className="border-t border-border/60 px-4 py-12 md:px-6 md:py-16 lg:px-8">
          <div className="mx-auto mb-8 max-w-3xl text-center">
            <p className="mb-2 text-[11px] font-mono uppercase tracking-[0.2em] text-foreground/35">
              Where ranking lives
            </p>
            <h2 className="font-display text-3xl font-bold leading-tight tracking-tight text-foreground md:text-5xl">
              The feed changes in Bluesky. The receipt lives on Corgi.
            </h2>
            <p className="mx-auto mt-3 max-w-2xl text-base font-medium leading-relaxed text-foreground/55">
              This separation is intentional: people get a normal Bluesky feed, and the explanation layer stays inspectable on Corgi.
            </p>
          </div>
          <div className="mx-auto flex max-w-[1320px] justify-center">
            <ModalityPreview />
          </div>
        </section>

        <section className="mx-auto max-w-[1320px] border-t border-border/60 px-5 py-12 md:px-8 md:py-16 lg:px-12">
          <div className="grid gap-4 md:grid-cols-3">
            {surfaceBoundaries.map((boundary) => (
              <div
                key={boundary.label}
                className="rounded-2xl border border-border bg-card p-5 shadow-[0_2px_10px_rgba(46,38,32,0.05)]"
              >
                <p className="text-[11px] font-mono uppercase tracking-[0.18em] text-foreground/35">
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
        </section>

        <section className="mx-auto max-w-[1320px] border-t border-border/60 px-5 py-12 md:px-8 md:py-16 lg:px-12">
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
          <p className="mt-8 max-w-3xl text-xs leading-relaxed text-foreground/42">
            Demo posts are illustrative; live ranking claims use Corgi receipts and snapshot data.
          </p>
        </section>
      </main>

      <FooterSection />
    </div>
  )
}
