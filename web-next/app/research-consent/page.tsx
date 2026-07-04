"use client"

import { useState } from "react"
import Link from "next/link"
import Image from "next/image"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Button } from "@/components/ui/button"
import { AppShell } from "@/components/app-shell"
import { SignInDialog } from "@/components/sign-in-dialog"
import { useAuth } from "@/components/auth-provider"
import { ErrorCard, Skeleton } from "@/components/ui/state-kit"
import { consentApi } from "@/lib/api/client"

/* ── Sub-components ──────────────────────────────────────────── */

function DisclosureSection({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <div className="h-px flex-1 bg-border/60" />
        <span className="text-[10px] font-mono uppercase tracking-widest text-foreground/40 px-1">
          {label}
        </span>
        <div className="h-px flex-1 bg-border/60" />
      </div>
      <div className="flex flex-col gap-2">{children}</div>
    </div>
  )
}

function DisclosureRow({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3">
      <span className="mt-[5px] flex-shrink-0 w-1 h-1 rounded-full bg-primary/50" aria-hidden="true" />
      <p className="text-sm text-foreground/65 leading-relaxed">{children}</p>
    </div>
  )
}

function Spinner() {
  return (
    <span
      className="w-3.5 h-3.5 rounded-full border-2 border-current/30 border-t-current animate-spin"
      aria-hidden="true"
    />
  )
}

function StepDot({ label, done, active }: { label: string; done?: boolean; active?: boolean }) {
  return (
    <div className="flex flex-col items-center gap-1.5">
      <div
        className={`w-2 h-2 rounded-full transition-colors
          ${done ? "bg-success" : active ? "bg-primary" : "bg-border"}`}
        aria-hidden="true"
      />
      <span className={`text-[10px] font-mono ${active ? "text-foreground/70" : "text-foreground/35"}`}>
        {label}
      </span>
    </div>
  )
}

/* ── Page ─────────────────────────────────────────────────────── */

