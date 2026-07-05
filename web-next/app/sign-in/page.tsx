"use client"

import { useEffect, useState } from "react"
import Image from "next/image"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { AppShell } from "@/components/app-shell"
import { SignInDialog } from "@/components/sign-in-dialog"
import { Button } from "@/components/ui/button"
import { useAuth } from "@/components/auth-provider"

export default function SignInPage() {
  const router = useRouter()
  const { isAuthenticated, isLoading } = useAuth()
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (isAuthenticated) {
      setOpen(false)
      router.replace("/vote")
      return
    }

    if (!isLoading) {
      setOpen(true)
    }
  }, [isAuthenticated, isLoading, router])

  return (
    <AppShell suppressAuthDialog>
      <main className="min-h-[calc(100vh-56px)] bg-background px-5 py-16 flex items-center justify-center">
        <div className="w-full max-w-[460px] flex flex-col items-center text-center gap-6">
          <Image src="/images/corgi-icon.svg" alt="Corgi" width={68} height={48} className="h-12 w-[68px]" />
          <div className="flex flex-col gap-2">
            <h1 className="font-display text-2xl font-bold text-foreground tracking-normal">
              Sign in to Corgi
            </h1>
            <p className="text-sm text-foreground/60 leading-relaxed">
              Connect your Bluesky account with an app password to vote, manage research participation, and use the governance tools.
            </p>
          </div>

          {isLoading || isAuthenticated ? (
            <p className="text-sm text-foreground/50" aria-live="polite">
              {isAuthenticated ? "Taking you to the ballot..." : "Checking your session..."}
            </p>
          ) : (
            <Button
              onClick={() => setOpen(true)}
              className="bg-primary text-primary-foreground hover:bg-primary-dark rounded-full px-8 text-sm shadow-[0_2px_8px_rgba(200,97,44,0.3)] hover:shadow-[0_4px_14px_rgba(200,97,44,0.4)] transition-all"
            >
              Connect Bluesky
            </Button>
          )}

          <p className="max-w-sm text-xs text-foreground/40 leading-relaxed">
            By signing in, you agree to the{" "}
            <Link href="/tos" className="text-primary hover:underline underline-offset-2">
              Terms of Service
            </Link>{" "}
            and{" "}
            <Link href="/privacy" className="text-primary hover:underline underline-offset-2">
              Privacy Policy
            </Link>
            .
          </p>
        </div>
      </main>
      <SignInDialog open={open && !isLoading && !isAuthenticated} onOpenChange={setOpen} />
    </AppShell>
  )
}
