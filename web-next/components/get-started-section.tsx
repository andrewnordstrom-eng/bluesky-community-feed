import Link from "next/link"
import { Button } from "@/components/ui/button"

const steps = [
  {
    number: "01",
    heading: "Connect your Bluesky account",
    body: "Generate an app-password in your Bluesky settings and paste it into Corgi. Your main password is never touched.",
  },
  {
    number: "02",
    heading: "Join or start a community feed",
    body: "Find an existing Corgi feed for your community, or create a new one. Invite members with a single link.",
  },
  {
    number: "03",
    heading: "Cast your first vote",
    body: "Vote on how the current weights should change. Every vote counts equally. The feed reranks at the end of the epoch.",
  },
]

export function GetStartedSection() {
  return (
    <section className="w-full px-5 py-14 md:py-20 flex flex-col items-center gap-10">
      <div className="flex flex-col items-center gap-3 max-w-xl text-center">
        <h2 className="text-foreground font-display text-3xl md:text-4xl font-bold leading-tight tracking-tight text-balance">
          Up and running in minutes
        </h2>
        <p className="text-foreground/50 text-base font-normal leading-relaxed">
          No code required. No waiting list. Just a Bluesky account.
        </p>
      </div>

      <div className="w-full max-w-4xl relative">
        {/* Connector line spanning all three cards on desktop */}
        <div className="hidden md:block absolute top-[2.15rem] left-[calc(16.666%+1.5rem)] right-[calc(16.666%+1.5rem)] h-px border-t border-dashed border-border z-0" />
        <div className="grid grid-cols-1 md:grid-cols-3 gap-5 relative z-10">
          {steps.map((step) => (
            <div key={step.number} className="flex flex-col gap-4 rounded-2xl border border-border bg-[hsl(34,60%,97%)] p-6 shadow-[0_2px_12px_rgba(46,38,32,0.05)]">
              <div className="w-9 h-9 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center flex-shrink-0">
                <span className="font-mono text-primary text-xs font-bold">{step.number}</span>
              </div>
              <div className="flex flex-col gap-1.5">
                <p className="text-foreground font-semibold text-base leading-snug">{step.heading}</p>
                <p className="text-foreground/55 text-sm font-normal leading-relaxed">{step.body}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      <Link href="/sign-in">
        <Button className="bg-primary text-primary-foreground hover:bg-primary-dark px-7 py-3 rounded-full font-medium text-base shadow-[0_2px_8px_rgba(200,97,44,0.35),0_1px_2px_rgba(200,97,44,0.2)] hover:shadow-[0_4px_16px_rgba(200,97,44,0.4)] transition-all duration-200">
          Connect your Bluesky account
        </Button>
      </Link>
    </section>
  )
}
