'use client'

import { use, useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Sidebar } from '@/components/layout/Sidebar'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { toast } from 'sonner'
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
  const [uploadingLogo, setUploadingLogo] = useState(false)
  const [uploadingDeck, setUploadingDeck] = useState(false)

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

  async function ensureProfile(): Promise<string | null> {
    if (profileId) return profileId
    if (!ic) return null
    const { data, error } = await supabase
      .from('startup_profiles')
      .insert({ ...form, investment_case_id: ic.id })
      .select()
      .single()
    if (error) { toast.error('Failed to create profile', { description: error.message }); return null }
    setProfileId(data.id)
    return data.id
  }

  async function uploadAsset(file: File, kind: 'logo' | 'pitch-deck') {
    if (!ic) return
    if (kind === 'logo' && !file.type.startsWith('image/')) {
      toast.error('Logo must be an image file'); return
    }
    if (kind === 'logo' && file.size > 5 * 1024 * 1024) {
      toast.error('Logo must be under 5MB'); return
    }
    if (kind === 'pitch-deck' && file.type !== 'application/pdf') {
      toast.error('Pitch deck must be a PDF'); return
    }
    if (kind === 'pitch-deck' && file.size > 25 * 1024 * 1024) {
      toast.error('Pitch deck must be under 25MB'); return
    }

    const setUploading = kind === 'logo' ? setUploadingLogo : setUploadingDeck
    setUploading(true)

    const id = await ensureProfile()
    if (!id) { setUploading(false); return }

    const ext = file.name.split('.').pop()
    const path = `${ic.id}/${kind}.${ext}`
    const { error: upErr } = await supabase.storage
      .from('startup-assets')
      .upload(path, file, { upsert: true, cacheControl: '3600' })

    if (upErr) {
      toast.error('Upload failed', { description: upErr.message })
      setUploading(false)
      return
    }

    const { data: pub } = supabase.storage.from('startup-assets').getPublicUrl(path)
    const column = kind === 'logo' ? 'logo_url' : 'pitch_deck_url'
    const url = `${pub.publicUrl}?v=${Date.now()}`

    const { error: dbErr } = await supabase.from('startup_profiles').update({ [column]: url }).eq('id', id)
    if (dbErr) {
      toast.error('Upload saved, but failed to link it', { description: dbErr.message })
    } else {
      setForm(p => ({ ...p, [column]: url }))
      toast.success(kind === 'logo' ? 'Logo uploaded!' : 'Pitch deck uploaded!')
    }
    setUploading(false)
  }

  const f = (key: keyof StartupProfile) => ({
    value: (form[key] as string) ?? '',
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setForm(p => ({ ...p, [key]: e.target.value })),
    disabled: locked,
  })

  return (
    <div className="flex flex-col md:flex-row min-h-screen">
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

          <div className="grid sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label className="text-white/70">Logo</Label>
              <div className="flex items-center gap-3">
                {form.logo_url && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={form.logo_url} alt="Logo preview" className="w-10 h-10 rounded-lg object-cover border border-white/20" />
                )}
                <label className={`flex-1 text-sm text-center px-3 py-2 rounded-lg border border-white/20 bg-white/10 text-white/80 cursor-pointer hover:bg-white/15 transition-colors ${locked || uploadingLogo ? 'opacity-50 pointer-events-none' : ''}`}>
                  {uploadingLogo ? 'Uploading…' : form.logo_url ? 'Replace logo' : 'Upload logo'}
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    disabled={locked || uploadingLogo}
                    onChange={e => { const file = e.target.files?.[0]; if (file) uploadAsset(file, 'logo'); e.target.value = '' }}
                  />
                </label>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-white/70">Pitch Deck (PDF)</Label>
              <div className="flex items-center gap-3">
                {form.pitch_deck_url && (
                  <a href={form.pitch_deck_url} target="_blank" rel="noreferrer" className="text-xs text-blue-400 underline shrink-0">View current</a>
                )}
                <label className={`flex-1 text-sm text-center px-3 py-2 rounded-lg border border-white/20 bg-white/10 text-white/80 cursor-pointer hover:bg-white/15 transition-colors ${locked || uploadingDeck ? 'opacity-50 pointer-events-none' : ''}`}>
                  {uploadingDeck ? 'Uploading…' : form.pitch_deck_url ? 'Replace deck' : 'Upload deck'}
                  <input
                    type="file"
                    accept="application/pdf"
                    className="hidden"
                    disabled={locked || uploadingDeck}
                    onChange={e => { const file = e.target.files?.[0]; if (file) uploadAsset(file, 'pitch-deck'); e.target.value = '' }}
                  />
                </label>
              </div>
            </div>
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
