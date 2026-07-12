import type { ShadowDemoTopicCatalogEntry, ShadowDemoTopicIntent } from "@/app/demo/shadow-demo-view-model"

export function topicLabel(slug: string, catalog: readonly ShadowDemoTopicCatalogEntry[]): string {
  return catalog.find((topic) => topic.slug === slug)?.name
    ?? topicTitle(slug)
}

export function topicTitle(slug: string): string {
  return slug.split("-").map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`).join(" ")
}

export function formatTopicWeightDelta(weight: number, delta: number): string {
  const change = Math.abs(delta) >= 0.005
    ? ` ${delta > 0 ? "+" : "-"}${Math.round(Math.abs(delta) * 100)} pp`
    : ""
  return `${Math.round(weight * 100)}%${change}`
}

export function TopicPolicy({
  topicIntent,
  baselineTopicIntent,
  catalog,
  label,
}: {
  readonly topicIntent: ShadowDemoTopicIntent
  readonly baselineTopicIntent: ShadowDemoTopicIntent
  readonly catalog: readonly ShadowDemoTopicCatalogEntry[]
  readonly label: string
}) {
  const entries = Object.entries(topicIntent.topicWeights)
    .map(([slug, weight]) => ({
      slug,
      weight,
      delta: weight - (baselineTopicIntent.topicWeights[slug] ?? weight),
    }))
    .sort((left, right) => Math.abs(right.delta) - Math.abs(left.delta) || right.weight - left.weight)
    .slice(0, 4)

  return (
    <div>
      <p className="text-[10px] font-mono uppercase tracking-[0.2em] text-foreground/50">{label}</p>
      <div className="mt-2 grid gap-1.5 sm:grid-cols-2">
        {entries.map(({ slug, weight, delta }) => (
          <div key={slug} className="flex items-center justify-between gap-3 rounded-lg border border-border/70 bg-background px-3 py-2">
            <span className="min-w-0 text-xs font-medium text-foreground/70">{topicLabel(slug, catalog)}</span>
            <span className="flex-shrink-0 font-mono text-xs font-semibold text-foreground/60">
              {formatTopicWeightDelta(weight, delta)}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
