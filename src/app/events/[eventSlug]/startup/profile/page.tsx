'use client'

import { use, useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Sidebar } from '@/components/layout/Sidebar'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { toast } from 'sonner'
import { formatAmount } from '@/lib/valuation/calculator'
import type { StartupProfile, InvestmentCase, UserRole } from '@/types/database'

export default function StartupProfilePage({
  params,
}: {
  params: Promise<{ eventSlug: string }>
}) {
  const { eventSlug } = use(params)
  const supabase = createClient()

  const [ic, setIc] = useState<InvestmentCase | null>(null)
  const [myRole, setMyRole] = useState<UserRole | null>(null)
  const [locked, setLocked] = useState(false)
  const [loading, setLoading] = useState(false)
  const [form, setForm] = useState<Partial<StartupProfile>>({})
  const [profileId, setProfileId] = useState<string | null>(null)
  const [valuation, setValuation] = useState('')
  const [equityPct, setEquityPct] = useState('')
  const [savingAsk, setSavingAsk] = useState(false)

  useEffect(() => {
    async function init() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return

      const { data: ev } = await supabase.from('events').select('*').eq('slug', eventSlug).single()
      if (!ev) return

      const { data: role } = await supabase
        .from('event_roles').select('role').eq('event_id', ev.id).eq('user_id', user.id).single()
      setMyRole(role?.role as UserRole)

      const { data: investCase } = await supabase
        .from('investment_cases')
        .select('*')
        .eq('event_id', ev.id)
        .eq('startup_user_id', user.id)
        .single()

      if (!investCase) return
      setIc(investCase)
      setLocked(!!investCase.data_locked_at)
      setEquityPct(String(investCase.equity_offered_pct))
      setValuation(String(Math.round(investCase.ask_amount / (investCase.equity_offered_pct / 100))))

      const { data: sp } = await supabase
        .from('startup_profiles')
        .select('*')
        .eq('investment_case_id', investCase.id)
        .single()

      if (sp) {
        setProfileId(sp.id)
        setForm(sp)
      }
    }
    init()
  }, [eventSlug])

  async function save() {
    if (!ic) return
    setLoading(true)

    if (profileId) {
      const { error } = await supabase
        .from('startup_profiles')
        .update(form)
        .eq('id', profileId)
      if (error) toast.error('Failed to save', { description: error.message })
      else toast.success('Profile saved!')
    } else {
      const { data, error } = await supabase
        .from('startup_profiles')
        .insert({ ...form, investment_case_id: ic.id })
        .select()
        .single()
      if (error) toast.error('Failed to save', { description: error.message })
      else { setProfileId(data.id); toast.success('Profile created!') }
    }
    setLoading(false)
  }

  async function saveAsk() {
    if (!ic) return
    const v = parseFloat(valuation)
    const pct = parseFloat(equityPct)
    if (!(v > 0) || !(pct > 0)) {
      toast.error('Enter a valid valuation and equity percentage')
      return
    }

    setSavingAsk(true)
    const { data, error } = await supabase.rpc('set_startup_ask', {
      p_investment_case_id: ic.id,
      p_valuation: v,
      p_equity_pct: pct,
    })
    setSavingAsk(false)

    if (error || !data?.success) {
      toast.error('Failed to save ask', { description: error?.message ?? data?.error })
      return
    }

    setIc(prev => (prev ? { ...prev, equity_offered_pct: pct, ask_amount: data.ask_amount } : prev))
    toast.success('Ask updated!')
  }

  const f = (key: keyof StartupProfile) => ({
    value: (form[key] as string) ?? '',
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setForm(p => ({ ...p, [key]: e.target.value })),
    disabled: locked,
  })

  return (
    <div className="flex min-h-screen">
      <Sidebar eventSlug={eventSlug} role={myRole} />
      <main className="flex-1 p-6 md:p-8 space-y-6 max-w-2xl">
        <div>
          <p className="text-blue-400 text-sm font-medium uppercase tracking-wider">Startup Profile</p>
          <h1 className="text-3xl font-black text-white mt-1">Edit Your Profile</h1>
          {locked && (
            <p className="text-amber-400 text-sm mt-1 font-semibold">
              🔒 Data locked — pitches have begun
            </p>
          )}
        </div>

        {ic && (
          <div className="space-y-4 rounded-xl border border-blue-500/30 bg-blue-500/10 p-5">
            <div>
              <h3 className="font-bold text-white">Your Ask</h3>
              <p className="text-white/50 text-xs mt-0.5">
                How much your company is worth, and how much of it you&apos;re offering to investors.
              </p>
            </div>

            {ic.bidding_status !== 'pending' ? (
              <p className="text-amber-400 text-sm font-semibold">
                🔒 Bidding has started — your ask of {formatAmount(ic.ask_amount)} for {ic.equity_offered_pct}% is locked
              </p>
            ) : (
              <>
                <div className="grid sm:grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <Label className="text-white/70">Company Valuation ($)</Label>
                    <Input
                      type="number"
                      value={valuation}
                      onChange={e => setValuation(e.target.value)}
                      placeholder="1000000"
                      className="bg-white/10 border-white/20 text-white"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-white/70">Equity Offered (%)</Label>
                    <Input
                      type="number"
                      value={equityPct}
                      onChange={e => setEquityPct(e.target.value)}
                      min="1" max="100"
                      className="bg-white/10 border-white/20 text-white"
                    />
                  </div>
                </div>
                {parseFloat(valuation) > 0 && parseFloat(equityPct) > 0 && (
                  <p className="text-white/60 text-sm">
                    You&apos;re offering <span className="text-white font-semibold">{formatAmount(parseFloat(valuation) * parseFloat(equityPct) / 100)}</span> worth of equity ({equityPct}% of {formatAmount(parseFloat(valuation))}).
                  </p>
                )}
                <Button
                  onClick={saveAsk}
                  disabled={savingAsk}
                  className="bg-blue-500 hover:bg-blue-600 text-white font-semibold"
                >
                  {savingAsk ? 'Saving…' : 'Save Ask'}
                </Button>
              </>
            )}
          </div>
        )}

        <div className="space-y-4 rounded-xl border border-white/10 bg-white/5 p-5">
          <div className="grid sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label className="text-white/70">Company Name *</Label>
              <Input {...f('company_name')} placeholder="Acme Corp" className="bg-white/10 border-white/20 text-white" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-white/70">Contact Email</Label>
              <Input {...f('contact_email')} type="email" placeholder="hello@acme.com" className="bg-white/10 border-white/20 text-white" />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="text-white/70">One-Liner</Label>
            <Input {...f('one_liner')} placeholder="We are X for Y" className="bg-white/10 border-white/20 text-white" />
          </div>

          <div className="space-y-1.5">
            <Label className="text-white/70">Problem Statement</Label>
            <Textarea {...f('problem_statement')} placeholder="Describe the problem you solve…" rows={3} className="bg-white/10 border-white/20 text-white resize-none" />
          </div>

          <div className="space-y-1.5">
            <Label className="text-white/70">Solution</Label>
            <Textarea {...f('solution')} placeholder="How does your product solve it?" rows={3} className="bg-white/10 border-white/20 text-white resize-none" />
          </div>

          <div className="grid sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label className="text-white/70">Website URL</Label>
              <Input {...f('website_url')} type="url" placeholder="https://acme.com" className="bg-white/10 border-white/20 text-white" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-white/70">Industry</Label>
              <Input {...f('industry')} placeholder="FinTech, HealthTech…" className="bg-white/10 border-white/20 text-white" />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="text-white/70">Traction</Label>
            <Textarea {...f('traction')} placeholder="Key metrics, revenue, users, partnerships…" rows={2} className="bg-white/10 border-white/20 text-white resize-none" />
          </div>

          {!locked && (
            <Button
              onClick={save}
              disabled={loading}
              className="w-full bg-blue-500 hover:bg-blue-600 text-white font-semibold"
            >
              {loading ? 'Saving…' : 'Save Profile'}
            </Button>
          )}
        </div>
      </main>
    </div>
  )
}
