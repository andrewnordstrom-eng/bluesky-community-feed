"use client"

import { useState } from "react"
import { Check } from "lucide-react"
import { Button } from "@/components/ui/button"

export function PricingSection() {
  const [isAnnual, setIsAnnual] = useState(true)

  const pricingPlans = [
    {
      name: "Member",
      monthlyPrice: "$0",
      annualPrice: "$0",
      description: "For anyone who wants a transparent feed.",
      features: [
        "Vote on ranking weights each epoch",
        "Full score breakdown on every post",
        "View epoch history",
        "App-password secure access",
        "Leave anytime, no lock-in",
      ],
      buttonText: "Connect Bluesky account",
      buttonVariant: "outline" as const,
    },
    {
      name: "Contributor",
      monthlyPrice: "$8",
      annualPrice: "$6",
      description: "For power users who want more influence.",
      features: [
        "Everything in Member",
        "Propose new ranking rules",
        "Weighted votes in governance",
        "Research-grade data exports",
        "Priority feed updates",
        "Early access to new signals",
      ],
      buttonText: "Become a Contributor",
      popular: true,
    },
    {
      name: "Community",
      monthlyPrice: "$40",
      annualPrice: "$32",
      description: "For groups and organisations running their own feed.",
      features: [
        "Everything in Contributor",
        "Private community feed",
        "Custom epoch schedule",
        "Dedicated governance dashboard",
        "Consent-aware bulk exports",
        "Email support",
      ],
      buttonText: "Talk to us",
    },
  ]

  return (
    <section id="pricing-section" className="w-full px-5 overflow-hidden flex flex-col justify-start items-center my-0 py-8 md:py-14">
      <div className="self-stretch relative flex flex-col justify-center items-center gap-2 py-0">
        <div className="flex flex-col justify-start items-center gap-4">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-primary/10 border border-primary/20">
            <span className="text-primary text-xs font-semibold tracking-wide uppercase">Pricing</span>
          </div>
          <h2 className="text-center text-foreground font-display text-4xl md:text-5xl font-semibold leading-tight tracking-tight text-balance">
            Pricing built for every community
          </h2>
          <p className="text-center text-foreground/50 text-sm font-medium leading-relaxed max-w-md">
            Start free, vote on your first epoch, see the math. Upgrade when you need more influence or a private feed.
          </p>
        </div>
        <div className="pt-4">
          <div className="p-0.5 bg-muted rounded-lg border border-border flex justify-start items-center gap-1">
            <button
              onClick={() => setIsAnnual(true)}
              className={`px-3 py-1.5 flex justify-start items-start gap-2 rounded-md transition-colors ${isAnnual ? "bg-card shadow-sm" : ""}`}
            >
              <span className={`text-center text-sm font-medium leading-tight ${isAnnual ? "text-foreground" : "text-foreground/40"}`}>
                Annually
              </span>
              {isAnnual && (
                <span className="text-xs text-primary font-medium ml-1">20% off</span>
              )}
            </button>
            <button
              onClick={() => setIsAnnual(false)}
              className={`px-3 py-1.5 flex justify-start items-start rounded-md transition-colors ${!isAnnual ? "bg-card shadow-sm" : ""}`}
            >
              <span className={`text-center text-sm font-medium leading-tight ${!isAnnual ? "text-foreground" : "text-foreground/40"}`}>
                Monthly
              </span>
            </button>
          </div>
        </div>
      </div>

      <div className="self-stretch flex flex-col md:flex-row justify-start items-stretch gap-4 md:gap-5 mt-8 max-w-[1000px] mx-auto">
        {pricingPlans.map((plan) => (
          <div
            key={plan.name}
            className={`flex-1 p-5 overflow-hidden rounded-2xl flex flex-col justify-start items-start gap-6 border transition-shadow ${
              plan.popular
                ? "bg-primary border-primary/30 shadow-[0_4px_24px_rgba(200,97,44,0.20)]"
                : "bg-card border-border shadow-[0_2px_12px_rgba(46,38,32,0.06)]"
            }`}
          >
            <div className="self-stretch flex flex-col gap-5">
              <div className="flex flex-col gap-1">
                <div className="flex items-center gap-2">
                  <span className={`text-sm font-semibold ${plan.popular ? "text-primary-foreground" : "text-foreground/60"}`}>
                    {plan.name}
                  </span>
                  {plan.popular && (
                    <span className="px-2 py-0.5 rounded-full bg-primary-foreground/20 text-primary-foreground text-xs font-medium">
                      Popular
                    </span>
                  )}
                </div>
                <div className="flex items-baseline gap-1">
                  <span className={`text-3xl font-semibold font-display ${plan.popular ? "text-primary-foreground" : "text-foreground"}`}>
                    {isAnnual ? plan.annualPrice : plan.monthlyPrice}
                  </span>
                  <span className={`text-sm ${plan.popular ? "text-primary-foreground/60" : "text-foreground/40"}`}>/month</span>
                </div>
                <p className={`text-sm leading-relaxed ${plan.popular ? "text-primary-foreground/70" : "text-foreground/50"}`}>
                  {plan.description}
                </p>
              </div>

              <Button
                className={`w-full rounded-full font-medium text-sm py-2 transition-colors ${
                  plan.popular
                    ? "bg-primary-foreground text-primary hover:bg-primary-foreground/90"
                    : plan.buttonVariant === "outline"
                    ? "bg-transparent border border-border text-foreground hover:bg-muted"
                    : "bg-secondary text-secondary-foreground hover:bg-secondary/90"
                }`}
              >
                {plan.buttonText}
              </Button>
            </div>

            <div className="self-stretch flex flex-col gap-3">
              <p className={`text-xs font-medium ${plan.popular ? "text-primary-foreground/60" : "text-foreground/40"}`}>
                {plan.name === "Member" ? "Get started today:" : "Everything in " + pricingPlans[pricingPlans.indexOf(plan) - 1]?.name + " +"}
              </p>
              <div className="flex flex-col gap-2.5">
                {plan.features.map((feature) => (
                  <div key={feature} className="flex justify-start items-center gap-2">
                    <Check
                      className={`w-4 h-4 flex-shrink-0 ${plan.popular ? "text-primary-foreground" : "text-primary"}`}
                      strokeWidth={2.5}
                    />
                    <span className={`text-sm leading-tight ${plan.popular ? "text-primary-foreground" : "text-foreground/70"}`}>
                      {feature}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}
