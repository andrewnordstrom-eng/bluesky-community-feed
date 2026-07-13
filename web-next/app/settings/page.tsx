"use client"

import { useState, type ReactNode } from "react"
import Link from "next/link"
import Image from "next/image"
import { useQuery } from "@tanstack/react-query"
import { AppShell } from "@/components/app-shell"
import { Container } from "@/components/ui/layout"
import { SignInDialog } from "@/components/sign-in-dialog"
import { useAuth } from "@/components/auth-provider"
import { Button } from "@/components/ui/button"
import { ErrorCard, Skeleton } from "@/components/ui/state-kit"
import { consentApi } from "@/lib/api/client"

const BSKY_APP_PASSWORDS_URL = "https://bsky.app/settings/app-passwords"

function SettingsCard({
  title,
  description,
  children,
}: {
  title: string
  description?: string
  children: ReactNode
}) {
  return (
    <section className="rounded-2xl border border-border bg-card p-5 shadow-[0_2px_10px_rgba(46,38,32,0.05)] sm:p-6">
      <h2 className="text-base font-bold text-foreground">{title}</h2>
      {description ? <p className="mt-1 text-sm leading-relaxed text-foreground/60">{description}</p> : null}
      <div className="mt-4">{children}</div>
    </section>
  )
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-border/50 py-2.5 last:border-0">
      <span className="text-sm text-foreground/55">{label}</span>
      <span className="font-mono text-xs text-foreground/80 truncate max-w-[60%] text-right">{value}</span>
    </div>
  )
}

function formatDate(value: string | null | undefined): string {
  if (!value) return "—"
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString([], { dateStyle: "medium", timeStyle: "short" })
}

export default function SettingsPage() {
  const { isAuthenticated, isLoading, session, logout } = useAuth()
  const [signInOpen, setSignInOpen] = useState(false)
  const [logoutError, setLogoutError] = useState<string | null>(null)
  const [logoutPending, setLogoutPending] = useState(false)

  const handleLogout = async (): Promise<void> => {
    if (logoutPending) return

    setLogoutPending(true)
    setLogoutError(null)
    try {
      await logout()
    } catch {
      setLogoutError("Sign out failed. Check your connection and try again.")
    } finally {
      setLogoutPending(false)
    }
  }

  const consentQuery = useQuery({
    queryKey: ["research-consent"],
    queryFn: consentApi.getStatus,
    enabled: isAuthenticated,
    retry: false,
  })

  let content: ReactNode

  if (isLoading) {
    content = (
      <Container width="doc" className="flex flex-col gap-4 py-16" aria-busy="true">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-32 w-full rounded-2xl" />
        <Skeleton className="h-32 w-full rounded-2xl" />
      </Container>
    )
  } else if (!isAuthenticated) {
    content = (
      <div className="min-h-[calc(100vh-56px)] flex items-center justify-center px-5 py-16">
        <div className="w-full max-w-[440px] flex flex-col items-center text-center gap-6">
          <Image src="/images/corgi-icon.svg" alt="Corgi" width={51} height={36} className="w-[51px] h-9" />
          <div className="flex flex-col gap-2">
            <h1 className="font-display text-xl font-bold text-foreground">Sign in to manage your account</h1>
            <p className="text-sm text-foreground/60 leading-relaxed">
              Your settings are tied to your Bluesky account. Connect to view your session, participation, and access.
            </p>
          </div>
          <Button
            onClick={() => setSignInOpen(true)}
            className="bg-primary text-primary-foreground hover:bg-primary-dark rounded-full px-8 text-sm shadow-[0_2px_8px_rgba(200,97,44,0.3)] transition-all"
          >
            Connect Bluesky
          </Button>
        </div>
      </div>
    )
  } else {
    const consent = consentQuery.data
    const consentLabel =
      consent == null || consent.consent === null
        ? "Not decided"
        : consent.consent
          ? "Participating"
          : "Not participating"

    content = (
      <Container width="doc" className="flex flex-col gap-5 py-10 md:py-14">
        <div>
          <p className="text-[11px] font-mono uppercase tracking-[0.22em] text-foreground/55">Account</p>
          <h1 className="mt-2 font-display text-3xl font-bold tracking-tight text-foreground">Settings</h1>
        </div>

        <SettingsCard title="Account" description="Your connected Bluesky identity.">
          <div className="flex flex-col">
            <InfoRow label="Handle" value={session?.handle ? `@${session.handle}` : "—"} />
            <InfoRow label="DID" value={session?.did ?? "—"} />
            <InfoRow label="Session expires" value={formatDate(session?.expiresAt)} />
          </div>
        </SettingsCard>

        <SettingsCard
          title="Research participation"
          description="Optional. Participation never affects your voting rights or feed."
        >
          {consentQuery.isLoading ? (
            <Skeleton className="h-5 w-40" />
          ) : consentQuery.isError ? (
            <ErrorCard
              heading="Couldn't load your consent status"
              body="Try again in a moment."
              onRetry={() => void consentQuery.refetch()}
            />
          ) : (
            <div className="flex items-center justify-between gap-4">
              <span className="text-sm text-foreground/70">
                Status: <span className="font-semibold text-foreground">{consentLabel}</span>
              </span>
              <Link
                href="/research-consent"
                className="text-sm font-semibold text-primary hover:underline underline-offset-2"
              >
                Change &rarr;
              </Link>
            </div>
          )}
        </SettingsCard>

        <SettingsCard
          title="Bluesky app password"
          description="Corgi only ever holds a scoped app password — never your real password."
        >
          <p className="text-sm leading-relaxed text-foreground/65">
            To disconnect Corgi, remove its app password from your Bluesky settings. Corgi loses access immediately.
          </p>
          <a
            href={BSKY_APP_PASSWORDS_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-3 inline-flex text-sm font-semibold text-primary hover:underline underline-offset-2"
          >
            Manage app passwords on Bluesky &rarr;
          </a>
        </SettingsCard>

        <SettingsCard title="Notifications" description="Round openings, results, and audit alerts.">
          {/* No notification-preferences endpoint exists yet; point to the dashboard. */}
          <p className="text-sm leading-relaxed text-foreground/55">
            Notification preferences aren&rsquo;t available yet. For now, round changes are announced on the{" "}
            <Link href="/dashboard" className="text-primary hover:underline underline-offset-2">
              dashboard
            </Link>
            .
          </p>
        </SettingsCard>

        <div className="flex items-center justify-between gap-4 pt-2">
          <p className="text-xs text-foreground/50">Signed in as {session?.handle ? `@${session.handle}` : "your account"}.</p>
          <Button
            onClick={() => void handleLogout()}
            disabled={logoutPending}
            aria-busy={logoutPending}
            variant="outline"
            className="border-border text-foreground/70 hover:text-foreground hover:bg-biscuit/50 rounded-full px-5 text-sm"
          >
            {logoutPending ? "Signing out..." : "Sign out"}
          </Button>
        </div>
        {logoutError ? <p role="alert" className="text-right text-xs text-destructive">{logoutError}</p> : null}
      </Container>
    )
  }

  return (
    <AppShell user={session ? { handle: session.handle, did: session.did } : null}>
      {content}
      <SignInDialog open={signInOpen} onOpenChange={setSignInOpen} />
    </AppShell>
  )
}
