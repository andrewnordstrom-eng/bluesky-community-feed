"use client"

import {
  RadarChart,
  Radar,
  PolarGrid,
  PolarAngleAxis,
  ResponsiveContainer,
  Tooltip,
} from "recharts"

export interface RadarSignal {
  key: string
  label: string
  /** Post raw score 0–1 */
  post: number
  /** Governance weight 0–1 */
  governance: number
}

interface ScoreRadarProps {
  signals: RadarSignal[]
  className?: string
}

/* Custom dot — solid ginger circle */
function GingerDot(props: {
  cx?: number; cy?: number; r?: number; fill?: string
}) {
  const cx = props.cx ?? 0
  const cy = props.cy ?? 0
  return (
    <circle
      cx={cx}
      cy={cy}
      r={4}
      fill="hsl(21 63% 48%)"
      stroke="hsl(40 100% 99%)"
      strokeWidth={1.5}
    />
  )
}

interface RadarTooltipPayload {
  name: string
  value: number
  dataKey: string
  payload?: {
    label?: string
  }
}

/* Custom tooltip */
function RadarTooltip({ active, payload }: {
  active?: boolean
  payload?: RadarTooltipPayload[]
}) {
  if (!active || !payload?.length) return null
  const label = payload[0]?.payload?.label
  return (
    <div className="rounded-lg border border-border bg-card shadow-md px-3 py-2 text-xs">
      <p className="font-semibold text-foreground mb-1.5">{label}</p>
      {payload.map((p) => (
        <div key={p.dataKey} className="flex items-center justify-between gap-4">
          <span className="text-foreground/55">{p.name}</span>
          <span className="font-mono font-semibold text-foreground tabular-nums">
            {(p.value).toFixed(0)}%
          </span>
        </div>
      ))}
    </div>
  )
}

export function ScoreRadar({ signals, className }: ScoreRadarProps) {
  /* Recharts wants 0-100 domain */
  const data = signals.map((s) => ({
    label: s.label,
    post: Math.round(s.post * 100),
    governance: Math.round(s.governance * 100),
  }))

  return (
    <div className={`w-full ${className ?? ""}`}>
      <ResponsiveContainer width="100%" height={280}>
        <RadarChart data={data} margin={{ top: 10, right: 30, bottom: 10, left: 30 }}>
          <PolarGrid
            gridType="polygon"
            stroke="hsl(35 30% 82%)"
            strokeOpacity={0.8}
          />
          <PolarAngleAxis
            dataKey="label"
            tick={{
              fill: "hsl(20 14% 15% / 0.55)",
              fontSize: 11,
              fontFamily: "inherit",
              fontWeight: 500,
            }}
            tickLine={false}
          />

          {/* Governance weights — sable outline, biscuit tint */}
          <Radar
            name="Governance weight"
            dataKey="governance"
            stroke="hsl(20 14% 15% / 0.25)"
            fill="hsl(34 35% 87%)"
            fillOpacity={0.5}
            strokeWidth={1.5}
            dot={false}
          />

          {/* Post score — ginger fill */}
          <Radar
            name="Post score"
            dataKey="post"
            stroke="hsl(21 63% 48%)"
            fill="hsl(21 63% 48%)"
            fillOpacity={0.18}
            strokeWidth={2}
            dot={<GingerDot />}
          />

          <Tooltip content={<RadarTooltip />} />
        </RadarChart>
      </ResponsiveContainer>

      {/* Legend */}
      <div className="flex items-center justify-center gap-6 mt-1">
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded-sm bg-primary/20 border border-primary" />
          <span className="text-xs text-foreground/55">Post score</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded-sm bg-biscuit border border-foreground/20" />
          <span className="text-xs text-foreground/55">Governance weight</span>
        </div>
      </div>
    </div>
  )
}
