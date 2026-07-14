// Single source of truth for all reviewer-facing demo copy.
//
// Centralized so the copy test (`__tests__/demo-copy.test.ts`) can assert the
// disclosures are present and that nothing overclaims — i.e. no copy implies the
// demo changes the production feed / governance, and none implies Bluesky
// natively renders Corgi's rank badges or receipt panels.

export const HERO = {
  eyebrow: "Interactive demo",
  title: "Re-rank a frozen Corgi Commons snapshot.",
  subtitle:
    "Start with a reviewer-safe snapshot of the public feed, propose a policy, combine it with 24 scripted deterministic voter archetypes, and inspect how the same posts move.",
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
  { key: "epoch", label: "Advance epoch", hint: "Publish the shadow policy" },
  { key: "reorder", label: "Reordered", hint: "Same posts, new order" },
  { key: "receipt", label: "Receipt", hint: "Why it ranked" },
]

export const STEP_PANELS = {
  community: {
    heading: "Start from Corgi Commons",
    body: "Corgi Commons serves open-network building, research, software, data, and the conversations connecting them. This demo freezes a reviewer-safe comparison corpus from the public feed so your shadow session can change the ranking policy without changing what anyone sees on Bluesky.",
    cta: "Start a demo session",
  },
  vote: {
    heading: "Cast your demo vote",
    body: "Start from the production policy, choose a preset, or fine-tune all five signals and the full topic catalog.",
    cta: "Cast demo vote",
  },
  agents: {
    heading: "Let the community weigh in",
    body: "Twenty-four scripted deterministic voter archetypes represent five preference blocs. Their preferences carry history, respond within bounds to your proposal, and replay exactly from the same inputs. They demonstrate governance mechanics; they are not validated models of human behavior.",
    readyHeading: "Twenty-four community voters are ready",
    readyBody: "Five scripted blocs balance stable preferences, prior-policy inertia, and a bounded response to your proposal. The run is deterministic and replayable.",
    cta: "Simulate 24 voters",
  },
  epoch: {
    heading: "Advance the shadow epoch",
    body: "Close this demo round and publish the aggregated policy inside the isolated shadow session. Production rounds require results review and operator approval before application.",
    cta: "Advance epoch",
  },
  reorder: {
    heading: "Same posts, new order",
    body: "The corpus never changed — only the policy did. Watch positions move, then open any post's receipt.",
    cta: "Inspect a receipt",
  },
  receipt: {
    heading: "Why it ranked here",
    body: "Inspect the selected post's raw signal scores, community weights, publication adjustment, provenance, and counterfactuals.",
    cta: "Pick another post",
  },
} as const

export const DISCLOSURE = {
  // Must clearly state isolation from production governance.
  production:
    "Demo votes and epochs run in an isolated shadow governance namespace. They never enter production governance, audit logs, research exports, or the public Corgi feed.",
  posts:
    "The primary path uses an objectively filtered snapshot of live public posts published in Corgi Commons. The comparison corpus is frozen for the session so policy changes remain attributable. A labeled mechanics fixture appears only if snapshot loading degrades.",
  // Keeps the Bluesky-vs-Corgi boundary honest without claiming native rendering.
  annotations:
    "Rank badges, scores, and receipts are Corgi annotations shown on Corgi's site, not native Bluesky UI. Bluesky renders the ordered posts; Corgi shows why.",
} as const

export const LABELS = {
  previewBadge: "Coming soon",
  corpusFrozen: "Corgi Commons snapshot · frozen comparison corpus",
  corpusFallback: "Mechanics fixture · frozen comparison corpus",
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
