'use client'

interface EquityCapBarProps {
  sold: number
  total: number
  showLabel?: boolean
}

export function EquityCapBar({ sold, total, showLabel = true }: EquityCapBarProps) {
  const pct = total > 0 ? Math.min(100, (sold / total) * 100) : 0
  const isFull = pct >= 100

  return (
    <div className="space-y-1.5">
      {showLabel && (
        <div className="flex justify-between text-xs text-muted-foreground">
          <span>Equity Filled</span>
          <span className={isFull ? 'text-amber-400 font-semibold' : ''}>
            {sold.toFixed(1)}% / {total}%
          </span>
        </div>
      )}
      <div className="h-2 bg-white/10 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-500 ${
            isFull ? 'bg-amber-400' : 'bg-blue-500'
          }`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  )
}
