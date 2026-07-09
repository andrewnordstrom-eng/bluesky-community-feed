"use client"

import { Header } from "@/components/header"
import { HeroSection } from "@/components/hero-section"
import { DashboardPreview } from "@/components/dashboard-preview"
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

        {/* Dashboard preview sits below the hero and overhangs into the next section. */}
        <AnimatedSection
          className="relative z-20 max-w-[1320px] mx-auto px-4 md:px-6 lg:px-8 -mt-24 md:-mt-32 lg:-mt-40 pb-0 flex justify-center"
          delay={0.15}
        >
          <DashboardPreview />
        </AnimatedSection>

        <div className="max-w-[1320px] mx-auto">
          {/* Open source strip */}
          <AnimatedSection className="px-4 md:px-6 lg:px-8 mt-12 md:mt-20" delay={0.1}>
            <SocialProof />
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
          <AnimatedSection id="faq-section" className="px-5 md:px-8 lg:px-12" delay={0.2}>
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
