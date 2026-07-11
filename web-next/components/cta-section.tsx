import Link from "next/link"
import { DemoCTA } from "@/components/landing-ctas"

// Full-bleed dark band — the page's one deliberate contrast moment before the
// (cream) footer. SignInCTA isn't reused here because its ghost styling is dark
// text; on this dark band the secondary action needs light styling.
export function CTASection() {
  return (
    <section className="relative w-full overflow-hidden bg-foreground px-5 py-20 md:py-28">
      {/* Warm ginger glow for depth on the dark band */}
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
        <div className="h-[420px] w-[820px] rounded-full bg-primary/25 blur-[130px]" />
      </div>

      <div className="relative z-10 mx-auto flex max-w-2xl flex-col items-center gap-8 text-center">
        <div className="flex flex-col items-center gap-4">
          <h2 className="font-display text-4xl font-bold leading-tight tracking-tight text-background text-balance md:text-5xl lg:text-[60px] lg:leading-[1.05]">
            Inspect the feed before you trust it.
          </h2>
          <p className="max-w-xl text-base font-medium leading-relaxed text-background/70 md:text-lg">
            Start with the no-login demo, change an isolated shadow policy, then connect a Bluesky app password only when
            you&rsquo;re ready to participate.
          </p>
        </div>

        <div className="flex flex-col items-center gap-3 sm:flex-row">
          <DemoCTA className="px-8" />
          <Link
            href="/sign-in"
            className="rounded-full border border-background/25 px-6 py-3 text-base font-medium text-background/80 transition-colors hover:border-background/50 hover:text-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-background/50 focus-visible:ring-offset-2 focus-visible:ring-offset-foreground"
          >
            Sign in
          </Link>
        </div>

        <p className="text-xs font-medium text-background/50">
          Interactive shadow demo &middot; app-password sign-in &middot; inspectable ranking
        </p>
      </div>
    </section>
  )
}
