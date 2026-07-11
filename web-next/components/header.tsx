"use client"

import { useState, useEffect, useCallback, useRef } from "react"
import { createPortal } from "react-dom"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { BrandLink } from "@/components/brand-link"
import { Button } from "@/components/ui/button"
import { SignInDialog } from "./sign-in-dialog"
import { cn } from "@/lib/utils"
import { CONTAINER_WIDTH, GUTTER } from "@/components/ui/layout"

// Shared keyboard focus ring for nav links/buttons (raw Link/button don't get one).
const FOCUS =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background"

function useScroll(threshold: number) {
  const [scrolled, setScrolled] = useState(false)
  const onScroll = useCallback(() => {
    setScrolled(window.scrollY > threshold)
  }, [threshold])
  useEffect(() => {
    window.addEventListener("scroll", onScroll, { passive: true })
    onScroll()
    return () => window.removeEventListener("scroll", onScroll)
  }, [onScroll])
  return scrolled
}

function AnimatedMenuIcon({ open }: { open: boolean }) {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 32 32"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={cn("transition-transform duration-300 ease-in-out", open && "-rotate-45")}
    >
      <path
        className={cn(
          "transition-all duration-300 ease-in-out",
          open
            ? "[stroke-dasharray:20_300] [stroke-dashoffset:-32.42px]"
            : "[stroke-dasharray:12_63]"
        )}
        d="M27 10 13 10C10.8 10 9 8.2 9 6 9 3.5 10.8 2 13 2 15.2 2 17 3.8 17 6L17 26C17 28.2 18.8 30 21 30 23.2 30 25 28.2 25 26 25 23.8 23.2 22 21 22L7 22"
      />
      <path d="M7 16 27 16" />
    </svg>
  )
}

