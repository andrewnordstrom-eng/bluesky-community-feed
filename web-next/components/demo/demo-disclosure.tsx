import { DISCLOSURE } from "@/app/demo/shadow-demo-copy"

/** Light, low-friction bottom disclosure — the honest boundary, not audit copy. */
export function DemoDisclosure() {
  return (
    <div className="mt-8 rounded-2xl border border-border/70 bg-biscuit/25 px-5 py-4">
      <p className="text-sm font-medium leading-relaxed text-foreground/65">{DISCLOSURE.production}</p>
      <p className="mt-2 text-xs leading-relaxed text-foreground/55">{DISCLOSURE.posts}</p>
      <p className="mt-1 text-xs leading-relaxed text-foreground/55">{DISCLOSURE.annotations}</p>
    </div>
  )
}
