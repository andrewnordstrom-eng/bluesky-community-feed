"use client"

import { useEffect, useRef, useState } from "react"
import axios from "axios"
import Image from "next/image"
import Link from "next/link"
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { useAuth } from "@/components/auth-provider"
import { waitlistApi } from "@/lib/api/client"

type AccessMode = "signin" | "waitlist"

const NOTE_MAX = 500

interface SignInDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Which face the dialog opens on. Defaults to "signin" for back-compat. */
  initialMode?: AccessMode
}

export function SignInDialog({ open, onOpenChange, initialMode = "signin" }: SignInDialogProps) {
  const { login } = useAuth()
  const [mode, setMode] = useState<AccessMode>(initialMode)

  // Shared handle across both modes so switching carries it over.
  const [handle, setHandle] = useState("")

  // Sign-in state
  const [password, setPassword] = useState("")
  const [showPassword, setShowPassword] = useState(false)
  const [signInLoading, setSignInLoading] = useState(false)
  const [signInError, setSignInError] = useState<string | null>(null)
  const [notApproved, setNotApproved] = useState(false)

  // Waitlist state
  const [note, setNote] = useState("")
  const [waitlistState, setWaitlistState] = useState<"idle" | "submitting" | "success" | "error">("idle")
  const [waitlistError, setWaitlistError] = useState<string | null>(null)

  const isMounted = useRef(true)
  useEffect(() => {
    isMounted.current = true
    return () => {
      isMounted.current = false
    }
  }, [])

  // Seed the mode the host asked for each time the dialog opens (the host sets
  // initialMode then opens), and reset all transient state on close so it
  // reopens clean. Deps are [open, initialMode] only, so a user's in-dialog
  // mode switch — which changes neither — is never clobbered.
  useEffect(() => {
    if (open) {
      setMode(initialMode)
      return
    }
    setMode(initialMode)
    setHandle("")
    setPassword("")
    setShowPassword(false)
    setSignInLoading(false)
    setSignInError(null)
    setNotApproved(false)
    setNote("")
    setWaitlistState("idle")
    setWaitlistError(null)
  }, [open, initialMode])

  const goToWaitlist = () => {
    setMode("waitlist")
    setWaitlistState("idle")
    setWaitlistError(null)
  }

  const goToSignin = () => {
    setMode("signin")
    setSignInError(null)
    setNotApproved(false)
  }

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault()
    setSignInError(null)
    setNotApproved(false)
    setSignInLoading(true)
    try {
      await login(handle, password)
      if (!isMounted.current) return
      onOpenChange(false)
    } catch (err) {
      if (!isMounted.current) return
      if (axios.isAxiosError(err) && err.response?.status === 403 && err.response.data?.waitlist) {
        // Valid credentials, but the account isn't approved for the pilot.
        setNotApproved(true)
      } else {
        setSignInError("Check your handle and app password.")
      }
    } finally {
      if (isMounted.current) setSignInLoading(false)
    }
  }

  const handleWaitlist = async (e: React.FormEvent) => {
    e.preventDefault()
    setWaitlistError(null)
    setWaitlistState("submitting")
    try {
      await waitlistApi.join(handle, note)
      if (!isMounted.current) return
      setWaitlistState("success")
    } catch (err) {
      if (!isMounted.current) return
      setWaitlistState("error")
      if (axios.isAxiosError(err) && err.response?.status === 429) {
        setWaitlistError("Too many attempts — wait a minute and try again.")
      } else {
        setWaitlistError("Couldn't submit your request. Try again.")
      }
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-card border border-border shadow-xl rounded-2xl p-0 max-w-[440px] w-full overflow-hidden gap-0">

        {/* Header band */}
        <div className="px-8 pt-8 pb-6 flex flex-col items-center gap-3 border-b border-border">
          <Image src="/images/corgi-icon.svg" alt="Corgi" width={51} height={36} className="w-[51px] h-9" />
          <div className="space-y-1.5 text-center">
            <DialogTitle className="text-foreground font-display text-2xl font-bold tracking-tight leading-tight">
              {mode === "waitlist"
                ? (waitlistState === "success" ? "Request received" : "Join the Corgi waitlist")
                : "Sign in to vote"}
            </DialogTitle>
            <DialogDescription className="text-foreground/55 text-sm leading-relaxed max-w-[320px]">
              {mode === "waitlist"
                ? (waitlistState === "success"
                    ? "Your waitlist request is in."
                    : "Voting is in a limited pilot. Add your Bluesky handle and we'll get you in as we expand — the demo stays open to everyone.")
                : "Connect your Bluesky account to participate in feed governance. You'll need an app password from your Bluesky settings."}
            </DialogDescription>
          </div>
        </div>

        {mode === "waitlist" ? (
          waitlistState === "success" ? (
            /* Success replaces the form */
            <div className="px-8 py-8 flex flex-col items-center gap-3 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-success/12" aria-hidden="true">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
                  <path d="M5 13l4 4L19 7" stroke="hsl(var(--status-success))" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </div>
              <p className="text-foreground font-display text-xl font-bold">You&apos;re on the list.</p>
              <p className="text-foreground/60 text-sm leading-relaxed max-w-[320px]">
                We approve pilot accounts in batches. In the meantime, the demo and every transparency page are open to you now.
              </p>
              <div className="flex items-center gap-3 pt-1">
                <Link
                  href="/demo"
                  onClick={() => onOpenChange(false)}
                  className="text-primary text-sm font-semibold underline underline-offset-2 hover:text-primary-dark transition-colors"
                >
                  Explore the demo
                </Link>
                <span className="text-foreground/30" aria-hidden="true">·</span>
                <button
                  type="button"
                  onClick={() => onOpenChange(false)}
                  className="text-foreground/55 text-sm font-medium hover:text-foreground transition-colors"
                >
                  Close
                </button>
              </div>
            </div>
          ) : (
            <form onSubmit={handleWaitlist} className="px-8 py-6 flex flex-col gap-5">
              <div className="flex flex-col gap-2">
                <Label htmlFor="wl-handle" className="text-foreground/80 text-sm font-medium">
                  Bluesky handle
                </Label>
                <Input
                  id="wl-handle"
                  type="text"
                  placeholder="you.bsky.social"
                  value={handle}
                  onChange={(e) => setHandle(e.target.value)}
                  autoComplete="username"
                  className="bg-background border-border text-foreground placeholder:text-foreground/55 rounded-xl h-11 px-4 text-sm focus-visible:ring-primary focus-visible:ring-1 focus-visible:border-primary transition-colors"
                />
              </div>

              <div className="flex flex-col gap-2">
                <div className="flex items-baseline justify-between">
                  <Label htmlFor="wl-note" className="text-foreground/80 text-sm font-medium">
                    Anything we should know? <span className="text-foreground/45 font-normal">(optional)</span>
                  </Label>
                  <span className="text-foreground/40 text-xs font-mono">{note.length}/{NOTE_MAX}</span>
                </div>
                <Textarea
                  id="wl-note"
                  placeholder="Which community are you part of? What do you want the feed to do?"
                  value={note}
                  onChange={(e) => setNote(e.target.value.slice(0, NOTE_MAX))}
                  maxLength={NOTE_MAX}
                  rows={3}
                  className="bg-background border-border text-foreground placeholder:text-foreground/50 rounded-xl px-4 py-3 text-sm resize-none focus-visible:ring-primary focus-visible:ring-1 focus-visible:border-primary transition-colors"
                />
              </div>

              {waitlistState === "error" && waitlistError && (
                <p role="alert" className="text-status-error text-sm font-medium leading-relaxed -mt-1">
                  {waitlistError}
                </p>
              )}

              <Button
                type="submit"
                disabled={waitlistState === "submitting" || !handle.trim()}
                className="w-full h-11 bg-primary text-primary-foreground hover:bg-primary-dark rounded-xl font-semibold text-sm transition-colors shadow-sm disabled:opacity-50 mt-1"
              >
                {waitlistState === "submitting" ? "Submitting..." : "Join the waitlist"}
              </Button>

              <p className="text-center text-foreground/55 text-xs leading-relaxed">
                Already approved?{" "}
                <button type="button" onClick={goToSignin} className="text-primary font-medium underline underline-offset-2 hover:text-primary-dark transition-colors">
                  Sign in
                </button>
              </p>
            </form>
          )
        ) : (
          /* ── Sign-in mode ────────────────────────────────── */
          <form onSubmit={handleSignIn} className="px-8 py-6 flex flex-col gap-5">
            <div className="flex flex-col gap-2">
              <Label htmlFor="handle" className="text-foreground/80 text-sm font-medium">
                Bluesky handle
              </Label>
              <Input
                id="handle"
                type="text"
                placeholder="you.bsky.social"
                value={handle}
                onChange={(e) => setHandle(e.target.value)}
                autoComplete="username"
                className="bg-background border-border text-foreground placeholder:text-foreground/55 rounded-xl h-11 px-4 text-sm focus-visible:ring-primary focus-visible:ring-1 focus-visible:border-primary transition-colors"
              />
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="password" className="text-foreground/80 text-sm font-medium">
                App password
              </Label>
              <div className="relative">
                <Input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  placeholder="xxxx-xxxx-xxxx-xxxx"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="current-password"
                  className="bg-background border-border text-foreground placeholder:text-foreground/55 rounded-xl h-11 px-4 pr-12 text-sm focus-visible:ring-primary focus-visible:ring-1 focus-visible:border-primary transition-colors"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3.5 top-1/2 -translate-y-1/2 text-foreground/50 hover:text-foreground/70 transition-colors text-xs font-medium"
                  aria-label={showPassword ? "Hide password" : "Show password"}
                >
                  {showPassword ? "hide" : "show"}
                </button>
              </div>
              <p className="text-foreground/55 text-xs leading-relaxed">
                Create an app password in{" "}
                <a href="https://bsky.app/settings/app-passwords" target="_blank" rel="noopener noreferrer" className="text-primary underline underline-offset-2 hover:text-primary-dark transition-colors">
                  Bluesky Settings
                </a>
                . It looks like <span className="font-mono text-foreground/60">xxxx-xxxx-xxxx-xxxx</span>.
              </p>
            </div>

            {notApproved && (
              <div role="alert" className="rounded-xl bg-primary/[0.06] border border-primary/20 px-4 py-3 flex flex-col gap-1.5 -mt-1">
                <p className="text-foreground/85 text-sm font-semibold">Your account isn&apos;t approved yet.</p>
                <p className="text-foreground/60 text-xs leading-relaxed">
                  Corgi voting is in a limited pilot. Join the waitlist and we&apos;ll get you in as we expand.
                </p>
                <button
                  type="button"
                  onClick={goToWaitlist}
                  className="self-start mt-1 text-primary text-sm font-semibold underline underline-offset-2 hover:text-primary-dark transition-colors"
                >
                  Join the waitlist
                </button>
              </div>
            )}

            {signInError && (
              <p role="alert" className="text-status-error text-sm font-medium leading-relaxed -mt-1">
                {signInError}
              </p>
            )}

            <Button
              type="submit"
              disabled={signInLoading || !handle || !password}
              className="w-full h-11 bg-primary text-primary-foreground hover:bg-primary-dark rounded-xl font-semibold text-sm transition-colors shadow-sm disabled:opacity-50 mt-1"
            >
              {signInLoading ? "Signing in..." : "Sign in"}
            </Button>

            <p className="text-center text-foreground/55 text-xs leading-relaxed">
              Not approved yet?{" "}
              <button type="button" onClick={goToWaitlist} className="text-primary font-medium underline underline-offset-2 hover:text-primary-dark transition-colors">
                Join the waitlist
              </button>
            </p>

            <p className="text-center text-foreground/50 text-xs leading-relaxed">
              By signing in, you agree to our{" "}
              <Link href="/tos" className="text-foreground/60 underline underline-offset-2 hover:text-foreground transition-colors">
                Terms of Service
              </Link>{" "}
              and{" "}
              <Link href="/privacy" className="text-foreground/60 underline underline-offset-2 hover:text-foreground transition-colors">
                Privacy Policy
              </Link>
              .
            </p>
          </form>
        )}

      </DialogContent>
    </Dialog>
  )
}
