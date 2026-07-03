import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import Link from 'next/link'
import { Sidebar } from '@/components/layout/Sidebar'
import { PhaseIndicator } from '@/components/bidding/PhaseIndicator'
import { formatValuation } from '@/lib/valuation/calculator'
import type { InvestmentCase, StartupProfile, UserRole } from '@/types/database'

export default async function EventPage({
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
    .order('pitch_order', { ascending: true })

  // Case-level totals come from a SECURITY DEFINER RPC, not from summing raw
  // bid rows — per-row bid visibility is intentionally restricted for some
  // roles (see migration 0005), but this overview must stay accurate for
  // every viewer (investor and attendee alike).
  const { data: statsRows } = await supabase.rpc('event_valuation_stats', { p_event_id: event.id })
  const caseValuations: Record<string, { capitalRaised: number; equitySold: number; impliedVal: number | null }> = {}
  for (const row of (statsRows ?? [])) {
    caseValuations[row.investment_case_id] = {
      capitalRaised: row.total_capital_raised,
      equitySold: row.total_equity_sold_pct,
      impliedVal: row.implied_valuation,
    }
  }

  return (
    <div className="flex min-h-screen">
      <Sidebar eventSlug={eventSlug} role={myRole} />
      <main className="flex-1 p-6 md:p-8 space-y-8">
        <div>
          <p className="text-blue-400 text-sm font-medium uppercase tracking-wider">{event.status.replace('_', ' ')}</p>
          <h1 className="text-3xl font-black text-white mt-1">{event.name}</h1>
          <p className="text-white/50 text-sm mt-1">
            {new Date(event.event_date).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {(cases ?? []).map((ic: InvestmentCase & { startup_profiles: StartupProfile | null }) => {
            const sp = ic.startup_profiles
            const lv = caseValuations[ic.id]
            const href = `/events/${eventSlug}/invest/${ic.id}`

            return (
              <Link
                key={ic.id}
                href={href}
                className="group rounded-xl border border-white/10 bg-white/5 hover:border-blue-500/30 hover:bg-white/8 transition-all p-5 space-y-4"
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="font-bold text-white group-hover:text-blue-300 transition-colors">
                      {sp?.company_name || ic.title || 'Unnamed Startup'}
                    </p>
                    {sp?.one_liner && (
                      <p className="text-xs text-white/50 mt-0.5 line-clamp-2">{sp.one_liner}</p>
                    )}
                  </div>
                  <PhaseIndicator status={ic.bidding_status} />
                </div>

                <div className="grid grid-cols-3 gap-3 text-sm">
                  <div>
                    <p className="text-white/40 text-xs">Asking</p>
                    <p className="font-semibold text-white/70">
                      {ic.equity_offered_pct > 0 ? formatValuation(ic.ask_amount / (ic.equity_offered_pct / 100)) : '—'}
                    </p>
                  </div>
                  <div>
                    <p className="text-white/40 text-xs">Current</p>
                    <p className="font-semibold text-white">
                      {lv?.impliedVal ? formatValuation(lv.impliedVal) : '—'}
                    </p>
                  </div>
                  <div>
                    <p className="text-white/40 text-xs">Equity Offered</p>
                    <p className="font-semibold text-white">{ic.equity_offered_pct}%</p>
                  </div>
                </div>
              </Link>
            )
          })}
        </div>

        {(cases ?? []).length === 0 && (
          <div className="text-center py-20 text-white/40">
            <p className="text-4xl mb-3">🚀</p>
            <p>No investment cases yet. Check back soon.</p>
          </div>
        )}
      </main>
    </div>
  )
}
