import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { Sidebar } from '@/components/layout/Sidebar'
import { PhaseIndicator } from '@/components/bidding/PhaseIndicator'
import { ValuationDisplay } from '@/components/valuation/ValuationDisplay'
import { EquityCapBar } from '@/components/valuation/EquityCapBar'
import { formatAmount } from '@/lib/valuation/calculator'
import type { UserRole, Bid } from '@/types/database'

export const revalidate = 5

export default async function StartupDashboardPage({
  params,
}: {
  params: Promise<{ eventSlug: string }>
}) {
  const { eventSlug } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: event } = await supabase
    .from('events').select('*').eq('slug', eventSlug).single()
  if (!event) redirect('/dashboard')

  const { data: roleData } = await supabase
    .from('event_roles').select('role').eq('event_id', event.id).eq('user_id', user.id).single()
  const myRole = roleData?.role as UserRole | null

  const { data: ic } = await supabase
    .from('investment_cases')
    .select('*, startup_profiles(*)')
    .eq('event_id', event.id)
    .eq('startup_user_id', user.id)
    .single()

  if (!ic) {
    return (
      <div className="flex flex-col md:flex-row min-h-screen">
        <Sidebar eventSlug={eventSlug} role={myRole} />
        <main className="flex-1 flex items-center justify-center text-white/40 text-center p-8">
          <div>
            <p className="text-4xl mb-3">🚀</p>
            <p className="font-medium">No investment case assigned to you</p>
            <p className="text-sm mt-1">Contact your Event Admin.</p>
          </div>
        </main>
      </div>
    )
  }

  const { data: bids } = await supabase
    .from('bids')
    .select('*, profiles!investor_user_id(display_name, email)')
    .eq('investment_case_id', ic.id)
    .in('status', ['active', 'finalized'])
    .order('price_per_pct', { ascending: false })

  const totalCapital = (bids ?? []).reduce((s: number, b: Bid) => s + b.amount, 0)
  const totalEquity = (bids ?? []).reduce((s: number, b: Bid) => s + b.equity_pct, 0)
  const impliedVal = totalEquity > 0 ? totalCapital / (totalEquity / 100) : null

  // All investors at this event (startup can see everyone)
  const { data: allInvestors } = await supabase
    .from('event_roles')
    .select('profiles(display_name, email), role')
    .eq('event_id', event.id)
    .in('role', ['investor', 'attendee'])

  return (
    <div className="flex flex-col md:flex-row min-h-screen">
      <Sidebar eventSlug={eventSlug} role={myRole} />
      <main className="flex-1 p-6 md:p-8 space-y-6 max-w-3xl">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <p className="text-blue-400 text-sm font-medium uppercase tracking-wider">Your Dashboard</p>
            <h1 className="text-3xl font-black text-white mt-1">
              {ic.startup_profiles?.company_name || ic.title}
            </h1>
          </div>
          <div className="flex items-center gap-3">
            <PhaseIndicator status={ic.bidding_status} />
            <Link
              href={`/events/${eventSlug}/startup/profile`}
              className="px-3 py-1.5 rounded-lg border border-white/20 hover:bg-white/10 text-white/70 text-sm transition-colors"
            >
              Edit Profile
            </Link>
          </div>
        </div>

        {/* Live stats */}
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          <div className="rounded-xl border border-white/10 bg-white/5 p-4">
            <ValuationDisplay value={impliedVal} />
          </div>
          <div className="rounded-xl border border-white/10 bg-white/5 p-4">
            <p className="text-xs text-muted-foreground">Capital Raised</p>
            <p className="text-2xl font-bold text-white mt-1">{formatAmount(totalCapital)}</p>
          </div>
          <div className="rounded-xl border border-white/10 bg-white/5 p-4">
            <p className="text-xs text-muted-foreground">Investors</p>
            <p className="text-2xl font-bold text-white mt-1">{(bids ?? []).length}</p>
          </div>
        </div>

        <EquityCapBar sold={totalEquity} total={ic.equity_offered_pct} />

        {/* Current bids */}
        {(bids ?? []).length > 0 && (
          <div className="space-y-2">
            <h3 className="text-sm font-semibold text-white/60 uppercase tracking-wider">Investors in Your Case</h3>
            <div className="rounded-xl border border-white/10 overflow-hidden">
              {(bids as (Bid & { profiles: { display_name: string; email: string } | null })[]).map((bid, i) => (
                <div key={bid.id} className={`flex items-center gap-3 px-4 py-3 text-sm ${i > 0 ? 'border-t border-white/5' : ''}`}>
                  <span className="text-white/30 w-5">{i + 1}</span>
                  <div className="flex-1">
                    <p className="text-white font-medium">{bid.profiles?.display_name || 'Anonymous'}</p>
                    {ic.bidding_status === 'closed' && (
                      <p className="text-white/40 text-xs">{bid.profiles?.email}</p>
                    )}
                  </div>
                  <span className="text-white/60">{bid.equity_pct}%</span>
                  <span className="text-white font-semibold">{formatAmount(bid.amount)}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* All event investors */}
        <div className="space-y-2">
          <h3 className="text-sm font-semibold text-white/60 uppercase tracking-wider">
            All Investors at Event ({(allInvestors ?? []).length})
          </h3>
          <div className="rounded-xl border border-white/10 overflow-hidden">
            {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
            {(allInvestors ?? []).slice(0, 20).map((r: any, i) => (
              <div key={i} className={`flex items-center gap-3 px-4 py-2.5 text-sm ${i > 0 ? 'border-t border-white/5' : ''}`}>
                <div className="w-7 h-7 rounded-full bg-white/10 flex items-center justify-center text-xs font-bold text-white">
                  {r.profiles?.display_name?.[0] ?? '?'}
                </div>
                <div className="flex-1">
                  <p className="text-white/80">{r.profiles?.display_name || 'Unknown'}</p>
                </div>
                <span className="text-xs text-white/30 capitalize">{r.role}</span>
              </div>
            ))}
          </div>
        </div>
      </main>
    </div>
  )
}
