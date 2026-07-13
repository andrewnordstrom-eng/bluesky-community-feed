"use client"

import { useId, useState } from "react"
import { ChevronDown } from "lucide-react"
import { AnimatePresence, motion } from "framer-motion"

const faqData = [
  {
    question: "What is Corgi and who is it for?",
    answer:
      "Corgi is a Bluesky feed where a community can decide how posts get ranked. The no-login demo lets you set shadow ranking weights, combine them with scripted community ballots, and inspect why the isolated order changed. It's for Bluesky communities that want more local context and less generic viral drift.",
  },
  {
    question: "What does inspectable ranking actually mean?",
    answer:
      "It means each ranked post has a score breakdown on Corgi. Bluesky shows the feed in Corgi-ranked order; Corgi's site shows which ranking factors pushed a post up or held it back, using the active community policy.",
  },
  {
    question: "Does Bluesky show the rank explanation inline?",
    answer:
      "Not in the standard Bluesky UI. Corgi sends Bluesky an ordered feed, so posts appear in that ranked order. The rank labels, scores, receipts, and why-ranked explanations live on Corgi's site.",
  },
  {
    question: "How does voting on the weights work?",
    answer:
      "When a voting round is active, members choose how much each ranking factor should matter: recency, engagement, bridging (posts that connect subgroups), source diversity, and topic relevance. When the round ends, the aggregate weights become the next feed policy and the feed reranks accordingly. The full history stays inspectable. During the pilot, voting accounts are approved from a waitlist — the demo and every transparency page stay open to everyone.",
  },
  {
    question: "Is Corgi secure? Does it need my Bluesky password?",
    answer:
      "Nope. Corgi only ever uses an app-password, which is a Bluesky feature that lets you give a third-party app limited access without sharing your real credentials. You can revoke it from your Bluesky settings at any time and Corgi immediately loses access.",
  },
  {
    question: "What is an epoch?",
    answer:
      "An epoch is one saved feed policy from a voting round. Your community sets how long rounds last. When a round closes, the new weights go live, and every epoch's weights are saved so you can always see how the ranking policy changed.",
  },
  {
    question: "Can researchers use Corgi's data?",
    answer:
      "Yes, with the right consent and access controls. Admins and researchers can export anonymized, consented data that includes score breakdowns, epoch weights, and aggregate vote records.",
  },
]

interface FAQItemProps {
  question: string
  answer: string
  isOpen: boolean
  onToggle: () => void
}

const FAQItem = ({ question, answer, isOpen, onToggle }: FAQItemProps) => {
  const answerId = useId()
  return (
    <div className="w-full bg-card shadow-[0_2px_6px_rgba(46,38,32,0.06)] overflow-hidden rounded-xl border border-border transition-colors duration-200 hover:border-primary/30">
      <button
        type="button"
        aria-expanded={isOpen}
        aria-controls={answerId}
        onClick={onToggle}
        className="w-full px-6 py-5 pr-5 flex justify-between items-center gap-5 text-left rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary"
      >
        <span className="flex-1 text-foreground text-[0.9375rem] font-semibold leading-6 break-words">{question}</span>
        <ChevronDown
          aria-hidden="true"
          className={`w-5 h-5 flex-shrink-0 text-foreground/50 transition-transform duration-300 ease-out ${isOpen ? "rotate-180" : "rotate-0"}`}
        />
      </button>
      <AnimatePresence initial={false}>
        {isOpen && (
          <motion.div
            id={answerId}
            key="content"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25, ease: [0.4, 0, 0.2, 1] }}
            className="overflow-hidden"
          >
            <div className="px-6 pb-6 pt-1">
              <div className="text-foreground/65 text-sm font-normal leading-[1.7] break-words">{answer}</div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

export function FAQSection() {
  const [openItems, setOpenItems] = useState<Set<number>>(new Set([0]))
  const toggleItem = (index: number) => {
    const newOpenItems = new Set(openItems)
    if (newOpenItems.has(index)) {
      newOpenItems.delete(index)
    } else {
      newOpenItems.add(index)
    }
    setOpenItems(newOpenItems)
  }
  return (
    <section id="faq-section" className="w-full scroll-mt-24 py-14 md:scroll-mt-28 md:py-20 px-5 relative flex flex-col justify-center items-center">
      <div className="w-[300px] h-[400px] absolute top-[100px] left-1/2 -translate-x-1/2 origin-top-left rotate-[-33deg] bg-primary/[0.08] blur-[100px] z-0 pointer-events-none" />
      <div className="self-stretch pb-8 md:pb-12 flex flex-col justify-center items-center gap-4 relative z-10">
        <div className="flex flex-col justify-start items-center gap-3">
          <h2 className="w-full max-w-[480px] text-center text-foreground font-display text-4xl font-bold leading-tight tracking-tight text-balance">
            Frequently asked questions
          </h2>
          <p className="text-center text-foreground/50 text-sm font-normal leading-relaxed max-w-sm">
            Everything you need to know about how Corgi ranks the feed and shows its work.
          </p>
        </div>
      </div>
      <div className="w-full max-w-[620px] flex flex-col gap-3 relative z-10">
        {faqData.map((faq, index) => (
          <FAQItem key={index} {...faq} isOpen={openItems.has(index)} onToggle={() => toggleItem(index)} />
        ))}
      </div>
    </section>
  )
}
