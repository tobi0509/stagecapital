'use client'

import { formatValuation, formatAmount } from '@/lib/valuation/calculator'
import type { InvestmentCaseLive, StartupProfile } from '@/types/database'

interface LeaderboardEntry {
  live: InvestmentCaseLive
  profile: StartupProfile | null
}

interface LeaderboardTableProps {
  entries: LeaderboardEntry[]
  showWinner?: boolean
}

export function LeaderboardTable({ entries, showWinner }: LeaderboardTableProps) {
  const sorted = [...entries].sort((a, b) => {
    if ((b.live.implied_valuation ?? 0) !== (a.live.implied_valuation ?? 0)) {
      return (b.live.implied_valuation ?? 0) - (a.live.implied_valuation ?? 0)
    }
    return b.live.active_bid_count - a.live.active_bid_count
  })

  return (
    <div className="space-y-3">
      {sorted.map((entry, i) => {
        const isWinner = showWinner && i === 0 && (entry.live.implied_valuation ?? 0) > 0
        const name = entry.profile?.company_name || entry.live.investment_case_id.slice(0, 8)

        return (
          <div
            key={entry.live.investment_case_id}
            className={`flex items-center gap-4 rounded-xl border p-4 transition-all
              ${isWinner
                ? 'border-amber-500/50 bg-amber-500/10'
                : 'border-white/10 bg-white/5'
              }`}
          >
            <span className={`text-2xl font-black w-8 text-center
              ${isWinner ? 'text-amber-400' : 'text-white/30'}`}>
              {isWinner ? '🏆' : i + 1}
            </span>
            <div className="flex-1 min-w-0">
              <p className={`font-semibold truncate ${isWinner ? 'text-amber-300' : 'text-white'}`}>
                {name}
              </p>
              <p className="text-xs text-white/50">
                {entry.live.total_equity_sold_pct.toFixed(1)}% equity · {entry.live.active_bid_count} investors
              </p>
            </div>
            <div className="text-right shrink-0">
              <p className={`font-bold text-lg tabular-nums ${isWinner ? 'text-amber-300' : 'text-white'}`}>
                {formatValuation(entry.live.implied_valuation)}
              </p>
              <p className="text-xs text-white/50">
                {formatAmount(entry.live.total_capital_raised)} raised
              </p>
            </div>
          </div>
        )
      })}

      {sorted.length === 0 && (
        <div className="text-center py-12 text-white/40">
          No results yet
        </div>
      )}
    </div>
  )
}
