import type { Bid } from '@/types/database'

export function calculateImpliedValuation(bids: Bid[]): number | null {
  const active = bids.filter(b => b.status === 'active' || b.status === 'finalized')
  const totalCapital = active.reduce((sum, b) => sum + b.amount, 0)
  const totalEquityPct = active.reduce((sum, b) => sum + b.equity_pct, 0)
  if (totalEquityPct === 0) return null
  return totalCapital / (totalEquityPct / 100)
}

export function formatValuation(val: number | null): string {
  if (val === null) return '—'
  if (val >= 1_000_000) return `$${(val / 1_000_000).toFixed(2)}M`
  if (val >= 1_000) return `$${(val / 1_000).toFixed(0)}K`
  return `$${val.toFixed(0)}`
}

export function formatAmount(amount: number): string {
  if (amount >= 1_000_000) return `$${(amount / 1_000_000).toFixed(2)}M`
  if (amount >= 1_000) return `$${(amount / 1_000).toFixed(0)}K`
  return `$${amount.toFixed(0)}`
}
