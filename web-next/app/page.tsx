"use client"

import { Header } from "@/components/header"
import { HeroSection } from "@/components/hero-section"
import { ReplayTeaser } from "@/components/replay-teaser"
import { CommunityExamplesSection } from "@/components/community-examples-section"
import { SocialProof } from "@/components/social-proof"
import { BentoSection } from "@/components/bento-section"
import { FAQSection } from "@/components/faq-section"
import { CTASection } from "@/components/cta-section"
import { FooterSection } from "@/components/footer-section"
import { AnimatedSection } from "@/components/animated-section"
import { Container } from "@/components/ui/layout"

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-background relative overflow-hidden pb-0">
      {/* Header manages its own sticky positioning + scroll-based background. */}
      <Header />

      <main className="relative z-10">
        {/* Hero - full bleed */}
        <HeroSection />

        {/* Interactive product demo — the narrower "product stage" width.
            The ReplayTeaser shares its scoring model with /how-it-works (lib/replay-model). */}
        <AnimatedSection className="relative z-20 pt-14 pb-4 md:pt-20" delay={0.15}>
          <Container width="stage">
            <div className="mx-auto mb-8 max-w-[720px] text-center md:mb-10">
              <p className="mb-3 text-[11px] font-mono uppercase tracking-[0.22em] text-foreground/55">
                Corgi Commons preview
              </p>
              <h2 className="font-display text-3xl font-bold leading-tight tracking-tight text-foreground text-balance md:text-[40px] md:leading-[1.1]">
                One feed. A policy the community can inspect.
              </h2>
              <p className="mx-auto mt-4 max-w-[620px] text-base leading-relaxed text-foreground/60">
                Corgi Commons brings together open-network building, research, software, data, and the conversations
                connecting them. Change the illustrative policy below to see how the same posts reorder.
              </p>
              <p className="mx-auto mt-3 max-w-[620px] text-sm font-semibold leading-relaxed text-foreground/70">
                Bluesky shows the ordered posts. Corgi shows the policy and receipts.
              </p>
            </div>
            <div className="flex justify-center">
              <ReplayTeaser />
            </div>
          </Container>
        </AnimatedSection>

        {/* Content sections each own their frame via <Section>/<Container>. */}
        <AnimatedSection className="mt-10 md:mt-14" delay={0.1}>
          <SocialProof />
        </AnimatedSection>

        <AnimatedSection delay={0.15}>
          <CommunityExamplesSection />
        </AnimatedSection>

        <AnimatedSection delay={0.15}>
          <BentoSection />
        </AnimatedSection>

        <AnimatedSection delay={0.2}>
          <FAQSection />
        </AnimatedSection>

        {/* Full-bleed dark CTA band — the page's one deliberate contrast moment. */}
        <AnimatedSection delay={0.2}>
          <CTASection />
        </AnimatedSection>

        {/* Footer */}
        <AnimatedSection delay={0.2}>
          <FooterSection />
        </AnimatedSection>
      </main>
    </div>
  )
}