export function Header() {
  const pathname = usePathname()
  const [signInOpen, setSignInOpen] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)
  const mobileMenuButtonRef = useRef<HTMLButtonElement>(null)
  const mobileMenuRef = useRef<HTMLDivElement>(null)
  const scrolled = useScroll(10)
  const isDemoPage = pathname === "/demo" || pathname.startsWith("/demo/")

  const navItems = [
    { name: "How it works", href: "/how-it-works" },
    { name: "Demo", href: "/demo" },
    { name: "Get started", href: "/start" },
    { name: "FAQ", href: "/#faq-section" },
  ]

  // Body scroll lock
  useEffect(() => {
    document.body.style.overflow = mobileOpen ? "hidden" : ""
    return () => { document.body.style.overflow = "" }
  }, [mobileOpen])

  useEffect(() => {
    if (!mobileOpen) return

    mobileMenuRef.current?.querySelector<HTMLElement>("a, button")?.focus()

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return
      event.preventDefault()
      setMobileOpen(false)
      mobileMenuButtonRef.current?.focus()
    }

    document.addEventListener("keydown", closeOnEscape)
    return () => document.removeEventListener("keydown", closeOnEscape)
  }, [mobileOpen])

  const handleNavClick = () => {
    setMobileOpen(false)
  }

  return (
    <>
      <header
        className={cn(
          "sticky top-0 z-50 w-full border-b border-transparent transition-[background-color,border-color,backdrop-filter] duration-200",
          scrolled && "bg-background/90 supports-[backdrop-filter]:bg-background/75 backdrop-blur-md border-border"
        )}
      >
        {/* 3-column grid keeps the nav dead-center on the page regardless of the
            (unequal) logo vs. auth widths — justify-between would bias it left. */}
        <div className={cn("mx-auto w-full grid grid-cols-[1fr_auto_1fr] items-center h-14", CONTAINER_WIDTH.content, GUTTER)}>

          {/* Brand */}
          <div className="justify-self-start">
            <BrandLink href="/" ariaLabel="Corgi home" />
          </div>

          {/* Desktop nav */}
          <nav className="hidden md:flex items-center gap-0.5 justify-self-center" aria-label="Main navigation">
            {navItems.map((item) => {
              const active = item.href !== "/#faq-section" && (
                pathname === item.href || pathname.startsWith(`${item.href}/`)
              )

              return (
                <Link
                  key={item.name}
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "px-4 py-1.5 rounded-full text-sm font-medium transition-colors",
                    FOCUS,
                    active
                      ? "bg-primary/10 text-primary"
                      : "text-foreground/60 hover:text-foreground hover:bg-accent/60",
                  )}
                >
                  {item.name}
                </Link>
              )
            })}
          </nav>

          {/* Right: desktop auth + mobile hamburger */}
          <div className="justify-self-end flex items-center gap-2">
            <div className="hidden md:flex items-center gap-3">
              <button
                onClick={() => setSignInOpen(true)}
                className={cn("text-sm font-medium text-foreground/70 hover:text-foreground transition-colors rounded-md px-2 py-1", FOCUS)}
              >
                Sign in
              </button>
              <Button
                asChild={!isDemoPage}
                onClick={isDemoPage ? () => setSignInOpen(true) : undefined}
                className="bg-primary text-primary-foreground hover:bg-primary-dark rounded-full px-5 text-sm shadow-[0_2px_8px_rgba(200,97,44,0.28)] hover:shadow-[0_4px_14px_rgba(200,97,44,0.38)] transition-all"
              >
                {isDemoPage ? "Connect Bluesky" : <Link href="/demo">Explore demo</Link>}
              </Button>
            </div>

            {/* Mobile hamburger */}
            <button
              ref={mobileMenuButtonRef}
              onClick={() => setMobileOpen((v) => !v)}
              aria-label={mobileOpen ? "Close menu" : "Open menu"}
              aria-expanded={mobileOpen}
              aria-controls="landing-mobile-menu"
              className={cn("md:hidden flex items-center justify-center w-9 h-9 rounded-lg text-foreground/70 hover:text-foreground hover:bg-accent/60 transition-colors", FOCUS)}
            >
              <AnimatedMenuIcon open={mobileOpen} />
            </button>
          </div>
        </div>
      </header>

      {/* Mobile menu portal */}
      {typeof window !== "undefined" && mobileOpen && createPortal(
        <div
          ref={mobileMenuRef}
          id="landing-mobile-menu"
          role="dialog"
          aria-modal="true"
          aria-label="Main navigation"
          className="fixed top-14 inset-x-0 bottom-0 z-40 md:hidden bg-background/95 supports-[backdrop-filter]:bg-background/80 backdrop-blur-lg border-t border-border flex flex-col overflow-hidden"
        >
          <div
            data-slot={mobileOpen ? "open" : "closed"}
            className="data-[slot=open]:animate-in data-[slot=open]:zoom-in-97 data-[slot=open]:ease-out data-[slot=open]:duration-200 flex flex-col justify-between h-full p-4"
          >
            <nav className="flex flex-col gap-1" aria-label="Mobile navigation">
              {navItems.map((item) => {
                const active = item.href !== "/#faq-section" && (
                  pathname === item.href || pathname.startsWith(`${item.href}/`)
                )

                return (
                  <Link
                    key={item.name}
                    href={item.href}
                    onClick={handleNavClick}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "px-4 py-3 rounded-xl text-base font-medium transition-colors",
                      FOCUS,
                      active
                        ? "bg-primary/10 text-primary"
                        : "text-foreground/70 hover:text-foreground hover:bg-accent/60",
                    )}
                  >
                    {item.name}
                  </Link>
                )
              })}
            </nav>
            <div className="flex flex-col gap-2 pb-2">
              <button
                onClick={() => { setMobileOpen(false); setSignInOpen(true) }}
                className={cn("w-full px-4 py-3 rounded-xl text-sm font-medium text-foreground/70 hover:text-foreground hover:bg-accent/60 transition-colors text-left", FOCUS)}
              >
                Sign in
              </button>
              <Button
                asChild={!isDemoPage}
                onClick={isDemoPage ? () => { setMobileOpen(false); setSignInOpen(true) } : undefined}
                className="w-full bg-primary text-primary-foreground hover:bg-primary-dark rounded-full text-sm shadow-[0_2px_8px_rgba(200,97,44,0.28)] transition-all"
              >
                {isDemoPage
                  ? "Connect Bluesky"
                  : <Link href="/demo" onClick={handleNavClick}>Explore demo</Link>}
              </Button>
              {!isDemoPage && (
                <button
                  onClick={() => { setMobileOpen(false); setSignInOpen(true) }}
                  className={cn("w-full px-4 py-3 rounded-xl text-sm font-medium text-foreground/70 hover:text-foreground hover:bg-accent/60 transition-colors text-left", FOCUS)}
                >
                  Connect Bluesky when ready
                </button>
              )}
            </div>
          </div>
        </div>,
        document.body
      )}

      <SignInDialog open={signInOpen} onOpenChange={setSignInOpen} />
    </>
  )
}
