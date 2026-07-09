import { DemoCTA, SignInCTA } from "@/components/landing-ctas"

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
            Inspect the feed before you trust it.
          </h2>
          <p className="text-foreground/50 text-base md:text-lg font-medium leading-relaxed max-w-xl">
            Start with the read-only demo, inspect the live snapshot, then connect a Bluesky app password only when you are ready to participate.
          </p>
        </div>

        <div className="flex flex-col sm:flex-row items-center gap-3">
          <DemoCTA className="px-8" />
          <SignInCTA className="px-6" />
        </div>

        <p className="text-xs text-foreground/30 font-medium">
          Snapshot-first &middot; App-password sign-in &middot; No hidden algorithm
        </p>
      </div>
    </section>
  )
}
