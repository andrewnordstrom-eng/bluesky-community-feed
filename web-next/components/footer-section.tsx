import Link from "next/link"

export function FooterSection() {
  return (
    <footer className="w-full bg-background border-t border-border/70">
      <div className="w-full max-w-[1320px] mx-auto px-5">
      {/* Main footer row */}
      <div className="flex flex-col md:flex-row justify-between items-start gap-8 md:gap-0 py-10 md:py-14">
        {/* Left: Logo + tagline */}
        <div className="flex flex-col justify-start items-start gap-5">
          <span className="text-foreground text-xl font-bold tracking-tight font-display">Corgi</span>
          <p className="text-foreground/50 text-sm font-normal leading-relaxed max-w-[200px]">
            Your community runs the feed. No hidden algorithm.
          </p>
          <div className="flex justify-start items-center gap-3">
            <a
              href="https://bsky.app"
              aria-label="Bluesky"
              className="text-foreground/40 hover:text-primary transition-colors text-xs font-medium"
              target="_blank"
              rel="noopener noreferrer"
            >
              Bluesky
            </a>
            <span className="text-foreground/20">·</span>
            <a
              href="https://github.com/andrewnordstrom-eng/bluesky-community-feed"
              aria-label="GitHub"
              className="text-foreground/40 hover:text-primary transition-colors text-xs font-medium"
              target="_blank"
              rel="noopener noreferrer"
            >
              GitHub
            </a>
          </div>
        </div>

        {/* Right: Links */}
        <div className="grid grid-cols-2 md:grid-cols-3 gap-8 md:gap-12 w-full md:w-auto">
          <div className="flex flex-col gap-3">
            <h3 className="text-foreground/40 text-xs font-semibold tracking-wide uppercase">Product</h3>
            <div className="flex flex-col gap-2">
              <a href="#features-section" className="text-foreground/70 text-sm font-normal leading-5 hover:text-primary transition-colors">
                How it works
              </a>
              <Link href="/demo" className="text-foreground/70 text-sm font-normal leading-5 hover:text-primary transition-colors">
                Score breakdown
              </Link>
              <Link href="/history" className="text-foreground/70 text-sm font-normal leading-5 hover:text-primary transition-colors">
                Epoch history
              </Link>
            </div>
          </div>
          <div className="flex flex-col gap-3">
            <h3 className="text-foreground/40 text-xs font-semibold tracking-wide uppercase">Governance</h3>
            <div className="flex flex-col gap-2">
              <Link href="/vote" className="text-foreground/70 text-sm font-normal leading-5 hover:text-primary transition-colors">
                Voting guide
              </Link>
              <Link href="/dashboard" className="text-foreground/70 text-sm font-normal leading-5 hover:text-primary transition-colors">
                Audit ledger
              </Link>
              <Link href="/research-consent" className="text-foreground/70 text-sm font-normal leading-5 hover:text-primary transition-colors">
                Research consent
              </Link>
            </div>
          </div>
          <div className="flex flex-col gap-3">
            <h3 className="text-foreground/40 text-xs font-semibold tracking-wide uppercase">Resources</h3>
            <div className="flex flex-col gap-2">
              <a href="#faq-section" className="text-foreground/70 text-sm font-normal leading-5 hover:text-primary transition-colors">
                FAQ
              </a>
              <a
                href="https://docs.corgi.network"
                className="text-foreground/70 text-sm font-normal leading-5 hover:text-primary transition-colors"
                target="_blank"
                rel="noopener noreferrer"
              >
                Documentation
              </a>
              <a
                href="https://docs.corgi.network/openapi.json"
                className="text-foreground/70 text-sm font-normal leading-5 hover:text-primary transition-colors"
                target="_blank"
                rel="noopener noreferrer"
              >
                Export API
              </a>
              <Link href="/privacy" className="text-foreground/70 text-sm font-normal leading-5 hover:text-primary transition-colors">
                Privacy policy
              </Link>
            </div>
          </div>
        </div>
      </div>

      {/* Copyright bar */}
      <div className="border-t border-border/60 py-5 flex flex-col sm:flex-row items-center justify-between gap-2">
        <p className="text-foreground/30 text-xs font-normal">
          &copy; 2025 Corgi. Built on Bluesky.
        </p>
        <p className="text-foreground/20 text-xs font-normal">
          Open source &middot; No black box
        </p>
      </div>
      </div>
    </footer>
  )
}
