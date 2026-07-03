'use client'

import { use, useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import Link from 'next/link'
import { Sidebar } from '@/components/layout/Sidebar'
import { BudgetMeter } from '@/components/bidding/BudgetMeter'
import { PhaseIndicator } from '@/components/bidding/PhaseIndicator'
import { useBudget } from '@/hooks/useBudget'
import { formatAmount, formatValuation } from '@/lib/valuation/calculator'
import type { Event, InvestmentCase, StartupProfile, UserRole, Bid } from '@/types/database'

interface CaseStats {
  total_equity_sold_pct: number
  total_capital_raised: number
  implied_valuation: number | null
  investor_count: number
}

export default function PortfolioPage({
  params,
}: {
  params: Promise<{ eventSlug: string }>
}) {
  const { eventSlug } = use(params)
  const supabase = createClient()

  const [userId, setUserId] = useState<string>()
  const [event, setEvent] = useState<Event | null>(null)
  const [myRole, setMyRole] = useState<UserRole | null>(null)
  const [myBudgetTotal, setMyBudgetTotal] = useState<number | null>(null)
  const [myBids, setMyBids] = useState<(Bid & { investment_cases: (InvestmentCase & { startup_profiles: StartupProfile | null }) | null })[]>([])
  const [allCases, setAllCases] = useState<(InvestmentCase & { startup_profiles: StartupProfile | null })[]>([])
  const [statsMap, setStatsMap] = useState<Record<string, CaseStats>>({})

  const budget = useBudget(event?.id, userId, myBudgetTotal)

  useEffect(() => {
    async function init() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return
      setUserId(user.id)

      const { data: ev } = await supabase.from('events').select('*').eq('slug', eventSlug).single()
      if (!ev) return
      setEvent(ev)

      const { data: role } = await supabase
        .from('event_roles').select('role, total_budget').eq('event_id', ev.id).eq('user_id', user.id).single()
      if (role) {
        setMyRole(role.role as UserRole)
        setMyBudgetTotal(role.total_budget ?? (role.role === 'investor' ? ev.investor_budget : ev.default_budget))
      }

      const { data: cases } = await supabase
        .from('investment_cases')
        .select('*, startup_profiles(*)')
        .eq('event_id', ev.id)
        .order('pitch_order')
      setAllCases(cases ?? [])

      // Case-level totals come from a SECURITY DEFINER RPC (bypasses per-row
      // bid RLS) so investor and attendee see identical, correct numbers.
      const { data: statsRows } = await supabase.rpc('event_valuation_stats', { p_event_id: ev.id })
      const map: Record<string, CaseStats> = {}
      for (const row of (statsRows ?? [])) map[row.investment_case_id] = row
      setStatsMap(map)

      const { data: bids } = await supabase
        .from('bids')
        .select('*, investment_cases(*, startup_profiles(*))')
        .eq('investor_user_id', user.id)
        .in('investment_case_id', (cases ?? []).map((c: InvestmentCase) => c.id))
        .eq('status', 'active')
      setMyBids(bids ?? [])
    }
    init()
  }, [eventSlug])

  return (
    <div className="flex min-h-screen">
      <Sidebar eventSlug={eventSlug} role={myRole} />
      <main className="flex-1 p-4 md:p-6 space-y-6 max-w-2xl mx-auto w-full">
        <div>
          <p className="text-blue-400 text-sm font-medium uppercase tracking-wider">My Portfolio</p>
          <h1 className="text-2xl font-black text-white mt-1">Active Bids</h1>
        </div>

        <BudgetMeter
          total={budget.total}
          committed={budget.committed}
          available={budget.available}
        />

        {myBids.length > 0 ? (
          <div className="space-y-3">
            {myBids.map(bid => {
              const ic = bid.investment_cases
              const sp = ic?.startup_profiles
              return (
                <Link
                  key={bid.id}
                  href={`/events/${eventSlug}/invest/${bid.investment_case_id}`}
                  className="block rounded-xl border border-white/10 bg-white/5 hover:border-blue-500/30 p-4 transition-all"
                >
                  <div className="flex items-center gap-3 flex-wrap">
                    <div className="flex-1">
                      <p className="font-bold text-white">{sp?.company_name || ic?.title || 'Startup'}</p>
                      <p className="text-xs text-white/40 mt-0.5">{bid.equity_pct}% equity</p>
                    </div>
                    <div className="text-right">
                      <p className="font-bold text-white">{formatAmount(bid.amount)}</p>
                      <p className="text-xs text-white/40">{formatAmount(bid.price_per_pct)}/pt</p>
                    </div>
                    {ic && <PhaseIndicator status={ic.bidding_status} />}
                  </div>
                </Link>
              )
            })}
          </div>
        ) : (
          <div className="text-center py-12 text-white/40">
            <p className="text-4xl mb-3">💼</p>
            <p>No active bids yet</p>
          </div>
        )}

        <div className="border-t border-white/10 pt-5 space-y-3">
          <h3 className="text-sm font-semibold text-white/60 uppercase tracking-wider">All Investment Cases</h3>
          {allCases.map(ic => {
            const stats = statsMap[ic.id]
            const askValuation = ic.equity_offered_pct > 0 ? ic.ask_amount / (ic.equity_offered_pct / 100) : null
            return (
              <Link
                key={ic.id}
                href={`/events/${eventSlug}/invest/${ic.id}`}
                className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/5 hover:border-white/20 p-3 transition-all"
              >
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-white truncate">
                    {ic.startup_profiles?.company_name || ic.title}
                  </p>
                  <p className="text-xs text-white/40 mt-0.5">
                    {ic.equity_offered_pct}% offered · Asking {formatValuation(askValuation)}
                    {stats?.implied_valuation ? ` · Now ${formatValuation(stats.implied_valuation)}` : ''}
                  </p>
                </div>
                <PhaseIndicator status={ic.bidding_status} />
              </Link>
            )
          })}
        </div>
      </main>
    </div>
  )
}
