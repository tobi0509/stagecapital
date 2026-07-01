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

  // Case-level totals come from a SECURITY DEFINER RPC, not from
  // summing raw bid rows — per-row bid visibility is intentionally
  // restricted for some roles (see migration 0005), but the
  // leaderboard's totals must stay accurate for every viewer.
  const { data: statsRows } = await supabase.rpc('event_valuation_stats', { p_event_id: event.id })
  const statsMap: Record<string, { total_equity_sold_pct: number; total_capital_raised: number; implied_valuation: number | null; investor_count: number }> = {}
  for (const row of (statsRows ?? [])) {
    statsMap[row.investment_case_id] = row
  }

  const liveMap: Record<string, InvestmentCaseLive> = {}
  for (const ic of (cases ?? [])) {
    const s = statsMap[ic.id]
    liveMap[ic.id] = {
      investment_case_id: ic.id,
      event_id: event.id,
      equity_offered_pct: ic.equity_offered_pct,
      ask_amount: ic.ask_amount,
      bidding_status: ic.bidding_status,
      countdown_ends_at: ic.countdown_ends_at,
      pitch_order: ic.pitch_order,
      total_equity_sold_pct: s?.total_equity_sold_pct ?? 0,
      total_capital_raised: s?.total_capital_raised ?? 0,
      implied_valuation: s?.implied_valuation ?? null,
      active_bid_count: s?.investor_count ?? 0,
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
