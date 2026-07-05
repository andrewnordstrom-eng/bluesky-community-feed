"use client"

import { motion } from "framer-motion"
import type { HTMLMotionProps, Transition } from "framer-motion"
import type { ReactNode } from "react"

interface AnimatedSectionProps extends HTMLMotionProps<"div"> {
  children: ReactNode
  delay?: number
}

export function AnimatedSection({ children, className, delay, transition, ...props }: AnimatedSectionProps) {
  const incomingTransition: Transition = typeof transition === "object" && transition !== null ? transition : {}
  const transitionDelay = delay ?? incomingTransition.delay ?? 0

  return (
    <motion.div
      initial={{ opacity: 0, y: 20, scale: 0.98 }}
      whileInView={{ opacity: 1, y: 0, scale: 1 }}
      viewport={{ once: true }}
      transition={{ duration: 0.8, ease: [0.33, 1, 0.68, 1], ...incomingTransition, delay: transitionDelay }}
      className={className}
      {...props}
    >
      {children}
    </motion.div>
  )
}
