"use client"

import { Header } from "@/components/header"
import { HeroSection } from "@/components/hero-section"
import { BlueskyProductShowcase, ModalityComparisonSection } from "@/components/modality-preview"
import { CommunityExamplesSection } from "@/components/community-examples-section"
import { SocialProof } from "@/components/social-proof"
import { BentoSection } from "@/components/bento-section"
import { GetStartedSection } from "@/components/get-started-section"
import { ChangelogSection } from "@/components/changelog-section"
import { FAQSection } from "@/components/faq-section"
import { CTASection } from "@/components/cta-section"
import { FooterSection } from "@/components/footer-section"
import { AnimatedSection } from "@/components/animated-section"

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-background relative overflow-hidden pb-0">
      {/* Header manages its own sticky positioning + scroll-based background. */}
      <Header />

      <div className="relative z-10">
        {/* Hero - full bleed */}
        <HeroSection />

        {/* Lead with one dominant product surface before explaining the receipt layer. */}
        <AnimatedSection
          className="relative z-20 max-w-[1320px] mx-auto px-4 md:px-6 lg:px-8 -mt-14 md:-mt-24 lg:-mt-28 pb-0 flex justify-center"
          delay={0.15}
        >
          <BlueskyProductShowcase />
        </AnimatedSection>

        <div className="max-w-[1320px] mx-auto">
          {/* Open source strip */}
          <AnimatedSection className="px-4 md:px-6 lg:px-8 mt-10 md:mt-14" delay={0.1}>
            <SocialProof />
          </AnimatedSection>

          {/* Community examples */}
          <AnimatedSection delay={0.15}>
            <CommunityExamplesSection />
          </AnimatedSection>

          {/* Explain modality after users have seen the product promise. */}
          <AnimatedSection delay={0.15}>
            <ModalityComparisonSection />
          </AnimatedSection>

          {/* Feature rows */}
          <AnimatedSection delay={0.15}>
            <BentoSection />
          </AnimatedSection>

          {/* Get started */}
          <AnimatedSection delay={0.15}>
            <GetStartedSection />
          </AnimatedSection>

          {/* Changelog / proof */}
          <AnimatedSection className="px-5 md:px-8 lg:px-12" delay={0.2}>
            <ChangelogSection />
          </AnimatedSection>

          {/* FAQ */}
          <AnimatedSection className="px-5 md:px-8 lg:px-12" delay={0.2}>
            <FAQSection />
          </AnimatedSection>

          {/* CTA */}
          <AnimatedSection delay={0.2}>
            <CTASection />
          </AnimatedSection>
        </div>

        {/* Footer */}
        <AnimatedSection delay={0.2}>
          <FooterSection />
        </AnimatedSection>
      </div>
    </div>
  )
}
