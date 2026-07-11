// Single source of truth for all reviewer-facing demo copy.
//
// Centralized so the copy test (`__tests__/demo-copy.test.ts`) can assert the
// disclosures are present and that nothing overclaims — i.e. no copy implies the
// demo changes the production feed / governance, and none implies Bluesky
// natively renders Corgi's rank badges or receipt panels.

export const HERO = {
  eyebrow: "Interactive demo",
  title: "Watch a community re-rank its own feed.",
  subtitle:
    "Propose a policy for Open Science Builders, combine it with 24 scripted deterministic voter archetypes, and inspect how the same live public posts move.",
} as const

export interface FlowStepCopy {
  readonly key: "session" | "vote" | "agents" | "epoch" | "reorder" | "receipt"
  readonly label: string
  readonly hint: string
}

export const FLOW_STEPS: readonly FlowStepCopy[] = [
  { key: "session", label: "Session", hint: "Freeze a comparison corpus" },
  { key: "vote", label: "Your vote", hint: "Pick a policy" },
  { key: "agents", label: "Community", hint: "24 voters weigh in" },
  { key: "epoch", label: "Advance epoch", hint: "Apply the policy" },
  { key: "reorder", label: "Reordered", hint: "Same posts, new order" },
  { key: "receipt", label: "Receipt", hint: "Why it ranked" },
]

export const STEP_PANELS = {
  community: {
    heading: "Meet the community",
    body: "Open Science Builders spans research, data science, software development, and open source. Start a session to freeze a comparison corpus of live public posts and test a policy against it.",
    cta: "Start a demo session",
  },
  vote: {
    heading: "Cast your demo vote",
    body: "Pick a policy for how this community should rank posts. You can fine-tune the five signals, or start from a preset.",
    cta: "Cast demo vote",
  },
  agents: {
    heading: "Let the community weigh in",
    body: "Twenty-four scripted deterministic voter archetypes represent five stakeholder blocs. Their preferences carry history, respond within bounds to your proposal, and replay exactly from the same inputs.",
    readyHeading: "Twenty-four community voters are ready",
    readyBody: "Five scripted blocs balance stable preferences, prior-policy inertia, and a bounded response to your proposal. The run is deterministic and replayable.",
    cta: "Simulate 24 voters",
  },
  epoch: {
    heading: "Advance the epoch",
    body: "Close voting and apply the community-aggregated policy to the frozen corpus.",
    cta: "Advance epoch",
  },
  reorder: {
    heading: "Same posts, new order",
    body: "The corpus never changed — only the policy did. Watch positions move, then open any post's receipt.",
    cta: "Inspect a receipt",
  },
  receipt: {
    heading: "Why it ranked here",
    body: "Every position has a receipt: raw signal scores times the community's weights, plus counterfactuals.",
    cta: "Pick another post",
  },
} as const

export const DISCLOSURE = {
  // Must clearly state isolation from production governance.
  production:
    "Demo votes and epochs run in an isolated shadow governance namespace. They never enter production governance, audit logs, research exports, or the public Corgi feed.",
  posts:
    "The primary path uses live public Bluesky posts with Corgi score decompositions, held as a frozen comparison corpus so policy changes remain attributable. A labeled fixture appears only if live corpus loading degrades.",
  // Keeps the Bluesky-vs-Corgi boundary honest without claiming native rendering.
  annotations:
    "Rank badges, scores, and receipts are Corgi annotations shown on Corgi's site, not native Bluesky UI. Bluesky renders the ordered posts; Corgi shows why.",
} as const

export const LABELS = {
  previewBadge: "Coming soon",
  corpusFrozen: "Live public posts · frozen comparison corpus",
  corpusFallback: "Illustrative fallback · frozen comparison corpus",
  reset: "Start over",
  reviewerVoter: "You (reviewer)",
  withheldRow: "Withheld from the public view",
  openOnBluesky: "Open on Bluesky",
} as const

/** Every reviewer-facing string, flattened — used by the copy test. */
export function allDemoCopyStrings(): readonly string[] {
  const out: string[] = [HERO.eyebrow, HERO.title, HERO.subtitle]
  for (const step of FLOW_STEPS) {
    out.push(step.label, step.hint)
  }
  for (const panel of Object.values(STEP_PANELS)) {
    out.push(...Object.values(panel))
  }
  out.push(DISCLOSURE.production, DISCLOSURE.posts, DISCLOSURE.annotations)
  out.push(...Object.values(LABELS))
  return out
}
