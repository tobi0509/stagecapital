'use client'

import { use, useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Sidebar } from '@/components/layout/Sidebar'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { toast } from 'sonner'
import { PhaseIndicator } from '@/components/bidding/PhaseIndicator'
import { formatAmount } from '@/lib/valuation/calculator'
import type { InvestmentCase, StartupProfile, UserRole, Event } from '@/types/database'

export default function ManageStartupsPage({
  params,
}: {
  params: Promise<{ eventSlug: string }>
}) {
  const { eventSlug } = use(params)
  const supabase = createClient()

  const [event, setEvent] = useState<Event | null>(null)
  const [cases, setCases] = useState<(InvestmentCase & { startup_profiles: StartupProfile | null })[]>([])
  const [myRole, setMyRole] = useState<UserRole | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [loading, setLoading] = useState(false)

  const [form, setForm] = useState({
    title: '',
    equity_offered_pct: '20',
    ask_amount: '500000',
  })

  useEffect(() => {
    async function init() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return

      const { data: ev } = await supabase.from('events').select('*').eq('slug', eventSlug).single()
      if (!ev) return
      setEvent(ev)

      const { data: role } = await supabase
        .from('event_roles').select('role').eq('event_id', ev.id).eq('user_id', user.id).single()
      setMyRole(role?.role as UserRole)

      await load(ev.id)
    }

    async function load(eventId: string) {
      const { data } = await supabase
        .from('investment_cases')
        .select('*, startup_profiles(*)')
        .eq('event_id', eventId)
        .order('pitch_order')
      setCases(data ?? [])
    }

    init()
  }, [eventSlug])

  async function createCase() {
    if (!event) return
    setLoading(true)
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return

    const nextOrder = cases.length

    const { data, error } = await supabase
      .from('investment_cases')
      .insert({
        event_id: event.id,
        startup_user_id: user.id, // placeholder — admin will assign startup user
        title: form.title,
        equity_offered_pct: parseFloat(form.equity_offered_pct),
        ask_amount: parseFloat(form.ask_amount),
        pitch_order: nextOrder,
      })
      .select('*, startup_profiles(*)')
      .single()

    if (error) {
      toast.error('Failed to create case', { description: error.message })
    } else {
      setCases(prev => [...prev, data])
      setForm({ title: '', equity_offered_pct: '20', ask_amount: '500000' })
      setShowForm(false)
      toast.success('Investment case created')
    }
    setLoading(false)
  }

  return (
    <div className="flex flex-col md:flex-row min-h-screen">
      <Sidebar eventSlug={eventSlug} role={myRole} />
      <main className="flex-1 p-6 md:p-8 space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-blue-400 text-sm font-medium uppercase tracking-wider">Investment Cases</p>
            <h1 className="text-3xl font-black text-white mt-1">Startup Pitches</h1>
          </div>
          <Button
            onClick={() => setShowForm(!showForm)}
            className="bg-blue-500 hover:bg-blue-600 text-white"
          >
            + Add Case
          </Button>
        </div>

        {showForm && (
          <div className="rounded-xl border border-blue-500/30 bg-blue-500/10 p-5 space-y-4">
            <h3 className="font-bold text-white">New Investment Case</h3>
            <div className="grid sm:grid-cols-3 gap-4">
              <div className="space-y-1.5">
                <Label className="text-white/70">Case Title</Label>
                <Input
                  value={form.title}
                  onChange={e => setForm(p => ({ ...p, title: e.target.value }))}
                  placeholder="e.g. GreenTech AI"
                  className="bg-white/10 border-white/20 text-white"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-white/70">Equity Offered (%)</Label>
                <Input
                  type="number"
                  value={form.equity_offered_pct}
                  onChange={e => setForm(p => ({ ...p, equity_offered_pct: e.target.value }))}
                  min="1" max="100"
                  className="bg-white/10 border-white/20 text-white"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-white/70">Ask Amount ($)</Label>
                <Input
                  type="number"
                  value={form.ask_amount}
                  onChange={e => setForm(p => ({ ...p, ask_amount: e.target.value }))}
                  className="bg-white/10 border-white/20 text-white"
                />
              </div>
            </div>
            <div className="flex gap-2">
              <Button onClick={createCase} disabled={loading || !form.title} className="bg-blue-500 hover:bg-blue-600 text-white">
                {loading ? 'Creating…' : 'Create Case'}
              </Button>
              <Button variant="outline" onClick={() => setShowForm(false)} className="border-white/20 text-white/70">
                Cancel
              </Button>
            </div>
          </div>
        )}

        <div className="space-y-3">
          {cases.map((ic, i) => (
            <div key={ic.id} className="rounded-xl border border-white/10 bg-white/5 p-4 flex items-center gap-4 flex-wrap">
              <span className="text-white/30 font-black text-lg w-6">{i + 1}</span>
              <div className="flex-1 min-w-0">
                <p className="font-bold text-white">{ic.startup_profiles?.company_name || ic.title}</p>
                <p className="text-xs text-white/40 mt-0.5">
                  {ic.equity_offered_pct}% equity · Ask {formatAmount(ic.ask_amount)}
                </p>
              </div>
              <PhaseIndicator status={ic.bidding_status} />
            </div>
          ))}
          {cases.length === 0 && (
            <div className="text-center py-16 text-white/40">
              No investment cases yet. Click "+ Add Case" to create one.
            </div>
          )}
        </div>
      </main>
    </div>
  )
}
