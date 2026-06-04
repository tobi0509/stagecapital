'use client'

import { use, useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useInvestmentCaseLive } from '@/components/realtime/useInvestmentCaseLive'
import { useBudget } from '@/hooks/useBudget'
import { BidForm } from '@/components/bidding/BidForm'
import { BudgetMeter } from '@/components/bidding/BudgetMeter'
import { PhaseIndicator } from '@/components/bidding/PhaseIndicator'
import { ValuationDisplay } from '@/components/valuation/ValuationDisplay'
import { EquityCapBar } from '@/components/valuation/EquityCapBar'
import { CountdownTimer } from '@/components/countdown/CountdownTimer'
import { Sidebar } from '@/components/layout/Sidebar'
import { formatAmount } from '@/lib/valuation/calculator'
import { toast } from 'sonner'
import type { StartupProfile, TeamMember, UserRole, Event, EventRole } from '@/types/database'

export default function InvestPage({
  params,
}: {
  params: Promise<{ eventSlug: string; caseId: string }>
}) {
  const { eventSlug, caseId } = use(params)
  const supabase = createClient()

  const [userId, setUserId] = useState<string>()
  const [event, setEvent] = useState<Event>()
  const [myRole, setMyRole] = useState<UserRole | null>(null)
  const [myBudgetTotal, setMyBudgetTotal] = useState<number | null>(null)
  const [startup, setStartup] = useState<StartupProfile | null>(null)
  const [team, setTeam] = useState<TeamMember[]>([])

  const { bids, phase, countdownEndsAt, equityOffered, totalEquitySold, totalCapital, impliedValuation, loading } =
    useInvestmentCaseLive(caseId)

  const budget = useBudget(event?.id, userId, myBudgetTotal)
  const myBid = bids.find(b => b.investor_user_id === userId && (b.status === 'active'))

  useEffect(() => {
    async function init() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return
      setUserId(user.id)

      const { data: ev } = await supabase.from('events').select('*').eq('slug', eventSlug).single()
      if (!ev) return
      setEvent(ev)

      const { data: role } = await supabase
        .from('event_roles')
        .select('role, total_budget')
        .eq('event_id', ev.id)
        .eq('user_id', user.id)
        .single()

      if (role) {
        setMyRole(role.role as UserRole)
        const budget = role.total_budget ?? (role.role === 'investor' ? ev.investor_budget : ev.default_budget)
        setMyBudgetTotal(budget)
      }

      const { data: sp } = await supabase
        .from('startup_profiles')
        .select('*')
        .eq('investment_case_id', caseId)
        .single()
      setStartup(sp)

      if (sp) {
        const { data: tm } = await supabase
          .from('team_members')
          .select('*')
          .eq('startup_profile_id', sp.id)
          .order('sort_order')
        setTeam(tm ?? [])
      }
    }
    init()
  }, [eventSlug, caseId])

  // Displacement notification
  useEffect(() => {
    if (!userId || !event) return
    const channel = supabase
      .channel(`investor:${userId}:${event.id}`)
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'bids',
        filter: `investor_user_id=eq.${userId}`,
      }, (payload) => {
        if (payload.new.status === 'displaced' && payload.new.investment_case_id === caseId) {
          toast.warning('Your bid was displaced!', {
            description: `Your bid on ${startup?.company_name ?? 'this startup'} was outbid. Budget returned — place a new bid!`,
            duration: 8000,
          })
        }
      })
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [userId, event?.id, caseId])

  const canBid = myRole === 'investor' || myRole === 'attendee'
  const equityAvailable = equityOffered - totalEquitySold + (myBid?.equity_pct ?? 0)

  if (loading) {
    return (
      <div className="flex min-h-screen">
        <Sidebar eventSlug={eventSlug} role={myRole} />
        <main className="flex-1 flex items-center justify-center">
          <div className="text-white/40">Loading…</div>
        </main>
      </div>
    )
  }

  return (
    <div className="flex min-h-screen">
      <Sidebar eventSlug={eventSlug} role={myRole} />
      <main className="flex-1 p-4 md:p-6 space-y-5 max-w-2xl mx-auto w-full">

        {/* Header */}
        <div className="space-y-2">
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-2xl font-black text-white">
              {startup?.company_name || 'Startup'}
            </h1>
            <PhaseIndicator status={phase} />
          </div>
          {startup?.one_liner && (
            <p className="text-white/50 text-sm">{startup.one_liner}</p>
          )}
        </div>

        {/* Countdown */}
        {phase === 'countdown' && countdownEndsAt && (
          <CountdownTimer endsAt={countdownEndsAt} />
        )}

        {/* Live stats */}
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-xl border border-white/10 bg-white/5 p-4">
            <ValuationDisplay value={impliedValuation} />
          </div>
          <div className="rounded-xl border border-white/10 bg-white/5 p-4 space-y-2">
            <p className="text-xs text-muted-foreground">Capital Raised</p>
            <p className="text-2xl font-bold text-white">{formatAmount(totalCapital)}</p>
          </div>
        </div>

        <EquityCapBar sold={totalEquitySold} total={equityOffered} />

        {/* Bid form */}
        {canBid ? (
          <div className="space-y-3">
            <BudgetMeter
              total={budget.total}
              committed={budget.committed}
              available={budget.available}
            />
            <BidForm
              caseId={caseId}
              phase={phase}
              equityOffered={equityOffered}
              equityAvailable={Math.max(0, equityAvailable)}
              availableBudget={budget.available}
              existingBid={myBid ?? null}
              onSuccess={budget.refresh}
            />
          </div>
        ) : (
          <div className="rounded-xl border border-white/10 bg-white/5 p-4 text-white/50 text-sm text-center">
            {myRole === 'startup'
              ? "You are the startup — you cannot bid on your own case."
              : "You need the Investor or Attendee role to place bids."}
          </div>
        )}

        {/* Active bids list */}
        {bids.length > 0 && (
          <div className="space-y-2">
            <h3 className="text-sm font-semibold text-white/60 uppercase tracking-wider">
              Active Bids ({bids.filter(b => b.status === 'active').length})
            </h3>
            <div className="space-y-1">
              {[...bids]
                .filter(b => b.status === 'active')
                .sort((a, b) => b.price_per_pct - a.price_per_pct)
                .map((bid, i) => (
                  <div
                    key={bid.id}
                    className={`flex items-center justify-between gap-3 px-3 py-2.5 rounded-lg text-sm
                      ${bid.investor_user_id === userId
                        ? 'bg-blue-500/15 border border-blue-500/30'
                        : 'bg-white/5'
                      }`}
                  >
                    <span className="text-white/40 w-5 text-xs">{i + 1}</span>
                    <span className="flex-1 text-white/70">
                      {bid.equity_pct}% equity
                      {bid.investor_user_id === userId && <span className="text-blue-400 ml-1">(yours)</span>}
                    </span>
                    <span className="text-white font-semibold">{formatAmount(bid.amount)}</span>
                    <span className="text-white/40 text-xs">{formatAmount(bid.price_per_pct)}/pt</span>
                  </div>
                ))}
            </div>
          </div>
        )}

        {/* Startup details */}
        {startup && (
          <div className="space-y-4 border-t border-white/10 pt-4">
            <h3 className="font-bold text-white">About {startup.company_name}</h3>

            {startup.problem_statement && (
              <div>
                <p className="text-xs text-white/40 uppercase tracking-wider mb-1">Problem</p>
                <p className="text-white/70 text-sm">{startup.problem_statement}</p>
              </div>
            )}

            {startup.solution && (
              <div>
                <p className="text-xs text-white/40 uppercase tracking-wider mb-1">Solution</p>
                <p className="text-white/70 text-sm">{startup.solution}</p>
              </div>
            )}

            {myRole === 'investor' && startup.contact_email && (
              <div className="rounded-xl border border-white/10 bg-white/5 p-4 flex items-center justify-between">
                <div>
                  <p className="text-xs text-white/40 uppercase tracking-wider">Contact</p>
                  <p className="text-white text-sm mt-0.5">{startup.contact_email}</p>
                </div>
                <a
                  href={`mailto:${startup.contact_email}`}
                  className="px-3 py-1.5 rounded-lg bg-blue-500 hover:bg-blue-600 text-white text-sm font-semibold transition-colors"
                >
                  Contact
                </a>
              </div>
            )}

            {team.length > 0 && (
              <div>
                <p className="text-xs text-white/40 uppercase tracking-wider mb-2">Team</p>
                <div className="grid grid-cols-3 gap-3">
                  {team.map(m => (
                    <div key={m.id} className="text-center">
                      <div className="w-12 h-12 rounded-full bg-white/10 mx-auto flex items-center justify-center text-xl">
                        {m.name[0]}
                      </div>
                      <p className="text-xs font-semibold text-white mt-1.5">{m.name}</p>
                      <p className="text-xs text-white/40">{m.title}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  )
}
