import React from "react"
import Link from "next/link"
import { ChevronDown, Play } from "lucide-react"
import { Button } from "@/components/ui/button"
import { DemoCTA } from "@/components/landing-ctas"

export function HeroSection() {
  return (
    <section
      className="flex min-h-[88svh] flex-col items-center justify-center text-center relative mx-auto overflow-hidden pt-16 pb-24 md:pt-20 md:pb-28 px-4 md:px-6
         w-full"
    >
      {/* SVG Background — warm cream grid */}
      <div className="absolute inset-0 z-0">
        <svg
          width="100%"
          height="100%"
          viewBox="0 0 1440 810"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          preserveAspectRatio="xMidYMid slice"
        >
          <rect width="1440" height="810" fill="hsl(var(--background))" />
          <g clipPath="url(#clip0_hero)">
            <mask
              id="mask0_hero"
              style={{ maskType: "alpha" }}
              maskUnits="userSpaceOnUse"
              x="0"
              y="-1"
              width="1440"
              height="812"
            >
              <rect x="0" y="-0.84668" width="1440" height="811.693" fill="url(#paint0_linear_hero)" />
            </mask>
            <g mask="url(#mask0_hero)">
              {[...Array(42)].map((_, i) => (
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
            width="1439"
            height="809"
            stroke="hsl(var(--border))"
            strokeOpacity="0.3"
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
              x2="1390"
              y2="632"
              gradientUnits="userSpaceOnUse"
            >
              <stop stopColor="hsl(var(--foreground))" stopOpacity="0" />
              <stop offset="1" stopColor="hsl(var(--foreground))" stopOpacity="0.5" />
            </linearGradient>
            <clipPath id="clip0_hero">
              <rect width="1440" height="810" fill="white" />
            </clipPath>
          </defs>
        </svg>
      </div>

      <div className="relative z-10 mb-6 md:mb-7 inline-flex items-center gap-2 rounded-full border border-border bg-card/80 px-3.5 py-1.5 text-xs font-medium text-foreground/70 shadow-sm">
        <span className="h-2 w-2 rounded-full bg-primary" aria-hidden="true" />
        <span>Community-ranked Bluesky feed</span>
      </div>

      {/* Hero copy */}
      <div className="relative z-10 space-y-4 md:space-y-5 mb-7 md:mb-8 max-w-md md:max-w-[620px] lg:max-w-[780px] px-4">
        <h1 className="text-foreground font-display text-3xl md:text-4xl lg:text-[62px] font-bold leading-tight lg:leading-[1.08] tracking-normal text-balance">
          Make Bluesky care about what{" "}
          <span className="text-primary">your community cares about.</span>
        </h1>
        <p className="text-foreground/60 text-base md:text-base lg:text-lg font-medium leading-relaxed max-w-lg mx-auto">
          Corgi lets a community tune what rises first, then shows the weights, scores, and receipts behind the order.
        </p>
      </div>

      {/* CTAs */}
      <div className="relative z-10 flex flex-col sm:flex-row items-center gap-3">
        <DemoCTA />
        <Button asChild variant="ghost" className="text-foreground/70 hover:text-foreground px-5 py-3 rounded-full font-medium text-base">
          <Link href="/how-it-works/#video-overview">
            <Play aria-hidden="true" />
            Watch 4-minute overview
          </Link>
        </Button>
      </div>
      {/* Trust line */}
      <p className="relative z-10 mt-3 text-xs text-foreground/50 font-medium">
        No login required &middot; shadow votes never change the public feed &middot; governance is in a limited pilot
      </p>

      {/* Scroll cue — invites the visitor down into the interactive demo. */}
      <div className="pointer-events-none absolute bottom-6 left-1/2 z-10 flex -translate-x-1/2 flex-col items-center gap-1.5 text-foreground/55">
        <span className="text-[10px] font-mono uppercase tracking-[0.22em]">See it in action</span>
        <ChevronDown className="h-4 w-4 motion-safe:animate-bounce" aria-hidden="true" />
      </div>
    </section>
  )
}
