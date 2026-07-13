import Link from "next/link"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

interface LandingCTAProps {
  className?: string
}

export function DemoCTA({ className }: LandingCTAProps) {
  return (
    <Button
      asChild
      className={cn(
        "bg-primary text-primary-foreground hover:bg-primary-dark px-7 py-3 rounded-full font-medium text-base shadow-[0_2px_8px_rgba(200,97,44,0.35),0_1px_2px_rgba(200,97,44,0.2)] hover:shadow-[0_4px_16px_rgba(200,97,44,0.4)] transition-all duration-200",
        className,
      )}
    >
      <Link href="/demo">
        Try the governance demo
      </Link>
    </Button>
  )
}

export function WaitlistCTA({ className }: LandingCTAProps) {
  return (
    <Button
      asChild
      variant="ghost"
      className={cn(
        "text-foreground/60 hover:text-foreground px-5 py-3 rounded-full font-medium text-base",
        className,
      )}
    >
      <Link href="/sign-in">
        Join the waitlist
      </Link>
    </Button>
  )
}
