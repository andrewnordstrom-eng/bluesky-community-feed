"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import Image from "next/image"
import { Button } from "@/components/ui/button"
import { SignInDialog } from "./sign-in-dialog"
import { useAuth } from "@/components/auth-provider"
import { useQuery } from "@tanstack/react-query"
import { adminApi } from "@/lib/api/admin"
import { useState, useEffect } from "react"
import { createPortal } from "react-dom"
import { cn } from "@/lib/utils"

/** Legacy shape once passed in by pages. Live auth now drives the user area;
 *  the prop is retained only for compat (e.g. its optional `isAdmin` flag,
 *  which the session endpoint does not expose). */
export interface AppUser {
  handle: string
  did: string
  isAdmin?: boolean
}

interface AppShellProps {
  /** Retained for compat. Signed-in/out UI is derived from useAuth(), not this. */
  user?: AppUser | null
  children: React.ReactNode
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

const NAV_ITEMS = [
  { label: "Overview",  href: "/dashboard" },
  { label: "Vote",      href: "/vote" },
  { label: "Ledger",    href: "/history" },
]

export function AppShell({ user = null, children }: AppShellProps) {
  const pathname = usePathname()
  const { session, isAuthenticated, logout } = useAuth()
  const [signInOpen, setSignInOpen] = useState(false)
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)

  // Prefer live auth state over the legacy `user` prop for the signed-in area.
  const authedUser = isAuthenticated && session ? { handle: session.handle, did: session.did } : null

  // Admin nav is now driven by the real admin-status endpoint (shared cache key
  // with the admin page). The session endpoint carries no admin flag, so the
  // legacy `user.isAdmin` prop is only a fallback until the query resolves.
  // A non-admin session returns 403 (retry:false keeps it a single probe), so
  // `data` stays undefined and the fallback keeps the Admin link hidden.
  const adminStatusQuery = useQuery({
    queryKey: ["admin", "status"],
    staleTime: 5 * 60_000,
    queryFn: adminApi.getStatus,
    enabled: isAuthenticated,
    retry: false,
    select: (data) => data.isAdmin,
  })
  const isAdmin = adminStatusQuery.data ?? (user?.isAdmin ?? false)

  // Close mobile menu on route change
  useEffect(() => {
    setMobileMenuOpen(false)
  }, [pathname])

  // Prevent body scroll when the mobile menu OR the sign-in dialog is open.
  // Deriving the lock from both states avoids dropping the dialog's scroll lock
  // when the menu closes in the same interaction (menu → Connect Bluesky → dialog).
  useEffect(() => {
    const shouldLock = mobileMenuOpen || signInOpen
    document.body.style.overflow = shouldLock ? "hidden" : ""
    return () => { document.body.style.overflow = "" }
  }, [mobileMenuOpen, signInOpen])

  return (
    <div className="min-h-screen flex flex-col bg-background">
      {/* ── Top bar ─────────────────────────────────────────────── */}
      <header className="sticky top-0 z-40 w-full border-b border-border bg-background/90 backdrop-blur-sm">
        <div className="max-w-7xl mx-auto flex items-center justify-between h-14 px-5">

          {/* Brand mark */}
          <Link
            href="/dashboard"
            aria-label="Corgi overview"
            className="flex items-center gap-1.5 shrink-0"
          >
            <span className="font-display font-bold text-2xl text-foreground tracking-tight">Corgi</span>
            <Image
              src="/images/corgi-icon.svg"
              alt=""
              width={34}
              height={24}
              className="w-[34px] h-6 brightness-0"
              aria-hidden="true"
            />
          </Link>

          {/* Primary nav */}
          <nav className="hidden md:flex items-center gap-0.5" aria-label="Main navigation">
            {NAV_ITEMS.map((item) => {
              const active = pathname === item.href || pathname.startsWith(item.href + "/")
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={`px-4 py-1.5 rounded-full text-sm font-medium transition-colors
                    ${active
                      ? "bg-primary/10 text-primary"
                      : "text-foreground/60 hover:text-foreground hover:bg-biscuit/60"
                    }`}
                >
                  {item.label}
                </Link>
              )
            })}
            {isAdmin && (
              <Link
                href="/admin"
                aria-current={pathname.startsWith("/admin") ? "page" : undefined}
                className={`px-4 py-1.5 rounded-full text-sm font-medium transition-colors
                  ${pathname.startsWith("/admin")
                    ? "bg-primary/10 text-primary"
                    : "text-foreground/60 hover:text-foreground hover:bg-biscuit/60"
                  }`}
              >
                Admin
              </Link>
            )}
          </nav>

