'use client'

import { formatAmount } from '@/lib/valuation/calculator'

interface BudgetMeterProps {
  total: number | null
  committed: number
  available: number | null
}

export function BudgetMeter({ total, committed, available }: BudgetMeterProps) {
  const pctUsed = total && total > 0 ? Math.min(100, (committed / total) * 100) : 0

  return (
    <div className="rounded-xl border border-white/10 bg-white/5 p-4 space-y-3">
      <p className="text-xs uppercase tracking-widest text-white/50">Your Budget</p>
      <div className="flex justify-between gap-4">
        <div>
          <p className="text-2xl font-bold text-white">{available !== null ? formatAmount(available) : '—'}</p>
          <p className="text-xs text-white/50">Available</p>
        </div>
        <div className="text-right">
          <p className="text-lg font-semibold text-white/60">{total !== null ? formatAmount(total) : '—'}</p>
          <p className="text-xs text-white/50">Total</p>
        </div>
      </div>
      <div className="h-1.5 bg-white/10 rounded-full overflow-hidden">
        <div
          className="h-full bg-blue-500 rounded-full transition-all duration-500"
          style={{ width: `${pctUsed}%` }}
        />
      </div>
      {committed > 0 && (
        <p className="text-xs text-white/40">{formatAmount(committed)} committed in active bids</p>
      )}
    </div>
  )
}
