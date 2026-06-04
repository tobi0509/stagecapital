import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { Sidebar } from '@/components/layout/Sidebar'
import { LeaderboardTable } from '@/components/valuation/LeaderboardTable'
import type { UserRole, InvestmentCase, StartupProfile, InvestmentCaseLive } from '@/types/database'

export const revalidate = 5

export default async function LeaderboardPage({
  params,
}: {
  params: Promise<{ eventSlug: string }>
}) {
  const { eventSlug } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: event } = await supabase
    .from('events')
    .select('*')
    .eq('slug', eventSlug)
    .single()

  if (!event) redirect('/dashboard')

  const { data: roleData } = await supabase
    .from('event_roles')
    .select('role')
    .eq('event_id', event.id)
    .eq('user_id', user.id)
    .single()

  const myRole = roleData?.role as UserRole | null

  const { data: cases } = await supabase
    .from('investment_cases')
    .select('*, startup_profiles(*)')
    .eq('event_id', event.id)

  const { data: bids } = await supabase
    .from('bids')
    .select('investment_case_id, equity_pct, amount, investor_user_id')
    .in('investment_case_id', (cases ?? []).map((c: InvestmentCase) => c.id))
    .in('status', ['active', 'finalized'])

  // Compute live data
  const liveMap: Record<string, InvestmentCaseLive> = {}
  for (const ic of (cases ?? [])) {
    liveMap[ic.id] = {
      investment_case_id: ic.id,
      event_id: event.id,
      equity_offered_pct: ic.equity_offered_pct,
      ask_amount: ic.ask_amount,
      bidding_status: ic.bidding_status,
      countdown_ends_at: ic.countdown_ends_at,
      pitch_order: ic.pitch_order,
      total_equity_sold_pct: 0,
      total_capital_raised: 0,
      implied_valuation: null,
      active_bid_count: 0,
    }
  }

  for (const bid of (bids ?? [])) {
    const lv = liveMap[bid.investment_case_id]
    if (!lv) continue
    lv.total_capital_raised += bid.amount
    lv.total_equity_sold_pct += bid.equity_pct
    lv.active_bid_count++
  }

  for (const lv of Object.values(liveMap)) {
    if (lv.total_equity_sold_pct > 0) {
      lv.implied_valuation = lv.total_capital_raised / (lv.total_equity_sold_pct / 100)
    }
  }

  const entries = (cases ?? []).map((ic: InvestmentCase & { startup_profiles: StartupProfile | null }) => ({
    live: liveMap[ic.id],
    profile: ic.startup_profiles,
  }))

  const eventClosed = event.status === 'closed' || event.status === 'results_published'

  return (
    <div className="flex min-h-screen">
      <Sidebar eventSlug={eventSlug} role={myRole} />
      <main className="flex-1 p-6 md:p-8 space-y-6 max-w-3xl">
        <div>
          <p className="text-blue-400 text-sm font-medium uppercase tracking-wider">Leaderboard</p>
          <h1 className="text-3xl font-black text-white mt-1">{event.name}</h1>
          {eventClosed && (
            <p className="text-amber-400 text-sm mt-1 font-semibold">🏆 Final Results</p>
          )}
        </div>

        <LeaderboardTable entries={entries} showWinner={eventClosed} />
      </main>
    </div>
  )
}
