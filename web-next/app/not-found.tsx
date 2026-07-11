import Link from "next/link"
import { Header } from "@/components/header"
import { FooterSection } from "@/components/footer-section"
import { Button } from "@/components/ui/button"

export default function NotFound() {
  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Header />
      <main className="flex-1 flex items-center justify-center px-5 py-20 md:py-28">
        <div className="w-full max-w-md flex flex-col items-center gap-4 text-center">
          <p className="text-[11px] font-mono uppercase tracking-[0.22em] text-foreground/45">404</p>
          <h1 className="font-display text-3xl md:text-4xl font-bold tracking-tight text-foreground leading-tight text-balance">
            This page ran off with the ball.
          </h1>
          <p className="max-w-sm text-base leading-relaxed text-foreground/60">
            The page you&rsquo;re looking for doesn&rsquo;t exist or has moved. The feed is still right where you left it.
          </p>
          <div className="mt-3 flex flex-col sm:flex-row items-center gap-3">
            <Button
              asChild
              className="bg-primary text-primary-foreground hover:bg-primary-dark rounded-full px-6 py-3 text-base font-medium shadow-[0_2px_8px_rgba(200,97,44,0.3)] transition-all"
            >
              <Link href="/">Back to home</Link>
            </Button>
            <Link
              href="/demo"
              className="rounded-full px-5 py-3 text-base font-medium text-foreground/70 hover:text-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            >
              Explore the live demo &rarr;
            </Link>
          </div>
        </div>
      </main>
      <FooterSection />
    </div>
  )
}
