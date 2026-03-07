import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  ReferenceLine,
  Cell,
  ResponsiveContainer,
  Tooltip,
} from 'recharts';

interface TopicWeight {
  slug: string;
  name: string;
  weight: number;
}

interface TopicWeightChartProps {
  topics: TopicWeight[];
  voterCount: number;
}

/** Prettify a slug into a display name: "software-development" → "Software Development" */
function prettifySlug(slug: string): string {
  return slug
    .split('-')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

const BOOST_COLOR = '#34c759';
const PENALIZE_COLOR = '#ff453a';
const NEUTRAL_COLOR = '#6e6e73';

/**
 * TopicWeightChart Component
 *
 * Horizontal bar chart showing community topic weight distribution.
 * Topics above 0.5 are green (boosted), below 0.5 are red (penalized).
 */
export function TopicWeightChart({ topics, voterCount }: TopicWeightChartProps) {
  // Sort topics by weight descending
  const sorted = [...topics].sort((a, b) => b.weight - a.weight);

  const data = sorted.map((t) => ({
    name: t.name || prettifySlug(t.slug),
    weight: Math.round(t.weight * 100),
    rawWeight: t.weight,
  }));

  const chartHeight = Math.max(data.length * 36 + 60, 200);

  // Find most boosted and most penalized
  const mostBoosted = sorted.filter((t) => t.weight > 0.55).slice(0, 2);
  const mostPenalized = sorted.filter((t) => t.weight < 0.45).reverse().slice(0, 2);

  return (
    <div className="topic-weight-chart">
      {voterCount === 0 ? (
        <div className="topic-chart-empty">
          No topic votes yet. Be the first to set topic preferences!
        </div>
      ) : (
        <>
          <div className="topic-chart-summary">
            {mostBoosted.length > 0 && (
              <span className="summary-item boosted">
                Most boosted: {mostBoosted.map((t) => t.name || prettifySlug(t.slug)).join(', ')}
              </span>
            )}
            {mostPenalized.length > 0 && (
              <span className="summary-item penalized">
                Most reduced: {mostPenalized.map((t) => t.name || prettifySlug(t.slug)).join(', ')}
              </span>
            )}
          </div>

          <ResponsiveContainer width="100%" height={chartHeight}>
            <BarChart
              data={data}
              layout="vertical"
              margin={{ top: 5, right: 40, left: 0, bottom: 5 }}
            >
              <XAxis
                type="number"
                domain={[0, 100]}
                tickFormatter={(v: number) => `${v}%`}
                tick={{ fill: '#6e6e73', fontSize: 12 }}
                axisLine={{ stroke: '#3a3a3c' }}
                tickLine={{ stroke: '#3a3a3c' }}
              />
              <YAxis
                type="category"
                dataKey="name"
                width={150}
                tick={{ fill: '#e5e5e7', fontSize: 13 }}
                axisLine={false}
                tickLine={false}
              />
              <ReferenceLine
                x={50}
                stroke="#6e6e73"
                strokeDasharray="3 3"
                label={{
                  value: 'Neutral',
                  position: 'top',
                  fill: '#6e6e73',
                  fontSize: 11,
                }}
              />
              <Tooltip
                formatter={(value) => [`${value}%`, 'Community weight']}
                contentStyle={{
                  background: '#1c1c1e',
                  border: '1px solid #3a3a3c',
                  borderRadius: '8px',
                  fontSize: '13px',
                }}
                labelStyle={{ color: '#e5e5e7' }}
              />
              <Bar dataKey="weight" radius={[0, 4, 4, 0]} barSize={20}>
                {data.map((entry) => (
                  <Cell
                    key={entry.name}
                    fill={
                      entry.rawWeight > 0.5
                        ? BOOST_COLOR
                        : entry.rawWeight < 0.5
                          ? PENALIZE_COLOR
                          : NEUTRAL_COLOR
                    }
                    fillOpacity={0.7}
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </>
      )}

      <style>{`
        .topic-weight-chart {
          margin-top: var(--space-4);
        }

        .topic-chart-empty {
          text-align: center;
          color: var(--text-secondary);
          padding: var(--space-8) var(--space-4);
          font-size: var(--text-sm);
          font-style: italic;
        }

        .topic-chart-summary {
          display: flex;
          flex-wrap: wrap;
          gap: var(--space-4);
          margin-bottom: var(--space-4);
        }

        .summary-item {
          font-size: var(--text-sm);
          padding: var(--space-1) var(--space-3);
          border-radius: var(--radius-md);
        }

        .summary-item.boosted {
          background: rgba(52, 199, 89, 0.15);
          color: var(--status-success);
        }

        .summary-item.penalized {
          background: rgba(255, 69, 58, 0.15);
          color: var(--status-error);
        }
      `}</style>
    </div>
  );
}

export default TopicWeightChart;
