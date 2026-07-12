import type { ReactNode } from "react"

/**
 * PageHero — the shared hero block for every top-nav page except the landing
 * (which keeps its bespoke full-viewport front-door treatment).
 *
 * The point is consistency: one eyebrow style, one type scale (two tiers), one
 * subtitle treatment, and — via `HERO_TOP` — one header→hero top rhythm, so the
 * headline lands at the same height when a visitor tabs between pages instead of
 * jumping around. Pages own their width/layout wrapper; this owns the text block.
 */

/** Shared top offset. Apply to the hero's Container/section so every page starts
 *  its content at the same height. */
export const HERO_TOP = "pt-14 md:pt-20"

/**
 * HeroGlow — a subtle warm wash behind a page hero. This is the *shared* texture
 * for secondary pages, so they read warm rather than sterile without each page
 * inventing its own decoration. Place it as the first child of a `relative` hero
 * wrapper (the content that follows paints on top).
 */
export function HeroGlow() {
  return (
    <div className="pointer-events-none absolute inset-x-0 top-0 h-[440px] overflow-hidden" aria-hidden="true">
      <div className="absolute left-[8%] top-0 h-[300px] w-[500px] rounded-full bg-primary/[0.09] blur-[130px]" />
      <div className="absolute right-[7%] top-16 h-[240px] w-[420px] rounded-full bg-[#4F8D7A]/[0.08] blur-[130px]" />
    </div>
  )
}

const TITLE_SIZE = {
  /** Marketing / content pages — big, sits just under the landing hero. */
  lg: "text-4xl md:text-5xl lg:text-6xl",
  /** Utility / task pages — compact and consistent. */
  md: "text-4xl md:text-5xl",
} as const

export function PageHero({
  eyebrow,
  title,
  subtitle,
  actions,
  size = "md",
  align = "left",
  className = "",
}: {
  readonly eyebrow?: string
  readonly title: ReactNode
  readonly subtitle?: ReactNode
  readonly actions?: ReactNode
  readonly size?: keyof typeof TITLE_SIZE
  readonly align?: "left" | "center"
  readonly className?: string
}) {
  const center = align === "center"
  return (
    <div className={`${center ? "text-center" : ""} ${className}`}>
      {eyebrow ? (
        <p className="text-[11px] font-mono uppercase tracking-[0.22em] text-foreground/55">{eyebrow}</p>
      ) : null}
      <h1
        className={`${eyebrow ? "mt-3" : ""} font-display font-bold leading-[1.05] tracking-tight text-balance text-foreground ${TITLE_SIZE[size]}`}
      >
        {title}
      </h1>
      {subtitle ? (
        <p className={`mt-5 text-lg leading-relaxed text-foreground/60 ${center ? "mx-auto max-w-2xl" : "max-w-2xl"}`}>
          {subtitle}
        </p>
      ) : null}
      {actions ? (
        <div className={`mt-7 flex flex-col gap-3 sm:flex-row sm:items-center ${center ? "sm:justify-center" : ""}`}>
          {actions}
        </div>
      ) : null}
    </div>
  )
}
