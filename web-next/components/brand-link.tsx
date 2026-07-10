import Image from "next/image"
import Link from "next/link"

interface BrandLinkProps {
  readonly href: string
  readonly ariaLabel: string
}

export function BrandLink({ href, ariaLabel }: BrandLinkProps) {
  return (
    <Link href={href} aria-label={ariaLabel} className="flex items-center gap-1.5 shrink-0">
      <Image
        src="/images/corgi-icon.svg"
        alt=""
        width={34}
        height={24}
        className="w-[34px] h-6 brightness-0"
        aria-hidden="true"
      />
      <span className="font-display font-bold text-2xl text-foreground tracking-tight">Corgi</span>
    </Link>
  )
}
