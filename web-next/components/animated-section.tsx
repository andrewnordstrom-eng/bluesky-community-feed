"use client"

import { motion } from "framer-motion"
import type { HTMLMotionProps } from "framer-motion"
import type { ReactNode } from "react"

interface AnimatedSectionProps extends Omit<HTMLMotionProps<"div">, "children" | "initial" | "whileInView" | "viewport" | "transition"> {
  children: ReactNode
  delay?: number
}

export function AnimatedSection({ children, className, delay, ...props }: AnimatedSectionProps) {
  const transitionDelay = delay ?? 0

  return (
    <motion.div
      initial={{ opacity: 0, y: 20, scale: 0.98 }}
      whileInView={{ opacity: 1, y: 0, scale: 1 }}
      viewport={{ once: true }}
      transition={{ duration: 0.8, ease: [0.33, 1, 0.68, 1], delay: transitionDelay }}
      className={className}
      {...props}
    >
      {children}
    </motion.div>
  )
}
