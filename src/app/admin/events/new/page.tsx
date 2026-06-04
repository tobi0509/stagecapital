'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Sidebar } from '@/components/layout/Sidebar'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { toast } from 'sonner'

export default function NewEventPage() {
  const router = useRouter()
  const supabase = createClient()
  const [loading, setLoading] = useState(false)
  const [form, setForm] = useState({
    name: '',
    slug: '',
    description: '',
    event_date: '',
    default_budget: '50000',
    investor_budget: '150000',
  })

  const f = (key: keyof typeof form) => ({
    value: form[key],
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      const val = e.target.value
      setForm(p => {
        const next = { ...p, [key]: val }
        // Auto-generate slug from name
        if (key === 'name') {
          next.slug = val.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
        }
        return next
      })
    },
  })

  async function create(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)

    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { setLoading(false); return }

    const { data, error } = await supabase
      .from('events')
      .insert({
        ...form,
        default_budget: parseFloat(form.default_budget),
        investor_budget: parseFloat(form.investor_budget),
        created_by: user.id,
      })
      .select()
      .single()

    if (error) {
      toast.error('Failed to create event', { description: error.message })
    } else {
      // Add creator as event_admin
      await supabase.from('event_roles').insert({
        event_id: data.id,
        user_id: user.id,
        role: 'event_admin',
      })
      toast.success('Event created!')
      router.push(`/events/${data.slug}/manage`)
    }
    setLoading(false)
  }

  return (
    <div className="flex min-h-screen">
      <Sidebar role="super_admin" />
      <main className="flex-1 p-6 md:p-8 max-w-2xl space-y-6">
        <div>
          <p className="text-blue-400 text-sm font-medium uppercase tracking-wider">Super Admin</p>
          <h1 className="text-3xl font-black text-white mt-1">Create Event</h1>
        </div>

        <form onSubmit={create} className="rounded-xl border border-white/10 bg-white/5 p-6 space-y-4">
          <div className="space-y-1.5">
            <Label className="text-white/70">Event Name *</Label>
            <Input {...f('name')} placeholder="YALL Pitch Night 2026" required className="bg-white/10 border-white/20 text-white" />
          </div>

          <div className="space-y-1.5">
            <Label className="text-white/70">URL Slug *</Label>
            <Input {...f('slug')} placeholder="yall-pitch-night-2026" required className="bg-white/10 border-white/20 text-white font-mono" />
            <p className="text-xs text-white/30">Used in the event URL: /events/{form.slug || 'slug'}</p>
          </div>

          <div className="space-y-1.5">
            <Label className="text-white/70">Description</Label>
            <Textarea {...f('description')} placeholder="What happens at this event?" rows={3} className="bg-white/10 border-white/20 text-white resize-none" />
          </div>

          <div className="space-y-1.5">
            <Label className="text-white/70">Event Date *</Label>
            <Input {...f('event_date')} type="date" required className="bg-white/10 border-white/20 text-white" />
          </div>

          <div className="grid sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label className="text-white/70">Attendee Budget ($)</Label>
              <Input {...f('default_budget')} type="number" min="1000" className="bg-white/10 border-white/20 text-white" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-white/70">Investor Budget ($)</Label>
              <Input {...f('investor_budget')} type="number" min="1000" className="bg-white/10 border-white/20 text-white" />
            </div>
          </div>

          <Button
            type="submit"
            disabled={loading}
            className="w-full bg-blue-500 hover:bg-blue-600 text-white font-semibold"
          >
            {loading ? 'Creating…' : 'Create Event'}
          </Button>
        </form>
      </main>
    </div>
  )
}
