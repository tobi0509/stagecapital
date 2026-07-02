import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { Sidebar } from '@/components/layout/Sidebar'
import { formatAmount } from '@/lib/valuation/calculator'
import type { UserRole } from '@/types/database'

interface HistoryRow {
  id: string
  event_type: string
  equity_pct: number
  amount: number
  price_per_pct: number
  phase: string
  recorded_at: string
  investor: { display_name: string } | { display_name: string }[] | null
  investment_cases: { title: string; startup_profiles: { company_name: string } | { company_name: string }[] | null } | { title: string; startup_profiles: { company_name: string } | { company_name: string }[] | null }[] | null
}

const EVENT_LABELS: Record<string, { label: string; color: string }> = {
  placed:     { label: 'Placed',     color: 'text-blue-400 bg-blue-500/10' },
  updated:    { label: 'Updated',    color: 'text-white/60 bg-white/5' },
  displaced:  { label: 'Displaced',  color: 'text-red-400 bg-red-500/10' },
  withdrawn:  { label: 'Withdrawn',  color: 'text-amber-400 bg-amber-500/10' },
  finalized:  { label: 'Finalized',  color: 'text-green-400 bg-green-500/10' },
}

// Supabase embeds a to-one relation as an object normally, but as an
// array when the FK is ambiguous or ordering is applied — normalize
// both shapes so rendering below doesn't have to care which came back.
function one<T>(v: T | T[] | null): T | null {
  return Array.isArray(v) ? v[0] ?? null : v
}

export default async function BidHistoryPage({
  params,
}: {
  params: Promise<{ eventSlug: string }>
}) {
  const { eventSlug } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: event } = await supabase.from('events').select('*').eq('slug', eventSlug).single()
  if (!event) redirect('/dashboard')

  const { data: roleData } = await supabase
    .from('event_roles').select('role').eq('event_id', event.id).eq('user_id', user.id).single()
  const myRole = roleData?.role as UserRole | null

  if (!['event_admin', 'host', 'super_admin'].includes(myRole ?? '')) {
    redirect(`/events/${eventSlug}`)
  }

  const { data: caseIds } = await supabase
    .from('investment_cases')
    .select('id')
    .eq('event_id', event.id)

  const { data: history } = await supabase
    .from('bid_history')
    .select(`
      id, event_type, equity_pct, amount, price_per_pct, phase, recorded_at,
      investor:profiles!investor_user_id(display_name),
      investment_cases(title, startup_profiles(company_name))
    `)
    .in('investment_case_id', (caseIds ?? []).map(c => c.id))
    .order('recorded_at', { ascending: false })
    .limit(200)

  const rows = (history ?? []) as unknown as HistoryRow[]

  return (
    <div className="flex flex-col md:flex-row min-h-screen">
      <Sidebar eventSlug={eventSlug} role={myRole} />
      <main className="flex-1 p-6 md:p-8 space-y-6">
        <div>
          <p className="text-blue-400 text-sm font-medium uppercase tracking-wider">Audit Log</p>
          <h1 className="text-3xl font-black text-white mt-1">Bid History</h1>
          <p className="text-white/50 text-sm mt-1">
            Every bid placed, displaced, withdrawn, or finalized across this event — most recent first.
          </p>
        </div>

        <div className="rounded-xl border border-white/10 overflow-hidden overflow-x-auto">
          <table className="w-full text-sm min-w-[640px]">
            <thead>
              <tr className="border-b border-white/10 text-left text-white/40 text-xs uppercase tracking-wider">
                <th className="px-4 py-3 font-medium">Time</th>
                <th className="px-4 py-3 font-medium">Startup</th>
                <th className="px-4 py-3 font-medium">Investor</th>
                <th className="px-4 py-3 font-medium">Event</th>
                <th className="px-4 py-3 font-medium text-right">Equity</th>
                <th className="px-4 py-3 font-medium text-right">Amount</th>
                <th className="px-4 py-3 font-medium text-right">$/pt</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(row => {
                const ic = one(row.investment_cases)
                const sp = ic ? one(ic.startup_profiles) : null
                const investor = one(row.investor)
                const badge = EVENT_LABELS[row.event_type] ?? { label: row.event_type, color: 'text-white/50 bg-white/5' }
                return (
                  <tr key={row.id} className="border-b border-white/5 last:border-0">
                    <td className="px-4 py-3 text-white/40 text-xs whitespace-nowrap tabular-nums">
                      {new Date(row.recorded_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                    </td>
                    <td className="px-4 py-3 text-white">{sp?.company_name || ic?.title || '—'}</td>
                    <td className="px-4 py-3 text-white/70">{investor?.display_name || 'Unknown'}</td>
                    <td className="px-4 py-3">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${badge.color}`}>{badge.label}</span>
                    </td>
                    <td className="px-4 py-3 text-right text-white/70 tabular-nums">{row.equity_pct}%</td>
                    <td className="px-4 py-3 text-right text-white font-medium tabular-nums">{formatAmount(row.amount)}</td>
                    <td className="px-4 py-3 text-right text-white/50 tabular-nums">{formatAmount(row.price_per_pct)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          {rows.length === 0 && (
            <div className="text-center py-16 text-white/40 text-sm">No bidding activity yet</div>
          )}
        </div>
      </main>
    </div>
  )
}
