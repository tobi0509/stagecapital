'use client'

import { use, useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Sidebar } from '@/components/layout/Sidebar'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { toast } from 'sonner'
import { PhaseIndicator } from '@/components/bidding/PhaseIndicator'
import { formatAmount } from '@/lib/valuation/calculator'
import type { InvestmentCase, StartupProfile, UserRole, Event } from '@/types/database'

interface StartupCandidate {
  userId: string
  displayName: string
  email: string
}

const UNIQUE_VIOLATION = '23505'

export default function ManageStartupsPage({
  params,
}: {
  params: Promise<{ eventSlug: string }>
}) {
  const { eventSlug } = use(params)
  const supabase = createClient()

  const [event, setEvent] = useState<Event | null>(null)
  const [cases, setCases] = useState<(InvestmentCase & { startup_profiles: StartupProfile | null })[]>([])
  const [startupUsers, setStartupUsers] = useState<StartupCandidate[]>([])
  const [myRole, setMyRole] = useState<UserRole | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [loading, setLoading] = useState(false)
  const [reassigning, setReassigning] = useState<string | null>(null)
  const [editingAskId, setEditingAskId] = useState<string | null>(null)
  const [askEdit, setAskEdit] = useState({ valuation: '', equity_offered_pct: '' })
  const [savingAsk, setSavingAsk] = useState(false)

  const isAdmin = myRole === 'event_admin' || myRole === 'super_admin'

  const [form, setForm] = useState({
    title: '',
    startup_user_id: '',
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

      await Promise.all([load(ev.id), loadStartupUsers(ev.id)])
    }

    async function load(eventId: string) {
      const { data } = await supabase
        .from('investment_cases')
        .select('*, startup_profiles(*)')
        .eq('event_id', eventId)
        .order('pitch_order')
      setCases(data ?? [])
    }

    async function loadStartupUsers(eventId: string) {
      const { data } = await supabase
        .from('event_roles')
        .select('user_id, profiles(display_name, email)')
        .eq('event_id', eventId)
        .eq('role', 'startup')
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const normalized = (data ?? []).map((r: any) => {
        const profile = Array.isArray(r.profiles) ? r.profiles[0] ?? null : r.profiles
        return { userId: r.user_id, displayName: profile?.display_name || 'Unknown', email: profile?.email || '' }
      })
      setStartupUsers(normalized)
    }

    init()
  }, [eventSlug])

  // Startup-role users who don't already own a case in this event (UNIQUE(event_id, startup_user_id))
  const assignedIds = new Set(cases.map(c => c.startup_user_id))
  const eligibleForNewCase = startupUsers.filter(u => !assignedIds.has(u.userId))

  function eligibleForReassign(currentCaseId: string) {
    return startupUsers.filter(u => {
      const owningCase = cases.find(c => c.startup_user_id === u.userId)
      return !owningCase || owningCase.id === currentCaseId
    })
  }

  async function createCase() {
    if (!event || !form.startup_user_id) return
    setLoading(true)

    const nextOrder = cases.length

    const { data, error } = await supabase
      .from('investment_cases')
      .insert({
        event_id: event.id,
        startup_user_id: form.startup_user_id,
        title: form.title,
        pitch_order: nextOrder,
      })
      .select('*, startup_profiles(*)')
      .single()

    if (error) {
      if (error.code === UNIQUE_VIOLATION) {
        toast.error('This user already owns another case in this event')
      } else {
        toast.error('Failed to create case', { description: error.message })
      }
    } else {
      setCases(prev => [...prev, data])
      setForm({ title: '', startup_user_id: '' })
      setShowForm(false)
      toast.success('Investment case created')
    }
    setLoading(false)
  }

  async function reassign(caseId: string, newStartupUserId: string) {
    setReassigning(caseId)
    const { data, error } = await supabase
      .from('investment_cases')
      .update({ startup_user_id: newStartupUserId })
      .eq('id', caseId)
      .select('*, startup_profiles(*)')
      .single()

    if (error) {
      if (error.code === UNIQUE_VIOLATION) {
        toast.error('This user already owns another case in this event')
      } else {
        toast.error('Failed to reassign', { description: error.message })
      }
    } else {
      setCases(prev => prev.map(c => (c.id === caseId ? data : c)))
      toast.success('Startup reassigned')
    }
    setReassigning(null)
  }

  function startEditAsk(ic: InvestmentCase) {
    setEditingAskId(ic.id)
    setAskEdit({
      valuation: String(Math.round(ic.ask_amount / (ic.equity_offered_pct / 100))),
      equity_offered_pct: String(ic.equity_offered_pct),
    })
  }

  async function saveAskEdit(caseId: string) {
    const valuation = parseFloat(askEdit.valuation)
    const pct = parseFloat(askEdit.equity_offered_pct)
    if (!(valuation > 0) || !(pct > 0 && pct <= 100)) {
      toast.error('Enter a valid valuation and equity percentage')
      return
    }

    setSavingAsk(true)
    const { data, error } = await supabase
      .from('investment_cases')
      .update({ equity_offered_pct: pct, ask_amount: Math.round(valuation * pct / 100 * 100) / 100 })
      .eq('id', caseId)
      .select('*, startup_profiles(*)')
      .single()
    setSavingAsk(false)

    if (error) {
      toast.error('Failed to update ask', { description: error.message })
    } else {
      setCases(prev => prev.map(c => (c.id === caseId ? data : c)))
      setEditingAskId(null)
      toast.success('Ask updated')
    }
  }

  return (
    <div className="flex min-h-screen">
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
            <p className="text-xs text-white/40">
              The startup sets their own valuation and equity offered from their profile page — just create a slot and assign it to them here.
            </p>
            <div className="grid sm:grid-cols-2 gap-4">
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
                <Label className="text-white/70">Startup</Label>
                <Select value={form.startup_user_id} onValueChange={v => { if (v) setForm(p => ({ ...p, startup_user_id: v })) }}>
                  <SelectTrigger className="bg-white/10 border-white/20 text-white">
                    <SelectValue placeholder={eligibleForNewCase.length ? 'Select a startup' : 'No eligible startups'} />
                  </SelectTrigger>
                  <SelectContent>
                    {eligibleForNewCase.map(u => (
                      <SelectItem key={u.userId} value={u.userId}>{u.displayName} ({u.email})</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {startupUsers.length === 0 && (
                  <p className="text-xs text-amber-400 mt-1">No one has the Startup role yet — assign it first in Participants.</p>
                )}
              </div>
            </div>
            <div className="flex gap-2">
              <Button onClick={createCase} disabled={loading || !form.title || !form.startup_user_id} className="bg-blue-500 hover:bg-blue-600 text-white">
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
            <div key={ic.id} className="rounded-xl border border-white/10 bg-white/5 p-4 space-y-3">
              <div className="flex items-center gap-4 flex-wrap">
                <span className="text-white/30 font-black text-lg w-6">{i + 1}</span>
                <div className="flex-1 min-w-0">
                  <p className="font-bold text-white">{ic.startup_profiles?.company_name || ic.title}</p>
                  <p className="text-xs text-white/40 mt-0.5">
                    {ic.equity_offered_pct}% equity · Ask {formatAmount(ic.ask_amount)}
                    {ic.data_locked_at && <span className="text-amber-400 ml-1.5">🔒 locked for startup</span>}
                  </p>
                </div>
                {ic.bidding_status === 'pending' && (
                  <Select
                    value={ic.startup_user_id}
                    onValueChange={v => { if (v) reassign(ic.id, v) }}
                    disabled={reassigning === ic.id}
                  >
                    <SelectTrigger className="bg-white/10 border-white/20 text-white text-xs w-44">
                      <SelectValue placeholder="Assign startup" />
                    </SelectTrigger>
                    <SelectContent>
                      {eligibleForReassign(ic.id).map(u => (
                        <SelectItem key={u.userId} value={u.userId}>{u.displayName}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
                {isAdmin && editingAskId !== ic.id && (
                  <Button
                    variant="outline"
                    onClick={() => startEditAsk(ic)}
                    className="border-white/20 text-white/70 text-xs h-8"
                  >
                    Edit Ask
                  </Button>
                )}
                <PhaseIndicator status={ic.bidding_status} />
              </div>

              {editingAskId === ic.id && (
                <div className="grid sm:grid-cols-3 gap-3 items-end rounded-lg bg-white/5 border border-white/10 p-3">
                  <div className="space-y-1">
                    <Label className="text-white/60 text-xs">Valuation ($)</Label>
                    <Input
                      type="number"
                      value={askEdit.valuation}
                      onChange={e => setAskEdit(p => ({ ...p, valuation: e.target.value }))}
                      className="bg-white/10 border-white/20 text-white h-8"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-white/60 text-xs">Equity Offered (%)</Label>
                    <Input
                      type="number"
                      value={askEdit.equity_offered_pct}
                      onChange={e => setAskEdit(p => ({ ...p, equity_offered_pct: e.target.value }))}
                      min="1" max="100"
                      className="bg-white/10 border-white/20 text-white h-8"
                    />
                  </div>
                  <div className="flex gap-2">
                    <Button onClick={() => saveAskEdit(ic.id)} disabled={savingAsk} className="bg-blue-500 hover:bg-blue-600 text-white h-8">
                      {savingAsk ? 'Saving…' : 'Save'}
                    </Button>
                    <Button variant="outline" onClick={() => setEditingAskId(null)} className="border-white/20 text-white/70 h-8">
                      Cancel
                    </Button>
                  </div>
                </div>
              )}
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
