"use client"

import { useState, useRef, KeyboardEvent } from "react"

const MAX_KEYWORDS = 20
const MAX_KEYWORD_LENGTH = 50

interface KeywordInputProps {
  label: string
  keywords: string[]
  /** "include" = sage chips, "exclude" = tongue chips */
  variant: "include" | "exclude"
  onChange: (next: string[]) => void
  disabled?: boolean
  communityVotes?: Record<string, number>   // optional: show vote count on chips
  totalVoters?: number
  /** Caps the keyword list; defaults to 20 for the production vote page. */
  maxKeywords?: number
}

export function KeywordInput({
  label,
  keywords,
  variant,
  onChange,
  disabled = false,
  communityVotes,
  totalVoters,
  maxKeywords = MAX_KEYWORDS,
}: KeywordInputProps) {
  const [inputValue, setInputValue] = useState("")
  const inputRef = useRef<HTMLInputElement>(null)
  const atMax = keywords.length >= maxKeywords

  const add = (raw: string) => {
    const word = raw.trim().toLowerCase().replace(/\s+/g, "-").slice(0, MAX_KEYWORD_LENGTH)
    if (!word || keywords.includes(word) || atMax) return
    onChange([...keywords, word])
    setInputValue("")
  }

  const remove = (word: string) => {
    onChange(keywords.filter((k) => k !== word))
  }

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault()
      add(inputValue)
    }
    if (e.key === "Backspace" && inputValue === "" && keywords.length > 0) {
      remove(keywords[keywords.length - 1])
    }
  }

  const isInclude = variant === "include"

  const chipClass = isInclude
    ? "bg-success/10 border-success/25 text-success"
    : "bg-tongue/15 border-tongue/30 text-tongue-foreground"

  const removeClass = isInclude
    ? "hover:bg-success/20 text-success/70 hover:text-success"
    : "hover:bg-tongue/25 text-tongue-foreground/60 hover:text-tongue-foreground"

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <label className="text-sm font-semibold text-foreground">{label}</label>
        <span
          className={`text-xs font-mono tabular-nums transition-colors
            ${atMax ? "text-tongue-foreground font-semibold" : "text-foreground/50"}`}
        >
          {keywords.length}/{maxKeywords}
        </span>
      </div>

      {/* Chip + input container */}
      <div
        className={`flex flex-wrap gap-1.5 min-h-[42px] p-2 rounded-lg border bg-card transition-colors cursor-text
          ${disabled ? "opacity-50 pointer-events-none border-border" : "border-border hover:border-primary/40 focus-within:border-primary focus-within:ring-1 focus-within:ring-primary/30"}`}
        onClick={() => inputRef.current?.focus()}
      >
        {keywords.map((word) => {
          const votes = communityVotes?.[word]
          const votePct = votes && totalVoters ? Math.round((votes / totalVoters) * 100) : null
          return (
            <span
              key={word}
              className={`inline-flex items-center gap-1 text-xs font-mono px-2 py-0.5 rounded-full border ${chipClass}`}
            >
              {isInclude ? "+" : "−"}{word}
              {votePct !== null && (
                <span className="opacity-60 text-[10px]">·{votePct}%</span>
              )}
              <button
                type="button"
                onClick={() => remove(word)}
                aria-label={`Remove ${word}`}
                className={`ml-0.5 w-3.5 h-3.5 flex items-center justify-center rounded-full transition-colors ${removeClass}`}
              >
                <svg width="8" height="8" viewBox="0 0 8 8" fill="none" aria-hidden="true">
                  <path d="M1 1l6 6M7 1L1 7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
              </button>
            </span>
          )
        })}

        {!atMax && (
          <input
            ref={inputRef}
            type="text"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={disabled}
            placeholder={keywords.length === 0 ? "Type and press Enter…" : ""}
            aria-label={`Add ${label.toLowerCase()} keyword`}
            className="flex-1 min-w-[120px] bg-transparent text-xs font-mono text-foreground placeholder:text-foreground/55 outline-none border-none"
          />
        )}

        {atMax && (
          <span className="text-xs text-tongue-foreground font-mono self-center ml-1">Max reached</span>
        )}
      </div>
    </div>
  )
}
