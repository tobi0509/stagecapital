'use client'

import { use, useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Sidebar } from '@/components/layout/Sidebar'
import { PhaseIndicator } from '@/components/bidding/PhaseIndicator'
import { CountdownTimer } from '@/components/countdown/CountdownTimer'
import { ValuationDisplay } from '@/components/valuation/ValuationDisplay'
import { formatAmount } from '@/lib/valuation/calculator'
import { toast } from 'sonner'
import type { InvestmentCase, StartupProfile, Event, UserRole } from '@/types/database'

export default function HostPage({
  params,
}: {
  params: Promise<{ eventSlug: string }>
}) {
  const { eventSlug } = use(params)
  const supabase = createClient()

  const [event, setEvent] = useState<Event | null>(null)
  const [cases, setCases] = useState<(InvestmentCase & { startup_profiles: StartupProfile | null })[]>([])
  const [myRole, setMyRole] = useState<UserRole | null>(null)
  const [actionLoading, setActionLoading] = useState<string | null>(null)

  useEffect(() => {
    async function init() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return

      const { data: ev } = await supabase.from('events').select('*').eq('slug', eventSlug).single()
      if (!ev) return
      setEvent(ev)

      const { data: role } = await supabase
        .from('event_roles')
        .select('role')
        .eq('event_id', ev.id)
        .eq('user_id', user.id)
        .single()
      setMyRole(role?.role as UserRole)

      await loadCases(ev.id)
    }

    async function loadCases(eventId: string) {
      const { data } = await supabase
        .from('investment_cases')
        .select('*, startup_profiles(*)')
        .eq('event_id', eventId)
        .order('pitch_order')
      setCases(data ?? [])
    }

    init()

    // Subscribe to investment_cases changes
    const channel = supabase
      .channel(`host:${eventSlug}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'investment_cases' }, () => {
        if (event?.id) loadCases(event.id)
      })
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [eventSlug])

  async function openBidding(caseId: string) {
    setActionLoading(caseId + ':open')
    const res = await fetch('/api/bidding/open', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ caseId }),
    })
    const data = await res.json()
    if (data.success) {
      toast.success('Bidding opened!')
      setCases(prev => prev.map(c => c.id === caseId ? { ...c, bidding_status: 'additive' } : c))
    } else {
      toast.error('Failed', { description: data.error })
    }
    setActionLoading(null)
  }

  async function startCountdown(caseId: string) {
    setActionLoading(caseId + ':countdown')
    const res = await fetch('/api/countdown/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ caseId }),
    })
    const data = await res.json()
    if (data.success) {
      toast.success('60-second countdown started!')
      setCases(prev => prev.map(c =>
        c.id === caseId
          ? { ...c, bidding_status: 'countdown', countdown_ends_at: data.countdown_ends_at }
          : c
      ))
    } else {
      toast.error('Failed', { description: data.error })
    }
    setActionLoading(null)
  }

  async function closeBidding(caseId: string) {
    setActionLoading(caseId + ':close')
    const res = await fetch(`/api/events/${eventSlug}/close`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ caseId }),
    })
    const data = await res.json()
    if (data.success) {
      toast.success('Bidding closed!')
      setCases(prev => prev.map(c => c.id === caseId ? { ...c, bidding_status: 'closed' } : c))
    } else {
      toast.error('Failed', { description: data.error })
    }
    setActionLoading(null)
  }

  if (!['host', 'event_admin', 'super_admin'].includes(myRole ?? '')) {
    return (
      <div className="flex flex-col md:flex-row min-h-screen">
        <Sidebar eventSlug={eventSlug} role={myRole} />
        <main className="flex-1 flex items-center justify-center text-white/40">
          Host access required
        </main>
      </div>
    )
  }

  return (
    <div className="flex flex-col md:flex-row min-h-screen">
      <Sidebar eventSlug={eventSlug} role={myRole} />
      <main className="flex-1 p-6 md:p-8 space-y-6">
        <div>
          <p className="text-blue-400 text-sm font-medium uppercase tracking-wider">Host Panel</p>
          <h1 className="text-3xl font-black text-white mt-1">{event?.name}</h1>
          <p className="text-white/50 text-sm mt-1">Control bidding for each investment case</p>
        </div>

        <div className="space-y-4">
          {cases.map((ic, i) => {
            const sp = ic.startup_profiles
            const isLoading = actionLoading?.startsWith(ic.id)

            return (
              <div
                key={ic.id}
                className="rounded-xl border border-white/10 bg-white/5 p-5 space-y-4"
              >
                <div className="flex items-center gap-4 flex-wrap">
                  <span className="text-white/30 font-black text-lg w-6">{i + 1}</span>
                  <div className="flex-1">
                    <p className="font-bold text-white">{sp?.company_name || ic.title}</p>
                    <p className="text-xs text-white/40 mt-0.5">{ic.equity_offered_pct}% equity · Ask: {formatAmount(ic.ask_amount)}</p>
                  </div>
                  <PhaseIndicator status={ic.bidding_status} />
                </div>

                {ic.bidding_status === 'countdown' && ic.countdown_ends_at && (
                  <CountdownTimer
                    endsAt={new Date(ic.countdown_ends_at)}
                    onExpired={() => closeBidding(ic.id)}
                  />
                )}

                <div className="flex flex-wrap gap-2">
                  {ic.bidding_status === 'pending' && (
                    <button
                      onClick={() => openBidding(ic.id)}
                      disabled={isLoading}
                      className="px-4 py-2 rounded-lg bg-green-500 hover:bg-green-600 text-white text-sm font-semibold transition-colors disabled:opacity-50"
                    >
                      {isLoading ? 'Opening…' : '▶ Open Bidding'}
                    </button>
                  )}

                  {(ic.bidding_status === 'additive' || ic.bidding_status === 'competitive') && (
                    <button
                      onClick={() => startCountdown(ic.id)}
                      disabled={isLoading}
                      className="px-4 py-2 rounded-lg bg-amber-500 hover:bg-amber-600 text-white text-sm font-semibold transition-colors disabled:opacity-50"
                    >
                      {isLoading ? 'Starting…' : '⏱ Start 60s Countdown'}
                    </button>
                  )}

                  {(ic.bidding_status === 'additive' || ic.bidding_status === 'competitive' || ic.bidding_status === 'countdown') && (
                    <button
                      onClick={() => closeBidding(ic.id)}
                      disabled={isLoading}
                      className="px-4 py-2 rounded-lg bg-red-500/80 hover:bg-red-500 text-white text-sm font-semibold transition-colors disabled:opacity-50"
                    >
                      {isLoading ? 'Closing…' : '■ Close Now'}
                    </button>
                  )}

                  <a
                    href={`/events/${eventSlug}/pitch/${ic.id}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="px-4 py-2 rounded-lg border border-white/20 hover:bg-white/10 text-white/70 text-sm font-semibold transition-colors"
                  >
                    📺 Big Screen
                  </a>
                </div>
              </div>
            )
          })}
        </div>

        {cases.length === 0 && (
          <div className="text-center py-20 text-white/40">
            No investment cases configured yet.
          </div>
        )}
      </main>
    </div>
  )
}
