'use client'

import { use, useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useInvestmentCaseLive } from '@/components/realtime/useInvestmentCaseLive'
import { ValuationDisplay } from '@/components/valuation/ValuationDisplay'
import { EquityCapBar } from '@/components/valuation/EquityCapBar'
import { PhaseIndicator } from '@/components/bidding/PhaseIndicator'
import { CountdownTimer } from '@/components/countdown/CountdownTimer'
import { formatAmount } from '@/lib/valuation/calculator'
import type { StartupProfile } from '@/types/database'

export default function PitchDisplayPage({
  params,
}: {
  params: Promise<{ eventSlug: string; caseId: string }>
}) {
  const { caseId } = use(params)
  const supabase = createClient()
  const [startup, setStartup] = useState<StartupProfile | null>(null)

  const { bids, phase, countdownEndsAt, equityOffered, totalEquitySold, totalCapital, impliedValuation, investorCount } =
    useInvestmentCaseLive(caseId)

  useEffect(() => {
    supabase
      .from('startup_profiles_public')
      .select('*')
      .eq('investment_case_id', caseId)
      .single()
      .then(({ data }) => setStartup(data))
  }, [caseId])

  // `bids` from the hook is already the phase-appropriate set
  // (active while open, finalized once closed) — no need to
  // re-filter by status here.
  const topBids = bids

  return (
    <div className="min-h-screen bg-black flex flex-col p-8 md:p-16 gap-8">
      {/* Top bar */}
      <div className="flex items-center justify-between">
        <p className="text-white/30 font-black text-xl">
          Stage<span className="text-blue-400">Capital</span>
        </p>
        <PhaseIndicator status={phase} />
      </div>

      {/* Countdown overlay */}
      {phase === 'countdown' && countdownEndsAt && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-10">
          <div className="text-center">
            <CountdownTimer endsAt={countdownEndsAt} large />
          </div>
        </div>
      )}

      <div className="flex-1 flex flex-col justify-center gap-10">
        {/* Company header */}
        <div className="text-center space-y-2">
          {startup?.logo_url && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={startup.logo_url} alt={`${startup.company_name} logo`} className="w-20 h-20 rounded-2xl object-cover mx-auto mb-2 border border-white/10" />
          )}
          {startup?.company_name && (
            <h1 className="text-5xl md:text-7xl font-black text-white tracking-tight">
              {startup.company_name}
            </h1>
          )}
          {startup?.one_liner && (
            <p className="text-white/50 text-xl md:text-2xl">{startup.one_liner}</p>
          )}
        </div>

        {/* Live valuation — hero */}
        <div className="text-center">
          <ValuationDisplay value={impliedValuation} large />
        </div>

        {/* Stats grid */}
        <div className="grid grid-cols-3 gap-4 max-w-2xl mx-auto w-full">
          {[
            { label: 'Capital Raised', value: formatAmount(totalCapital) },
            { label: 'Equity Sold', value: `${totalEquitySold.toFixed(1)}%` },
            { label: 'Investors', value: investorCount.toString() },
          ].map(({ label, value }) => (
            <div key={label} className="rounded-xl border border-white/10 bg-white/5 p-4 text-center">
              <p className="text-2xl md:text-3xl font-black text-white">{value}</p>
              <p className="text-xs text-white/40 uppercase tracking-wider mt-1">{label}</p>
            </div>
          ))}
        </div>

        {/* Equity bar */}
        <div className="max-w-2xl mx-auto w-full">
          <EquityCapBar sold={totalEquitySold} total={equityOffered} />
        </div>

        {/* Top bids */}
        {topBids.length > 0 && (
          <div className="max-w-2xl mx-auto w-full space-y-2">
            <p className="text-xs text-white/30 uppercase tracking-wider text-center">Top Bids</p>
            {[...topBids]
              .sort((a, b) => b.price_per_pct - a.price_per_pct)
              .slice(0, 5)
              .map((bid, i) => (
                <div key={bid.id} className="flex items-center gap-3 rounded-lg bg-white/5 px-4 py-2.5">
                  <span className="text-white/30 font-bold w-4 text-sm">{i + 1}</span>
                  <span className="flex-1 text-white/60 text-sm">{bid.equity_pct}% equity</span>
                  <span className="font-bold text-white">{formatAmount(bid.amount)}</span>
                </div>
              ))}
          </div>
        )}
      </div>
    </div>
  )
}
