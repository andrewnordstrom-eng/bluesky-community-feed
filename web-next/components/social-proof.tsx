"use client"

import Link from "next/link"

const pillars = [
  {
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M15 22v-4a4.8 4.8 0 0 0-1-3.5c3 0 6-2 6-5.5.08-1.25-.27-2.48-1-3.5.28-1.15.28-2.35 0-3.5 0 0-1 0-3 1.5-2.64-.5-5.36-.5-8 0C6 2 5 2 5 2c-.3 1.15-.3 2.35 0 3.5A5.403 5.403 0 0 0 4 9c0 3.5 3 5.5 6 5.5-.39.49-.68 1.05-.85 1.65S8.93 17.38 9 18v4" />
        <path d="M9 18c-4.51 2-5-2-7-2" />
      </svg>
    ),
    heading: "MIT licensed",
    body: "Read every line. Fork it. Self-host it. The code is yours.",
    href: "https://github.com/andrewnordstrom-eng/bluesky-community-feed",
    linkLabel: "View on GitHub",
  },
  {
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <rect x="2" y="3" width="20" height="14" rx="2" />
        <path d="M8 21h8M12 17v4" />
      </svg>
    ),
    heading: "Self-hostable",
    body: "Run Corgi on your own infrastructure. No dependency on our servers.",
    href: "https://docs.corgi.network",
    linkLabel: "Hosting docs",
  },
  {
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
        <circle cx="9" cy="7" r="4" />
        <path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
      </svg>
    ),
    heading: "Community-built",
    body: "PRs welcome. If something bothers you about the algorithm, you can fix it.",
    href: "https://github.com/andrewnordstrom-eng/bluesky-community-feed",
    linkLabel: "Contribute",
  },
]

export function SocialProof() {
  return (
    <section className="self-stretch border-t border-b border-border/60 py-10 md:py-12">
      <div className="flex flex-col md:flex-row justify-center items-stretch gap-0 w-full">
        {pillars.map((p, i) => (
          <div
            key={p.heading}
            className={`flex-1 flex flex-col gap-3 px-8 py-6 md:py-0 ${
              i < pillars.length - 1
                ? "border-b md:border-b-0 md:border-r border-border/60"
                : ""
            }`}
          >
            <div className="text-primary">{p.icon}</div>
            <div className="flex flex-col gap-1">
              <p className="text-foreground font-semibold text-sm leading-snug">{p.heading}</p>
              <p className="text-foreground/50 text-sm font-normal leading-relaxed">{p.body}</p>
            </div>
            <Link
              href={p.href}
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary text-xs font-medium hover:underline underline-offset-2 w-fit"
            >
              {p.linkLabel} &rarr;
            </Link>
          </div>
        ))}
      </div>
    </section>
  )
}
