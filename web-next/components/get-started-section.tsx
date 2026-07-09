import { DemoCTA, SignInCTA } from "@/components/landing-ctas"

const steps = [
  {
    number: "01",
    heading: "Explore the reviewer demo",
    body: "Start with the read-only demo: live snapshot totals, anonymized receipt rows, and the ranking explanation without signing in.",
  },
  {
    number: "02",
    heading: "Inspect how ranking works",
    body: "Follow the weight, score, epoch, and receipt views before trusting the feed. The public path is built for review first.",
  },
  {
    number: "03",
    heading: "Sign in when ready",
    body: "Use a Bluesky app password only when you want to participate. Your main password stays outside Corgi.",
  },
]

export function GetStartedSection() {
  return (
    <section className="w-full border-t border-border/60 px-5 md:px-8 lg:px-12">
      <div className="flex flex-col md:flex-row md:items-start gap-6 md:gap-16 py-10 md:py-14">
        <div className="md:w-[40%] flex-shrink-0">
          <h2 className="text-foreground font-display text-2xl md:text-3xl lg:text-[2rem] font-bold leading-tight tracking-tight text-balance">
            Start with the read-only demo.
          </h2>
        </div>
        <div className="md:flex-1 md:pt-1">
          <p className="text-foreground/55 text-base leading-relaxed">
            Inspect the live snapshot and receipt trail first. Account connection stays available for participation, but the reviewer path does not depend on it.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 pb-12 md:pb-16 gap-0 border-t border-border/50">
        {steps.map((step, i) => (
          <div
            key={step.number}
            className={`flex flex-col gap-4 py-8 md:py-10 ${
              i < steps.length - 1
                ? "border-b md:border-b-0 md:border-r border-border/50"
                : ""
            } ${i > 0 ? "md:pl-10" : ""} ${i < steps.length - 1 ? "md:pr-10" : ""}`}
          >
            <span className="font-mono text-primary/70 text-xs font-bold tracking-widest">{step.number}</span>
            <div className="flex flex-col gap-2">
              <p className="text-foreground font-semibold text-base leading-snug">{step.heading}</p>
              <p className="text-foreground/50 text-sm font-normal leading-relaxed">{step.body}</p>
            </div>
          </div>
        ))}
      </div>

      <div className="pb-14 md:pb-16 flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4">
        <DemoCTA />
        <SignInCTA />
        <p className="text-foreground/35 text-sm">No account needed for the reviewer demo.</p>
      </div>
    </section>
  )
}
