"use client"

import { useState, useEffect, useCallback } from "react"
import { createPortal } from "react-dom"
import Link from "next/link"
import Image from "next/image"
import { Button } from "@/components/ui/button"
import { SignInDialog } from "./sign-in-dialog"
import { cn } from "@/lib/utils"

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
  const [signInOpen, setSignInOpen] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)
  const scrolled = useScroll(10)

  const navItems = [
    { name: "How it works", href: "/how-it-works" },
    { name: "FAQ", href: "/#faq-section" },
  ]

  // Close on scroll past threshold (feels natural)
  useEffect(() => {
    if (scrolled && mobileOpen) setMobileOpen(false)
  }, [scrolled, mobileOpen])

  // Body scroll lock
  useEffect(() => {
    document.body.style.overflow = mobileOpen ? "hidden" : ""
    return () => { document.body.style.overflow = "" }
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
        <div className="max-w-7xl mx-auto flex items-center justify-between h-14 px-5">

          {/* Brand */}
          <Link href="/" className="flex items-center gap-1.5 shrink-0">
            <Image
              src="/images/corgi-icon.svg"
              alt=""
              width={34}
              height={24}
              className="w-[34px] h-6 brightness-0"
              aria-hidden="true"
            />
            <span className="font-display font-bold text-2xl text-foreground tracking-tight">Corgi</span>
          </Link>

          {/* Desktop nav */}
          <nav className="hidden md:flex items-center gap-0.5" aria-label="Main navigation">
            {navItems.map((item) => (
              <Link
                key={item.name}
                href={item.href}
                className="px-4 py-1.5 rounded-full text-sm font-medium text-foreground/60 hover:text-foreground hover:bg-accent/60 transition-colors"
              >
                {item.name}
              </Link>
            ))}
          </nav>

          {/* Desktop auth */}
          <div className="hidden md:flex items-center gap-3">
            <button
              onClick={() => setSignInOpen(true)}
              className="text-sm font-medium text-foreground/70 hover:text-foreground transition-colors"
            >
              Sign in
            </button>
            <Button
              asChild
              className="bg-primary text-primary-foreground hover:bg-primary-dark rounded-full px-5 text-sm shadow-[0_2px_8px_rgba(200,97,44,0.28)] hover:shadow-[0_4px_14px_rgba(200,97,44,0.38)] transition-all"
            >
              <Link href="/demo">Explore demo</Link>
            </Button>
          </div>

          {/* Mobile hamburger */}
          <button
            onClick={() => setMobileOpen((v) => !v)}
            aria-label={mobileOpen ? "Close menu" : "Open menu"}
            aria-expanded={mobileOpen}
            aria-controls="landing-mobile-menu"
            className="md:hidden flex items-center justify-center w-9 h-9 rounded-lg text-foreground/70 hover:text-foreground hover:bg-accent/60 transition-colors"
          >
            <AnimatedMenuIcon open={mobileOpen} />
          </button>
        </div>
      </header>

      {/* Mobile menu portal */}
      {typeof window !== "undefined" && mobileOpen && createPortal(
        <div
          id="landing-mobile-menu"
          className="fixed top-14 inset-x-0 bottom-0 z-40 md:hidden bg-background/95 supports-[backdrop-filter]:bg-background/80 backdrop-blur-lg border-t border-border flex flex-col overflow-hidden"
        >
          <div
            data-slot={mobileOpen ? "open" : "closed"}
            className="data-[slot=open]:animate-in data-[slot=open]:zoom-in-97 data-[slot=open]:ease-out data-[slot=open]:duration-200 flex flex-col justify-between h-full p-4"
          >
            <nav className="flex flex-col gap-1" aria-label="Mobile navigation">
              {navItems.map((item) => (
                <Link
                  key={item.name}
                  href={item.href}
                  onClick={handleNavClick}
                  className="px-4 py-3 rounded-xl text-base font-medium text-foreground/70 hover:text-foreground hover:bg-accent/60 transition-colors"
                >
                  {item.name}
                </Link>
              ))}
            </nav>
            <div className="flex flex-col gap-2 pb-2">
              <button
                onClick={() => { setMobileOpen(false); setSignInOpen(true) }}
                className="w-full px-4 py-3 rounded-xl text-sm font-medium text-foreground/70 hover:text-foreground hover:bg-accent/60 transition-colors text-left"
              >
                Sign in
              </button>
              <Button
                asChild
                className="w-full bg-primary text-primary-foreground hover:bg-primary-dark rounded-full text-sm shadow-[0_2px_8px_rgba(200,97,44,0.28)] transition-all"
              >
                <Link href="/demo" onClick={handleNavClick}>Explore demo</Link>
              </Button>
              <button
                onClick={() => { setMobileOpen(false); setSignInOpen(true) }}
                className="w-full px-4 py-3 rounded-xl text-sm font-medium text-foreground/70 hover:text-foreground hover:bg-accent/60 transition-colors text-left"
              >
                Connect Bluesky when ready
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      <SignInDialog open={signInOpen} onOpenChange={setSignInOpen} />
    </>
  )
}
