import React from "react"
import { Button } from "@/components/ui/button"
import Link from "next/link"
import { LIVE_METRICS_SNAPSHOT } from "@/lib/live-metrics-snapshot"

export function HeroSection() {
  return (
    <section
      className="flex flex-col items-center text-center relative mx-auto rounded-2xl overflow-hidden my-4 md:my-6 pt-14 pb-32 md:pt-16 md:pb-44 lg:pt-20 lg:pb-52 px-4 md:px-6
         w-full max-w-[1220px]"
    >
      {/* SVG Background — warm cream grid */}
      <div className="absolute inset-0 z-0">
        <svg
          width="100%"
          height="100%"
          viewBox="0 0 1220 810"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          preserveAspectRatio="xMidYMid slice"
        >
          <rect width="1220" height="810" rx="16" fill="hsl(var(--background))" />
          <g clipPath="url(#clip0_hero)">
            <mask
              id="mask0_hero"
              style={{ maskType: "alpha" }}
              maskUnits="userSpaceOnUse"
              x="10"
              y="-1"
              width="1200"
              height="812"
            >
              <rect x="10" y="-0.84668" width="1200" height="811.693" fill="url(#paint0_linear_hero)" />
            </mask>
            <g mask="url(#mask0_hero)">
              {[...Array(35)].map((_, i) => (
                <React.Fragment key={`row1-${i}`}>
                  {[9, 45, 81, 117, 153, 189, 225, 261, 297, 333, 369, 405, 441, 477, 513, 549, 585, 621, 657, 693, 729, 765].map((y) => (
                    <rect
                      key={y}
                      x={-20.0891 + i * 36}
                      y={y + 0.2}
                      width="35.6"
                      height="35.6"
                      stroke="hsl(var(--foreground))"
                      strokeOpacity="0.06"
                      strokeWidth="0.4"
                      strokeDasharray="2 2"
                    />
                  ))}
                </React.Fragment>
              ))}
              <rect x="699.711" y="81" width="36" height="36" fill="hsl(var(--primary))" fillOpacity="0.07" />
              <rect x="195.711" y="153" width="36" height="36" fill="hsl(var(--primary))" fillOpacity="0.05" />
              <rect x="1023.71" y="153" width="36" height="36" fill="hsl(var(--primary))" fillOpacity="0.05" />
              <rect x="123.711" y="225" width="36" height="36" fill="hsl(var(--primary))" fillOpacity="0.05" />
              <rect x="1095.71" y="225" width="36" height="36" fill="hsl(var(--primary))" fillOpacity="0.05" />
              <rect x="951.711" y="297" width="36" height="36" fill="hsl(var(--primary))" fillOpacity="0.05" />
              <rect x="519.711" y="405" width="36" height="36" fill="hsl(var(--primary))" fillOpacity="0.07" />
            </g>

            {/* Warm ginger glow — top right */}
            <g filter="url(#filter0_f_hero)">
              <ellipse
                cx="1080"
                cy="80"
                rx="440"
                ry="320"
                fill="hsl(var(--primary))"
                fillOpacity="0.18"
              />
            </g>
            {/* Soft warm glow — top left for balance */}
            <g filter="url(#filter1_f_hero)">
              <ellipse
                cx="160"
                cy="180"
                rx="360"
                ry="240"
                fill="hsl(var(--primary))"
                fillOpacity="0.10"
              />
            </g>
          </g>

          <rect
            x="0.5"
            y="0.5"
            width="1219"
            height="809"
            rx="15.5"
            stroke="hsl(var(--border))"
            strokeOpacity="0.6"
          />

          <defs>
            <filter id="filter0_f_hero" x="430" y="-380" width="1240" height="1000" filterUnits="userSpaceOnUse">
              <feFlood floodOpacity="0" result="BackgroundImageFix" />
              <feBlend mode="normal" in="SourceGraphic" in2="BackgroundImageFix" result="shape" />
              <feGaussianBlur stdDeviation="120" result="effect1_foregroundBlur" />
            </filter>
            <filter id="filter1_f_hero" x="-440" y="-260" width="1200" height="880" filterUnits="userSpaceOnUse">
              <feFlood floodOpacity="0" result="BackgroundImageFix" />
              <feBlend mode="normal" in="SourceGraphic" in2="BackgroundImageFix" result="shape" />
              <feGaussianBlur stdDeviation="100" result="effect1_foregroundBlur" />
            </filter>
            <linearGradient
              id="paint0_linear_hero"
              x1="35"
              y1="23"
              x2="903"
              y2="632"
              gradientUnits="userSpaceOnUse"
            >
              <stop stopColor="hsl(var(--foreground))" stopOpacity="0" />
              <stop offset="1" stopColor="hsl(var(--foreground))" stopOpacity="0.5" />
            </linearGradient>
            <clipPath id="clip0_hero">
              <rect width="1220" height="810" rx="16" fill="white" />
            </clipPath>
          </defs>
        </svg>
      </div>

      {/* Eyebrow — GitHub star badge */}
      <a
        href="https://github.com/corgi-feed/corgi"
        target="_blank"
        rel="noopener noreferrer"
        className="relative z-10 mb-6 md:mb-7 inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full border border-border bg-card/80 hover:bg-card transition-colors text-xs font-medium text-foreground/70 hover:text-foreground shadow-sm"
      >
        <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
          <path d="M8 .25a7.75 7.75 0 1 0 0 15.5A7.75 7.75 0 0 0 8 .25ZM1.75 8a6.25 6.25 0 1 1 12.5 0A6.25 6.25 0 0 1 1.75 8Zm6.56-3.44a.75.75 0 0 0-1.06 1.06L8.44 6.81l-1.19 1.19a.75.75 0 1 0 1.06 1.06l1.75-1.75a.75.75 0 0 0 0-1.06L8.31 4.56Z" />
        </svg>
        <span>Open source on GitHub</span>
        <span className="h-3.5 w-px bg-border mx-0.5" aria-hidden="true" />
        <svg width="12" height="12" viewBox="0 0 16 16" fill="hsl(var(--primary))" aria-hidden="true">
          <path d="M8 .25a.75.75 0 0 1 .673.418l1.882 3.815 4.21.612a.75.75 0 0 1 .416 1.279l-3.046 2.97.719 4.192a.75.75 0 0 1-1.088.791L8 12.347l-3.766 1.98a.75.75 0 0 1-1.088-.79l.72-4.194L.818 6.374a.75.75 0 0 1 .416-1.28l4.21-.611L7.327.668A.75.75 0 0 1 8 .25Z" />
        </svg>
        <span className="font-mono text-foreground/60">Star us</span>
      </a>

      {/* Hero copy */}
      <div className="relative z-10 space-y-4 md:space-y-5 mb-7 md:mb-8 max-w-md md:max-w-[560px] lg:max-w-[680px] px-4">
        <h1 className="text-foreground font-display text-3xl md:text-4xl lg:text-[62px] font-bold leading-tight lg:leading-[1.08] tracking-normal text-balance">
          Your community.{" "}
          <span className="text-primary">Your algorithm.</span>
        </h1>
        <p className="text-foreground/60 text-base md:text-base lg:text-lg font-medium leading-relaxed max-w-lg mx-auto">
          Corgi is a Bluesky feed with no hidden algorithm. Your community votes on how posts rank, and anyone can see exactly why a post showed up.
        </p>
      </div>

      {/* CTAs */}
      <div className="relative z-10 flex flex-col sm:flex-row items-center gap-3">
        <Link href="#">
          <Button className="bg-primary text-primary-foreground hover:bg-primary-dark px-7 py-3 rounded-full font-medium text-base shadow-[0_2px_8px_rgba(200,97,44,0.35),0_1px_2px_rgba(200,97,44,0.2)] hover:shadow-[0_4px_16px_rgba(200,97,44,0.4),0_1px_2px_rgba(200,97,44,0.2)] transition-all duration-200">
            Connect your Bluesky account
          </Button>
        </Link>
        <Link href="#features-section">
          <Button variant="ghost" className="text-foreground/70 hover:text-foreground px-5 py-3 rounded-full font-medium text-base">
            See how ranking works &rarr;
          </Button>
        </Link>
      </div>
      {/* Trust line */}
      <p className="relative z-10 mt-3 text-xs text-foreground/40 font-medium">
        Free &middot; App-password secure &middot; Leave anytime
      </p>
      <p className="relative z-10 mt-2 text-xs text-foreground/40 font-medium">
        Live snapshot, {LIVE_METRICS_SNAPSHOT.collectedAtLabel}: {LIVE_METRICS_SNAPSHOT.scoredPosts.toLocaleString()} scored posts &middot; {LIVE_METRICS_SNAPSHOT.uniqueAuthors.toLocaleString()} authors &middot; epoch {LIVE_METRICS_SNAPSHOT.epochId} active
      </p>
    </section>
  )
}
