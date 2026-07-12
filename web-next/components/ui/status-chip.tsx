/** StatusChip — phase/state chips per brief.
 *  Open / Review / Running / Live / Waiting
 *  Biscuit fill + ginger text; pulse dot for "Running" and "Live".
 */
type Phase =
  | "open" | "voting" | "review" | "running" | "live" | "waiting" | "closed"
  | "results" | "active" | "archived"

const PHASE_CONFIG: Record<Phase, { label: string; dot: boolean; dotClass: string }> = {
  open:     { label: "Open",          dot: false, dotClass: "" },
  voting:   { label: "Open",          dot: true,  dotClass: "bg-primary animate-pulse" },
  review:   { label: "Review",        dot: false, dotClass: "" },
  running:  { label: "Running",       dot: true,  dotClass: "bg-success animate-pulse" },
  live:     { label: "Live",          dot: true,  dotClass: "bg-primary animate-pulse" },
  waiting:  { label: "Waiting",       dot: false, dotClass: "" },
  closed:   { label: "Closed",        dot: false, dotClass: "" },
  results:  { label: "Closed",        dot: false, dotClass: "" },
  active:   { label: "Active policy", dot: true,  dotClass: "bg-success" },
  archived: { label: "Superseded",    dot: false, dotClass: "" },
}

interface StatusChipProps {
  phase: Phase | string
  className?: string
}

export function StatusChip({ phase, className }: StatusChipProps) {
  const key = (phase?.toLowerCase() ?? "waiting") as Phase
  const config = PHASE_CONFIG[key] ?? { label: phase, dot: false, dotClass: "" }

  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold whitespace-nowrap
        bg-biscuit text-primary border border-primary/20 ${className ?? ""}`}
    >
      {config.dot && (
        <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${config.dotClass}`} aria-hidden="true" />
      )}
      {config.label}
    </span>
  )
}
