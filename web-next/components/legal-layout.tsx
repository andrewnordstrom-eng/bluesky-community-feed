"use client"

import Link from "next/link"
import { useState, useEffect, useRef } from "react"

export interface LegalSection {
  id: string
  heading: string
  body: React.ReactNode
}

interface LegalLayoutProps {
  title: string
  lastUpdated: string
  sections: LegalSection[]
  backHref?: string
  backLabel?: string
}

export function LegalLayout({ title, lastUpdated, sections, backHref = "/", backLabel = "Back" }: LegalLayoutProps) {
  const [activeId, setActiveId] = useState<string>(sections[0]?.id ?? "")
  const observerRef = useRef<IntersectionObserver | null>(null)

  useEffect(() => {
    const headings = sections.map((s) => document.getElementById(s.id)).filter(Boolean) as HTMLElement[]
    observerRef.current = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((e) => e.isIntersecting)
        if (visible.length > 0) {
          setActiveId(visible[0].target.id)
        }
      },
      { rootMargin: "-20% 0px -60% 0px", threshold: 0 }
    )
    headings.forEach((h) => observerRef.current?.observe(h))
    return () => observerRef.current?.disconnect()
  }, [sections])

  return (
    <div className="max-w-6xl mx-auto px-5 py-10">

      {/* Back nav */}
      <Link
        href={backHref}
        className="inline-flex items-center gap-1.5 text-sm text-foreground/50 hover:text-foreground transition-colors mb-8 group"
      >
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true" className="group-hover:-translate-x-0.5 transition-transform">
          <path d="M10 3L6 8l4 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
        {backLabel}
      </Link>

      <div className="flex gap-12 items-start">

        {/* ── Sticky ToC ─────────────────────────────────────────── */}
        <nav
          className="hidden lg:flex flex-col gap-1 w-52 flex-shrink-0 sticky top-24"
          aria-label="Table of contents"
        >
          <span className="text-[9px] font-mono uppercase tracking-widest text-foreground/55 px-2 pb-2">Contents</span>
          {sections.map((s) => (
            <a
              key={s.id}
              href={`#${s.id}`}
              className={`px-2 py-1.5 rounded-lg text-sm transition-colors leading-snug
                ${activeId === s.id
                  ? "bg-primary/10 text-primary font-medium"
                  : "text-foreground/50 hover:text-foreground hover:bg-biscuit/50"
                }`}
            >
              {s.heading}
            </a>
          ))}
        </nav>

        {/* ── Document body ──────────────────────────────────────── */}
        <article className="flex-1 min-w-0">
          {/* Document header */}
          <header className="mb-10 pb-6 border-b border-border">
            <h1 className="font-display text-3xl font-bold text-foreground tracking-normal leading-tight mb-2">
              {title}
            </h1>
            <p className="text-sm text-foreground/55 font-mono">Last updated {lastUpdated}</p>
          </header>

          {/* Sections */}
          <div className="flex flex-col gap-10">
            {sections.map((s) => (
              <section key={s.id} id={s.id} className="scroll-mt-28">
                <h2 className="text-lg font-semibold text-foreground mb-4 leading-snug">{s.heading}</h2>
                <div className="prose-corgi">{s.body}</div>
              </section>
            ))}
          </div>

          {/* Footer */}
          <div className="mt-16 pt-6 border-t border-border flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
            <p className="text-xs text-foreground/50">
              Questions? Email{" "}
              <a href="mailto:hello@corgi.network" className="text-primary hover:underline underline-offset-2">
                hello@corgi.network
              </a>
            </p>
            <Link href={backHref} className="text-xs text-foreground/50 hover:text-foreground transition-colors">
              {backLabel}
            </Link>
          </div>
        </article>
      </div>
    </div>
  )
}

// ── Shared prose helpers ─────────────────────────────────────────────────────

export function P({ children }: { children: React.ReactNode }) {
  return <p className="text-sm text-foreground/65 leading-[1.75] mb-4 last:mb-0">{children}</p>
}

export function UL({ children }: { children: React.ReactNode }) {
  return <ul className="list-none mb-4 flex flex-col gap-1.5">{children}</ul>
}

export function LI({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-2 text-sm text-foreground/65 leading-relaxed">
      <span className="mt-[0.4rem] w-1.5 h-1.5 rounded-full bg-primary/50 flex-shrink-0" aria-hidden="true" />
      {/* Single flowing span: as direct flex items, mixed inline children (text,
          links, <Strong>) would sit side-by-side and overflow narrow screens. */}
      <span className="min-w-0">{children}</span>
    </li>
  )
}

export function Strong({ children }: { children: React.ReactNode }) {
  return <strong className="font-semibold text-foreground/85">{children}</strong>
}

export function InlineLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a href={href} className="text-primary hover:underline underline-offset-2 transition-colors">
      {children}
    </a>
  )
}
