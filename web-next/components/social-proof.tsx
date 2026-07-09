"use client"

import Link from "next/link"

const proofItems = [
  {
    value: "Community-ranked",
    label: "Members decide which signals should move posts up or down.",
  },
  {
    value: "Bluesky-native",
    label: "Corgi changes the order; Bluesky still renders normal posts.",
  },
  {
    value: "Receipt-backed",
    label: "Scores, weights, and explanations stay inspectable on Corgi.",
  },
  {
    value: "Open source",
    label: "The ranking and receipt implementation is public.",
  },
] as const

export function SocialProof() {
  return (
    <section className="self-stretch border-y border-border/60 py-5 md:py-6">
      <div className="grid gap-0 sm:grid-cols-2 lg:grid-cols-4">
        {proofItems.map((item, index) => {
          const isTopRowOnSmall = index < 2
          const isLeftColumnOnSmall = index % 2 === 0
          const hasRightDividerOnLarge = index < proofItems.length - 1

          return (
            <div
              key={item.value}
              className={`px-5 py-4 text-center ${
                index < proofItems.length - 1 ? "border-b border-border/50" : ""
              } ${isTopRowOnSmall ? "" : "sm:border-b-0"} ${
                isLeftColumnOnSmall ? "sm:border-r" : "sm:border-r-0"
              } ${hasRightDividerOnLarge ? "lg:border-r" : "lg:border-r-0"} lg:border-b-0`}
            >
              <p className="text-sm font-semibold text-foreground">{item.value}</p>
              <p className="mt-1 text-xs font-medium leading-relaxed text-foreground/45">{item.label}</p>
            </div>
          )
        })}
      </div>
      <p className="mt-3 text-center text-xs font-medium text-foreground/40">
        Receipts and snapshot details are available in the{" "}
        <Link href="/demo" className="text-primary hover:underline underline-offset-2">
          read-only demo
        </Link>
        .
      </p>
    </section>
  )
}
