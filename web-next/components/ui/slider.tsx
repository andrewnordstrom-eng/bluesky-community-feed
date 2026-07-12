'use client'

import * as React from 'react'
import * as SliderPrimitive from '@radix-ui/react-slider'

import { cn } from '@/lib/utils'

type SliderProps = React.ComponentPropsWithoutRef<typeof SliderPrimitive.Root> & {
  readonly accentColor?: string
  readonly ariaLabel: string
  readonly ariaValueText?: string
}

const Slider = React.forwardRef<
  React.ElementRef<typeof SliderPrimitive.Root>,
  SliderProps
>(({ className, accentColor, ariaLabel, ariaValueText, style, ...props }, ref) => (
  <SliderPrimitive.Root
    ref={ref}
    className={cn(
      'relative flex h-10 w-full touch-none select-none items-center',
      className,
    )}
    style={{
      ...style,
      '--slider-accent': accentColor ?? 'hsl(var(--primary))',
    } as React.CSSProperties}
    {...props}
  >
    <SliderPrimitive.Track className="relative h-2 w-full grow overflow-hidden rounded-full bg-secondary/75">
      <SliderPrimitive.Range className="absolute h-full bg-[var(--slider-accent)]" />
    </SliderPrimitive.Track>
    <SliderPrimitive.Thumb
      aria-label={ariaLabel}
      aria-valuetext={ariaValueText}
      className="block h-5 w-5 rounded-full border-2 border-background bg-[var(--slider-accent)] shadow-sm ring-1 ring-[var(--slider-accent)] ring-offset-background transition-transform hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--slider-accent)] focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50"
    />
  </SliderPrimitive.Root>
))
Slider.displayName = SliderPrimitive.Root.displayName

export { Slider }
