import type { ShadowDemoTopicIntent } from "@/app/demo/shadow-demo-view-model"

const TOPIC_LABELS: Readonly<Record<string, string>> = {
  "science-research": "Science research",
  "data-science": "Data science",
  "software-development": "Software development",
  "open-source": "Open source",
}

function topicLabel(key: string): string {
  return TOPIC_LABELS[key] ?? key.split("-").map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`).join(" ")
}

export function TopicPolicy({
  topicIntent,
  label,
}: {
  readonly topicIntent: ShadowDemoTopicIntent
  readonly label: string
}) {
  return (
    <div>
      <p className="text-[10px] font-mono uppercase tracking-[0.2em] text-foreground/50">{label}</p>
      <div className="mt-2 grid gap-1.5 sm:grid-cols-2">
        {Object.entries(topicIntent.topicWeights).map(([key, weight]) => (
          <div key={key} className="flex items-center justify-between gap-3 rounded-lg border border-border/70 bg-background px-3 py-2">
            <span className="min-w-0 text-xs font-medium text-foreground/70">{topicLabel(key)}</span>
            <span className="flex-shrink-0 font-mono text-xs font-semibold text-foreground/60">
              {Math.round(weight * 100)}%
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
