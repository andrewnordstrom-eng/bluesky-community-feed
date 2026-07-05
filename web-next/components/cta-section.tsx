import { Button } from "@/components/ui/button"
import Link from "next/link"

export function CTASection() {
  return (
    <section className="w-full pt-10 md:pt-16 pb-12 md:pb-20 px-5 relative flex flex-col justify-center items-center overflow-visible">
      {/* Warm ginger glow */}
      <div className="absolute inset-0 top-0 flex items-start justify-center pointer-events-none">
        <div className="w-[700px] h-[400px] rounded-full bg-primary/10 blur-[120px] mt-8" />
      </div>

      <div className="relative z-10 flex flex-col justify-start items-center gap-8 max-w-3xl mx-auto text-center">
        <div className="flex flex-col justify-start items-center gap-4">
          <h2 className="text-foreground font-display text-4xl md:text-5xl lg:text-[64px] font-bold leading-tight tracking-tight text-balance">
            Take back your feed.
          </h2>
          <p className="text-foreground/50 text-base md:text-lg font-medium leading-relaxed max-w-xl">
            Connect your Bluesky account, cast your first vote, and see exactly why every post is where it is.
          </p>
        </div>

        <div className="flex flex-col sm:flex-row items-center gap-3">
          <Link href="/sign-in">
            <Button
              className="px-8 py-3 bg-primary text-primary-foreground text-base font-medium rounded-full shadow-[0_2px_8px_rgba(200,97,44,0.35),0_1px_2px_rgba(200,97,44,0.2)] hover:bg-primary-dark hover:shadow-[0_4px_16px_rgba(200,97,44,0.4)] transition-all duration-200"
              size="lg"
            >
              Connect your Bluesky account
            </Button>
          </Link>
          <Link href="#features-section">
            <Button
              variant="ghost"
              className="px-6 py-3 text-foreground/60 hover:text-foreground rounded-full text-base font-medium"
              size="lg"
            >
              See how ranking works &rarr;
            </Button>
          </Link>
        </div>

        <p className="text-xs text-foreground/30 font-medium">
          Free &middot; App-password secure &middot; Leave anytime
        </p>
      </div>
    </section>
  )
}
