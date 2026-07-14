import type { Metadata } from "next"
import Link from "next/link"
import { Header } from "@/components/header"
import { FooterSection } from "@/components/footer-section"
import { Button } from "@/components/ui/button"
import { Container } from "@/components/ui/layout"
import { PageHero, HeroGlow, HERO_TOP } from "@/components/ui/page-hero"

export const metadata: Metadata = {
  title: "Get started — Corgi Commons and the governance demo",
  description:
    "View Corgi Commons on Bluesky, try the anonymous governance demo, or request access to the limited voting pilot.",
  alternates: { canonical: "/start/" },
}

const CORGI_FEED_URL = "https://bsky.app/profile/corgi-network.bsky.social/feed/community-gov"

const steps = [
  {
    n: "01",
    title: "View and subscribe to Corgi Commons",
    body: "Open the feed in your Bluesky app or on the web, then use Bluesky's feed controls to save it to your Home. No Corgi account is required to browse it.",
    cta: { label: "Open the feed on Bluesky", href: CORGI_FEED_URL, external: true },
  },
  {
    n: "02",
    title: "Try isolated shadow governance",
    body: "Use the anonymous demo to propose a policy, combine it with 24 scripted deterministic voter archetypes, rerank a frozen comparison corpus, and inspect what moved. The session never changes the public feed.",
    cta: { label: "Try the governance demo", href: "/demo", external: false },
  },
  {
    n: "03",
    title: "Request access to the voting pilot",
    body: "Governance participation is currently limited to approved waitlist participants. If approved, Corgi signs you in with a Bluesky app password — a scoped credential you can revoke anytime. Your real password never touches Corgi.",
    cta: { label: "Join the waitlist", href: "/sign-in", external: false },
  },
] as const

export default function StartPage() {
  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Header />
      <main className="flex-1">
       <div className="relative">
        <HeroGlow />
        <Container as="section" width="doc" className={`relative ${HERO_TOP} pb-8`}>
          <PageHero
            size="md"
            align="center"
            eyebrow="Get started"
            title="Open Corgi Commons, try the demo, or join the pilot."
            subtitle="Anyone can view the live Bluesky feed and use the anonymous shadow demo. Governance participation is currently available through an approved waitlist pilot."
            actions={
              <>
                <Button
                  asChild
                  className="bg-primary text-primary-foreground hover:bg-primary-dark rounded-full px-7 py-3 text-base font-medium shadow-[0_2px_8px_rgba(200,97,44,0.3)] transition-all"
                >
                  <a href={CORGI_FEED_URL} target="_blank" rel="noopener noreferrer">Open the feed on Bluesky</a>
                </Button>
                <Link
                  href="/demo"
                  className="rounded-full px-5 py-3 text-base font-medium text-foreground/70 hover:text-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                >
                  Try the governance demo &rarr;
                </Link>
              </>
            }
          />
        </Container>
       </div>

        <Container as="section" width="doc" className="pb-16 md:pb-24">
          <div className="flex flex-col gap-4">
            {steps.map((step) => (
              <div
                key={step.n}
                className="flex flex-col gap-4 rounded-3xl border border-border bg-card p-6 shadow-[0_2px_12px_rgba(46,38,32,0.05)] sm:flex-row sm:items-start sm:gap-6 md:p-7"
              >
                <span className="font-mono text-sm font-bold text-primary/70 sm:pt-1">{step.n}</span>
                <div className="flex-1">
                  <h2 className="font-display text-xl font-bold leading-snug text-foreground">{step.title}</h2>
                  <p className="mt-2 text-base leading-relaxed text-foreground/60">{step.body}</p>
                  {step.cta.external ? (
                    <a
                      href={step.cta.href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-3 inline-flex rounded text-sm font-semibold text-primary underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                    >
                      {step.cta.label} &rarr;
                    </a>
                  ) : (
                    <Link
                      href={step.cta.href}
                      className="mt-3 inline-flex rounded text-sm font-semibold text-primary underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                    >
                      {step.cta.label} &rarr;
                    </Link>
                  )}
                </div>
              </div>
            ))}
          </div>

          <p className="mx-auto mt-8 max-w-[600px] text-center text-sm leading-relaxed text-foreground/50">
            Prefer to understand the ranking first? The{" "}
            <Link href="/how-it-works" className="text-primary hover:underline underline-offset-2">
              how-it-works walkthrough
            </Link>{" "}
            lets you change a community&rsquo;s policy and watch the feed reorder.
          </p>
        </Container>
      </main>
      <FooterSection />
    </div>
  )
}
