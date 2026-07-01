"use client"

import { useState, useEffect } from "react"
import { Header } from "@/components/header"
import { HeroSection } from "@/components/hero-section"
import { DashboardPreview } from "@/components/dashboard-preview"
import { SocialProof } from "@/components/social-proof"
import { GetStartedSection } from "@/components/get-started-section"
import { BentoSection } from "@/components/bento-section"
import { ChangelogSection } from "@/components/changelog-section"
import { FAQSection } from "@/components/faq-section"
import { CTASection } from "@/components/cta-section"
import { FooterSection } from "@/components/footer-section"
import { AnimatedSection } from "@/components/animated-section"

export default function LandingPage() {
  const [scrolled, setScrolled] = useState(false)

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8)
    window.addEventListener("scroll", onScroll, { passive: true })
    return () => window.removeEventListener("scroll", onScroll)
  }, [])

  return (
    <div className="min-h-screen bg-background relative overflow-hidden pb-0">
      {/* Sticky header */}
      <div
        className={`sticky top-0 z-50 w-full transition-all duration-200 ${
          scrolled
            ? "bg-background/90 backdrop-blur-md border-b border-border/50 shadow-[0_1px_8px_rgba(46,38,32,0.06)]"
            : "bg-transparent"
        }`}
      >
        <Header />
      </div>

      <div className="relative z-10">
        {/* Hero + dashboard preview — stacked so preview overhangs below */}
        <div className="relative max-w-[1320px] mx-auto px-4 md:px-6 lg:px-8">
          <HeroSection />
          {/* Dashboard preview sits at the bottom of the hero, overhanging into the next section */}
          <div className="relative z-20 -mt-24 md:-mt-32 lg:-mt-40 flex justify-center pb-0">
            <AnimatedSection delay={0.15}>
              <DashboardPreview />
            </AnimatedSection>
          </div>
        </div>

        {/* Open source strip — sits below the preview with top padding to clear the overhang */}
        <AnimatedSection className="relative z-10 max-w-[1320px] mx-auto px-6 mt-8 md:mt-16" delay={0.1}>
          <SocialProof />
        </AnimatedSection>

        {/* Get started */}
        <AnimatedSection className="relative z-10 max-w-[1320px] mx-auto" delay={0.15}>
          <GetStartedSection />
        </AnimatedSection>

        {/* Features bento */}
        <AnimatedSection id="features-section" className="relative z-10 max-w-[1320px] mx-auto" delay={0.2}>
          <BentoSection />
        </AnimatedSection>

        {/* Changelog */}
        <AnimatedSection className="relative z-10 max-w-[1320px] mx-auto" delay={0.2}>
          <ChangelogSection />
        </AnimatedSection>

        {/* FAQ */}
        <AnimatedSection id="faq-section" className="relative z-10 max-w-[1320px] mx-auto" delay={0.2}>
          <FAQSection />
        </AnimatedSection>

        {/* CTA */}
        <AnimatedSection className="relative z-10 max-w-[1320px] mx-auto" delay={0.2}>
          <CTASection />
        </AnimatedSection>

        {/* Footer */}
        <AnimatedSection className="relative z-10 max-w-[1320px] mx-auto" delay={0.2}>
          <FooterSection />
        </AnimatedSection>
      </div>
    </div>
  )
}