          {/* Right side — auth state + hamburger */}
          <div className="flex items-center gap-2">
            {authedUser ? (
              /* Logged-in state */
              <div className="flex items-center gap-2">
                <span className="hidden sm:block text-sm font-mono text-foreground/60">
                  @{authedUser.handle}
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => { logout().catch(() => {}) }}
                  className="hidden sm:flex text-foreground/55 hover:text-foreground text-xs"
                >
                  Sign out
                </Button>
              </div>
            ) : (
              /* Logged-out state */
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setSignInOpen(true)}
                  className="hidden sm:block text-sm font-medium text-foreground/60 hover:text-foreground transition-colors"
                >
                  Sign in
                </button>
                <Button
                  size="sm"
                  onClick={() => setSignInOpen(true)}
                  className="hidden sm:flex bg-primary text-primary-foreground hover:bg-primary-dark rounded-full px-4 text-sm shadow-[0_2px_8px_rgba(200,97,44,0.3)] hover:shadow-[0_4px_14px_rgba(200,97,44,0.4)] transition-all"
                >
                  Connect Bluesky
                </Button>
              </div>
            )}

            {/* Hamburger button — mobile only */}
            <button
              onClick={() => setMobileMenuOpen((v) => !v)}
              aria-label={mobileMenuOpen ? "Close menu" : "Open menu"}
              aria-expanded={mobileMenuOpen}
              aria-controls="app-mobile-menu"
              className="md:hidden flex items-center justify-center w-9 h-9 rounded-lg text-foreground/70 hover:text-foreground hover:bg-accent/60 transition-colors"
            >
              <AnimatedMenuIcon open={mobileMenuOpen} />
            </button>
          </div>
        </div>
      </header>

      {/* ── Mobile nav portal ────────────────────────────────────── */}
      {typeof window !== "undefined" && mobileMenuOpen && createPortal(
        <div
          id="app-mobile-menu"
          className="fixed top-14 inset-x-0 bottom-0 z-40 md:hidden bg-background/95 supports-[backdrop-filter]:bg-background/80 backdrop-blur-lg border-t border-border flex flex-col overflow-hidden"
        >
          <div
            data-slot="open"
            className="data-[slot=open]:animate-in data-[slot=open]:zoom-in-97 data-[slot=open]:ease-out data-[slot=open]:duration-200 flex flex-col justify-between h-full p-4"
          >
            <nav className="flex flex-col gap-1" aria-label="Mobile navigation">
              {NAV_ITEMS.map((item) => {
                const active = pathname === item.href || pathname.startsWith(item.href + "/")
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "px-4 py-3 rounded-xl text-base font-medium transition-colors",
                      active
                        ? "bg-primary/10 text-primary"
                        : "text-foreground/70 hover:text-foreground hover:bg-accent/60"
                    )}
                  >
                    {item.label}
                  </Link>
                )
              })}
              {isAdmin && (
                <Link
                  href="/admin"
                  aria-current={pathname.startsWith("/admin") ? "page" : undefined}
                  className={cn(
                    "px-4 py-3 rounded-xl text-base font-medium transition-colors",
                    pathname.startsWith("/admin")
                      ? "bg-primary/10 text-primary"
                      : "text-foreground/70 hover:text-foreground hover:bg-accent/60"
                  )}
                >
                  Admin
                </Link>
              )}
            </nav>
            <div className="flex flex-col gap-2 pb-2">
              {authedUser ? (
                <>
                  <span className="px-4 text-xs font-mono text-foreground/45">@{authedUser.handle}</span>
                  <button
                    onClick={() => { setMobileMenuOpen(false); logout().catch(() => {}) }}
                    className="px-4 py-3 text-sm font-medium text-foreground/60 hover:text-foreground text-left rounded-xl hover:bg-accent/60 transition-colors"
                  >
                    Sign out
                  </button>
                </>
              ) : (
                <>
                  <button
                    onClick={() => { setMobileMenuOpen(false); setSignInOpen(true) }}
                    className="px-4 py-3 text-sm font-medium text-foreground/70 hover:text-foreground text-left rounded-xl hover:bg-accent/60 transition-colors"
                  >
                    Sign in
                  </button>
                  <Button
                    onClick={() => { setMobileMenuOpen(false); setSignInOpen(true) }}
                    className="w-full bg-primary text-primary-foreground hover:bg-primary-dark rounded-full text-sm shadow-[0_2px_8px_rgba(200,97,44,0.28)] transition-all"
                  >
                    Connect Bluesky
                  </Button>
                </>
              )}
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* ── Page content ────────────────────────────────────────── */}
      <main className="flex-1">
        {children}
      </main>

      <SignInDialog open={signInOpen} onOpenChange={setSignInOpen} />
    </div>
  )
}
