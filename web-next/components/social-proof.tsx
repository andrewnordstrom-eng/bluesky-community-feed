import Link from "next/link"
import { Container } from "@/components/ui/layout"

// Real proof, not value-prop bullets: the feed is live, the ranking is interpretable
// and community-governed, and the code is open. Deliberately no volume metrics — a raw
// post count invites a firehose-scale comparison this curated community feed shouldn't be read against.
const FEED_URL = "https://bsky.app/profile/corgi-network.bsky.social/feed/community-gov"
const GITHUB_URL = "https://github.com/andrewnordstrom-eng/bluesky-community-feed"

const FOCUS =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary"

interface ProofItem {
  readonly value: string
  readonly label: string
  readonly href?: string
  readonly live?: boolean
}

export function SocialProof() {
  const proofItems: readonly ProofItem[] = [
    {
      value: "Live on Bluesky",
      label: "corgi-network.bsky.social",
      href: FEED_URL,
      live: true,
    },
    {
      value: "5 scored signals",
      label: "recency, engagement, bridging, diversity, relevance",
    },
    {
      value: "Community-governed",
      label: "member votes set the weights",
    },
    {
      value: "Open source",
      label: "read the ranking code",
      href: GITHUB_URL,
    },
  ]

  return (
    <section>
      <Container className="border-y border-border/60 py-5 md:py-6">
      <div className="grid gap-0 sm:grid-cols-2 lg:grid-cols-4">
        {proofItems.map((item, index) => {
          const isTopRowOnSmall = index < 2
          const isLeftColumnOnSmall = index % 2 === 0
          const hasRightDividerOnLarge = index < proofItems.length - 1

          const borderClasses = `${index < proofItems.length - 1 ? "border-b border-border/50" : ""} ${
            isTopRowOnSmall ? "" : "sm:border-b-0"
          } ${isLeftColumnOnSmall ? "sm:border-r border-border/50" : "sm:border-r-0"} ${
            hasRightDividerOnLarge ? "lg:border-r border-border/50" : "lg:border-r-0"
          } lg:border-b-0`

          const body = (
            <>
              <p className="flex items-center justify-center gap-1.5 font-mono text-sm font-semibold tabular-nums text-foreground">
                {item.live ? (
                  <span className="h-2 w-2 flex-shrink-0 rounded-full bg-success" aria-hidden="true" />
                ) : null}
                {item.value}
              </p>
              <p className="mt-1 text-xs font-medium leading-relaxed text-foreground/50">{item.label}</p>
            </>
          )

          if (item.href) {
            return (
              <a
                key={item.value}
                href={item.href}
                target="_blank"
                rel="noopener noreferrer"
                className={`px-5 py-4 text-center transition-colors hover:bg-biscuit/40 ${FOCUS} ${borderClasses}`}
              >
                {body}
              </a>
            )
          }

          return (
            <div key={item.value} className={`px-5 py-4 text-center ${borderClasses}`}>
              {body}
            </div>
          )
        })}
      </div>
      <p className="mt-3 text-center text-xs font-medium text-foreground/50">
        Every ranked post shows its receipt &mdash;{" "}
        <Link href="/demo" className="text-primary hover:underline underline-offset-2">
          inspect them in the read-only demo
        </Link>
        .
      </p>
      </Container>
    </section>
  )
}
