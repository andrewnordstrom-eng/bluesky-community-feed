import { cn } from "@/lib/utils"
import type { ElementType, HTMLAttributes, ReactNode } from "react"

/**
 * Layout primitives — the single source of truth for Corgi's content grid.
 * See web-next/docs/design-system.md § Layout.
 *
 * Content column: 1320px, centered. Gutter: 20 / 32 / 48px.
 * Route EVERY page/marketing section through <Section> or <Container> so
 * horizontal edges and widths cannot drift (this is what prevents the
 * "each page slightly off" problem). Do not hardcode `max-w-[1320px]` or a
 * bespoke `px-*` gutter on section-level elements.
 */

/** Horizontal gutter — identical on every content surface. */
export const GUTTER = "px-5 md:px-8 lg:px-12"

/** Named content widths. `content` is the default column; the rest are the only sanctioned exceptions. */
export const CONTAINER_WIDTH = {
  content: "max-w-[1320px]", // marketing / product content column (default)
  stage: "max-w-[1120px]", // narrower "product stage" (e.g. the interactive demo)
  doc: "max-w-3xl", // long-form reading measure (docs / legal article body)
  narrow: "max-w-xl", // focused single-column (sign-in, error, 404)
} as const

export type ContainerWidth = keyof typeof CONTAINER_WIDTH

type ContainerProps = Omit<HTMLAttributes<HTMLElement>, "children"> & {
  readonly as?: ElementType
  readonly width?: ContainerWidth
  readonly children: ReactNode
}

/** Centered horizontal frame: width cap + standard gutter. Add display/grid via className. */
export function Container({ as: Tag = "div", width = "content", className, children, ...props }: ContainerProps) {
  return (
    <Tag className={cn("mx-auto w-full", GUTTER, CONTAINER_WIDTH[width], className)} {...props}>
      {children}
    </Tag>
  )
}

/** Vertical rhythm for stacked sections. */
export const SECTION_SPACING = {
  default: "py-10 md:py-14",
  loose: "py-14 md:py-20",
  tight: "py-5 md:py-6",
  none: "",
} as const

export type SectionSpacing = keyof typeof SECTION_SPACING

type SectionProps = Omit<HTMLAttributes<HTMLElement>, "children"> & {
  readonly spacing?: SectionSpacing
  /** `true` → top border; `"y"` → top+bottom border. */
  readonly bordered?: boolean | "y"
  readonly width?: ContainerWidth
  readonly innerClassName?: string
  readonly children: ReactNode
}

/**
 * A page section: semantic <section> wrapping a <Container>. The border and
 * vertical rhythm live on the Container so the divider is **inset to the content
 * frame** (not full-bleed), matching the rest of the site. Put full-bleed
 * backgrounds/glows on `className` (the <section>); keep content on the Container.
 */
export function Section({
  spacing = "default",
  bordered = false,
  width = "content",
  className,
  innerClassName,
  children,
  ...props
}: SectionProps) {
  return (
    <section className={className} {...props}>
      <Container
        width={width}
        className={cn(
          bordered === "y" ? "border-y border-border/60" : bordered ? "border-t border-border/60" : "",
          SECTION_SPACING[spacing],
          innerClassName,
        )}
      >
        {children}
      </Container>
    </section>
  )
}