export default function ResearchConsentPage() {
  const { isAuthenticated } = useAuth()
  const queryClient = useQueryClient()
  const [signInOpen, setSignInOpen] = useState(false)

  // Timestamp captured AT submission success — never read from `new Date()` at
  // render time (prior CR finding: a render-time clock drifts on re-render and
  // misrepresents when consent was actually recorded).
  const [submittedAt, setSubmittedAt] = useState<Date | null>(null)

  // Current stored consent. Only fetched once authenticated; a 401 would be an
  // expected "not signed in" answer, but `enabled` keeps us from asking at all.
  const consentQuery = useQuery({
    queryKey: ["research-consent"],
    queryFn: consentApi.getStatus,
    enabled: isAuthenticated,
    retry: false,
  })

  // POST the decision, then invalidate the status query so a revisit reflects
  // the stored answer. No setTimeout anywhere → nothing to clean up on unmount.
  const submitMutation = useMutation({
    mutationFn: (consent: boolean) => consentApi.submit(consent),
    onSuccess: () => {
      setSubmittedAt(new Date())
      void queryClient.invalidateQueries({ queryKey: ["research-consent"] })
    },
  })

  const isSaving = submitMutation.isPending
  const savingAgree = isSaving && submitMutation.variables === true
  const savingDecline = isSaving && submitMutation.variables === false

  const stored = consentQuery.data
  const hasStoredDecision = stored != null && stored.consent !== null
  const justSubmitted = submitMutation.isSuccess
  const isDone = justSubmitted || hasStoredDecision

  const agreed = justSubmitted ? submitMutation.variables === true : stored?.consent === true
  const recordedAt = justSubmitted
    ? (stored?.consentedAt ? new Date(stored.consentedAt) : submittedAt)
    : stored?.consentedAt
      ? new Date(stored.consentedAt)
      : null
  const consentVersion = stored?.consentVersion ?? null

  /* ── Content selection ────────────────────────────────────── */
  let content: React.ReactNode

  if (!isAuthenticated) {
    /* Unauthenticated → sign-in prompt (SignInDialog pattern from vote page) */
    content = (
      <div className="min-h-[calc(100vh-56px)] flex items-center justify-center px-5 py-16">
        <div className="w-full max-w-[440px] flex flex-col items-center text-center gap-6">
          <Image src="/images/corgi-icon.svg" alt="Corgi" width={51} height={36} className="w-[51px] h-9" />
          <div className="flex flex-col gap-2">
            <h1 className="font-display text-xl font-bold text-foreground tracking-normal">
              Sign in to manage research participation
            </h1>
            <p className="text-sm text-foreground/60 leading-relaxed">
              Your research consent is tied to your Bluesky account. Connect your account to view or change your decision.
            </p>
          </div>
          <Button
            onClick={() => setSignInOpen(true)}
            className="bg-primary text-primary-foreground hover:bg-primary-dark rounded-full px-8 text-sm shadow-[0_2px_8px_rgba(200,97,44,0.3)] hover:shadow-[0_4px_14px_rgba(200,97,44,0.4)] transition-all"
          >
            Connect Bluesky
          </Button>
        </div>
      </div>
    )
  } else if (consentQuery.isLoading) {
    /* Authenticated, loading the stored decision */
    content = (
      <div className="min-h-[calc(100vh-56px)] flex items-center justify-center px-5 py-16">
        <div className="w-full max-w-[480px] rounded-2xl border border-border bg-card p-8 flex flex-col gap-5" aria-busy="true">
          <Skeleton className="h-9 w-9 rounded-full self-center" />
          <Skeleton className="h-6 w-48 self-center" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-5/6" />
          <Skeleton className="h-11 w-full rounded-full mt-2" />
          <Skeleton className="h-11 w-full rounded-full" />
        </div>
      </div>
    )
  } else if (consentQuery.isError) {
    content = (
      <div className="min-h-[calc(100vh-56px)] flex items-center justify-center px-5 py-16">
        <div className="w-full max-w-[480px]">
          <ErrorCard
            heading="Couldn't load your consent status"
            body="We couldn't retrieve your current research participation preference. Try again in a moment."
            onRetry={() => void consentQuery.refetch()}
          />
        </div>
      </div>
    )
  } else if (isDone) {
    /* ── Success / current-decision confirmation ─────────────── */
    content = (
      <div className="min-h-[calc(100vh-56px)] flex items-center justify-center px-5 py-16">
        <div className="w-full max-w-[440px] flex flex-col items-center text-center gap-6">
          {/* Icon */}
          <div className={`w-14 h-14 rounded-full flex items-center justify-center
            ${agreed ? "bg-success/10 border border-success/25" : "bg-biscuit border border-border"}`}>
            {agreed ? (
              <svg width="22" height="22" viewBox="0 0 22 22" fill="none" aria-hidden="true">
                <path d="M4 11l5 5 9-9" stroke="hsl(var(--status-success))" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            ) : (
              <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
                <path d="M9 3v6M9 12v1.5" stroke="hsl(var(--text-body, var(--foreground)))" strokeWidth="1.75" strokeLinecap="round" />
              </svg>
            )}
          </div>

          {/* Copy */}
          <div className="flex flex-col gap-2">
            <h1 className="font-display text-xl font-bold text-foreground tracking-normal">
              {agreed ? "Thanks for participating" : "No problem at all"}
            </h1>
            <p className="text-sm text-foreground/60 leading-relaxed">
              {agreed
                ? "Your consent has been recorded. This doesn't change how you vote or how the feed works — it just lets us include your activity in aggregate research."
                : "Your preference has been saved. Participation is entirely optional and has no effect on your voting rights or feed experience."}
            </p>
          </div>

          {/* Consent receipt — reflects what the backend recorded */}
          {agreed && (
            <div className="w-full rounded-xl border border-border bg-card px-5 py-4 flex flex-col gap-2 text-left">
              <p className="text-[10px] font-mono uppercase tracking-widest text-foreground/40">Consent receipt</p>
              <div className="flex flex-col gap-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-foreground/50">Decision</span>
                  <span className="text-xs font-mono text-success font-semibold">Agreed</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-foreground/50">Version</span>
                  <span className="text-xs font-mono text-foreground/70">{consentVersion ?? "—"}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-foreground/50">Recorded at</span>
                  <span className="text-xs font-mono text-foreground/70">
                    {recordedAt ? recordedAt.toLocaleString([], { dateStyle: "medium", timeStyle: "short" }) : "—"}
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* Withdrawal note */}
          <p className="text-xs text-foreground/45 leading-relaxed max-w-xs">
            You can change this at any time by contacting{" "}
            <a href="mailto:hello@corgi.network" className="text-primary hover:underline underline-offset-2">
              hello@corgi.network
            </a>.
          </p>

          {/* CTA */}
          <Button
            asChild
            className="bg-primary text-primary-foreground hover:bg-primary-dark rounded-full px-8 text-sm shadow-[0_2px_8px_rgba(200,97,44,0.3)] hover:shadow-[0_4px_14px_rgba(200,97,44,0.4)] transition-all"
          >
            <Link href="/vote">Go to ballot →</Link>
          </Button>
        </div>
      </div>
    )
  } else {
    /* ── Main consent card ────────────────────────────────────── */
    content = (
      <div className="min-h-[calc(100vh-56px)] flex items-center justify-center px-5 py-16">
        <div className="w-full max-w-[480px] flex flex-col gap-0">

          {/* Card */}
          <div className="rounded-2xl border border-border bg-card shadow-[0_4px_24px_rgba(46,38,32,0.06)] overflow-hidden">

            {/* Card header */}
            <div className="flex flex-col items-center gap-4 pt-8 pb-6 px-8 text-center border-b border-border/60">
              <Image src="/images/corgi-icon.svg" alt="Corgi" width={51} height={36} className="w-[51px] h-9" />
              <div className="flex flex-col gap-1.5">
                <h1 className="font-display text-xl font-bold text-foreground tracking-normal">
                  Research participation
                </h1>
                <p className="text-sm text-foreground/55 leading-relaxed max-w-xs">
                  Corgi is part of an academic study on community-governed feeds. Here is what that means for you.
                </p>
              </div>
            </div>

            {/* Disclosure body */}
            <div className="flex flex-col gap-6 px-8 py-6">

              <DisclosureSection label="What participation means">
                <DisclosureRow>
                  Your voting patterns and feed interactions may be included in aggregate, anonymised research data.
                </DisclosureRow>
                <DisclosureRow>
                  No post content, personal messages, or identifiable information is collected.
                </DisclosureRow>
                <DisclosureRow>
                  Participation is <strong className="font-semibold text-foreground/80">entirely optional</strong> and does not affect your voting rights or feed experience in any way.
                </DisclosureRow>
              </DisclosureSection>

              <DisclosureSection label="What happens if you decline">
                <DisclosureRow>
                  Your activity will not be included in any research dataset. Everything else stays exactly the same — you can still vote, view scores, and use the feed normally.
                </DisclosureRow>
                <DisclosureRow>
                  You can change your decision at any time by emailing{" "}
                  <a href="mailto:hello@corgi.network" className="text-primary hover:underline underline-offset-2">
                    hello@corgi.network
                  </a>.
                </DisclosureRow>
              </DisclosureSection>

              {/* Error state */}
              {submitMutation.isError && (
                <div className="rounded-lg bg-status-error/5 border border-status-error/25 px-4 py-3 text-sm text-status-error">
                  Something went wrong saving your preference. Please try again.
                </div>
              )}

              {/* Action row — symmetric buttons */}
              <div className="flex flex-col gap-3 pt-1">
                <Button
                  onClick={() => submitMutation.mutate(true)}
                  disabled={isSaving}
                  className="w-full bg-primary text-primary-foreground hover:bg-primary-dark rounded-full py-2.5 text-sm font-medium shadow-[0_2px_8px_rgba(200,97,44,0.3)] hover:shadow-[0_4px_14px_rgba(200,97,44,0.4)] transition-all disabled:opacity-60"
                >
                  {savingAgree ? (
                    <span className="flex items-center justify-center gap-2">
                      <Spinner />
                      Saving…
                    </span>
                  ) : (
                    "I agree to participate"
                  )}
                </Button>
                <Button
                  onClick={() => submitMutation.mutate(false)}
                  disabled={isSaving}
                  variant="outline"
                  className="w-full border-border text-foreground/65 hover:text-foreground hover:bg-biscuit/50 rounded-full py-2.5 text-sm font-medium transition-all disabled:opacity-60"
                >
                  {savingDecline ? (
                    <span className="flex items-center justify-center gap-2">
                      <Spinner />
                      Saving…
                    </span>
                  ) : (
                    "No thanks, decline"
                  )}
                </Button>
              </div>

              {/* Trust footer */}
              <p className="text-xs text-foreground/40 text-center leading-relaxed">
                By participating you agree to our{" "}
                <Link href="/privacy" className="text-primary hover:underline underline-offset-2">
                  Privacy Policy
                </Link>
                . You can withdraw consent at any time.
              </p>
            </div>
          </div>

          {/* Step indicator: Sign in → Consent → Vote */}
          <div className="flex items-center justify-center gap-2 mt-6" aria-label="Setup progress">
            <StepDot label="Sign in" done />
            <div className="w-8 h-px bg-border" aria-hidden="true" />
            <StepDot label="Consent" active />
            <div className="w-8 h-px bg-border/40" aria-hidden="true" />
            <StepDot label="Vote" />
          </div>
        </div>
      </div>
    )
  }

  return (
    <AppShell>
      {content}
      <SignInDialog open={signInOpen} onOpenChange={setSignInOpen} />
    </AppShell>
  )
}
