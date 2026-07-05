"use client"

import { useEffect, useRef, useState } from "react"
import Image from "next/image"
import Link from "next/link"
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useAuth } from "@/components/auth-provider"

interface SignInDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function SignInDialog({ open, onOpenChange }: SignInDialogProps) {
  const { login } = useAuth()
  const [handle, setHandle] = useState("")
  const [password, setPassword] = useState("")
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Guards against setting state after the dialog unmounts mid-request. The
  // previous mock used a setTimeout that could fire post-unmount; the real
  // login is awaited, so there are no timers to clear — only this async guard.
  const isMounted = useRef(true)
  useEffect(() => {
    isMounted.current = true
    return () => {
      isMounted.current = false
    }
  }, [])

  // Reset transient form state whenever the dialog closes so it reopens clean.
  useEffect(() => {
    if (!open) {
      setHandle("")
      setPassword("")
      setShowPassword(false)
      setLoading(false)
      setError(null)
    }
  }, [open])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      await login(handle, password)
      if (!isMounted.current) return
      onOpenChange(false)
    } catch {
      if (!isMounted.current) return
      setError("Check your handle and app password.")
    } finally {
      if (isMounted.current) setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-card border border-border shadow-xl rounded-2xl p-0 max-w-[440px] w-full overflow-hidden gap-0">

        {/* Header band */}
        <div className="px-8 pt-8 pb-6 flex flex-col items-center gap-3 border-b border-border">
          <Image
            src="/images/corgi-icon.svg"
            alt="Corgi"
            width={51}
            height={36}
            className="w-[51px] h-9"
          />
          <div className="space-y-1.5 text-center">
            <DialogTitle className="text-foreground font-display text-2xl font-bold tracking-tight leading-tight">
              Sign in to vote
            </DialogTitle>
            <p className="text-foreground/55 text-sm leading-relaxed max-w-[300px]">
              Connect your Bluesky account to participate in feed governance. You&apos;ll need an app password from your Bluesky settings.
            </p>
          </div>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="px-8 py-6 flex flex-col gap-5">

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
              className="bg-background border-border text-foreground placeholder:text-foreground/35 rounded-xl h-11 px-4 text-sm focus-visible:ring-primary focus-visible:ring-1 focus-visible:border-primary transition-colors"
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
                className="bg-background border-border text-foreground placeholder:text-foreground/35 rounded-xl h-11 px-4 pr-12 text-sm focus-visible:ring-primary focus-visible:ring-1 focus-visible:border-primary transition-colors"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3.5 top-1/2 -translate-y-1/2 text-foreground/40 hover:text-foreground/70 transition-colors text-xs font-medium"
                aria-label={showPassword ? "Hide password" : "Show password"}
              >
                {showPassword ? "hide" : "show"}
              </button>
            </div>
            <p className="text-foreground/45 text-xs leading-relaxed">
              Create an app password in{" "}
              <a
                href="https://bsky.app/settings/app-passwords"
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary underline underline-offset-2 hover:text-primary-dark transition-colors"
              >
                Bluesky Settings
              </a>
              . It looks like{" "}
              <span className="font-mono text-foreground/60">xxxx-xxxx-xxxx-xxxx</span>.
            </p>
          </div>

          {error && (
            <p role="alert" className="text-status-error text-sm font-medium leading-relaxed -mt-1">
              {error}
            </p>
          )}

          <Button
            type="submit"
            disabled={loading || !handle || !password}
            className="w-full h-11 bg-primary text-primary-foreground hover:bg-primary-dark rounded-xl font-semibold text-sm transition-colors shadow-sm disabled:opacity-50 mt-1"
          >
            {loading ? "Signing in..." : "Sign in"}
          </Button>

          <p className="text-center text-foreground/40 text-xs leading-relaxed">
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

        {/* Why app password? */}
        <div className="mx-8 mb-8 rounded-xl bg-muted/60 border border-border px-5 py-4 flex flex-col gap-1.5">
          <p className="text-foreground/80 text-xs font-semibold uppercase tracking-wide">Why app password?</p>
          <p className="text-foreground/55 text-xs leading-relaxed">
            App passwords are separate from your main password and can be revoked at any time. They give Corgi access to vote on your behalf without ever exposing your main credentials.
          </p>
        </div>

      </DialogContent>
    </Dialog>
  )
}
