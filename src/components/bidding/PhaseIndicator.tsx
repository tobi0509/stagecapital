import type { BiddingStatus } from '@/types/database'

const PHASE_CONFIG: Record<BiddingStatus, { label: string; color: string }> = {
  pending:     { label: 'Not Started',  color: 'bg-white/10 text-white/50' },
  additive:    { label: 'Open · Additive',    color: 'bg-green-500/20 text-green-400 border border-green-500/30' },
  competitive: { label: 'Open · Competitive', color: 'bg-amber-500/20 text-amber-400 border border-amber-500/30' },
  countdown:   { label: 'Closing…',     color: 'bg-red-500/20 text-red-400 border border-red-500/30' },
  closed:      { label: 'Closed',       color: 'bg-white/5 text-white/40 border border-white/10' },
}

export function PhaseIndicator({ status }: { status: BiddingStatus }) {
  const cfg = PHASE_CONFIG[status]
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold ${cfg.color}`}>
      {(status === 'additive' || status === 'competitive') && (
        <span className="w-1.5 h-1.5 rounded-full bg-current animate-pulse" />
      )}
      {cfg.label}
    </span>
  )
}
