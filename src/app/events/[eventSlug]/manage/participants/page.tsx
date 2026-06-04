'use client'

import { use, useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Sidebar } from '@/components/layout/Sidebar'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { toast } from 'sonner'
import type { Event, UserRole } from '@/types/database'

const ROLES: UserRole[] = ['event_admin', 'host', 'startup', 'investor', 'attendee']

interface Participant {
  id: string
  role: string
  total_budget: number | null
  profiles: { display_name: string; email: string } | null
}

export default function ManageParticipantsPage({
  params,
}: {
  params: Promise<{ eventSlug: string }>
}) {
  const { eventSlug } = use(params)
  const supabase = createClient()

  const [event, setEvent] = useState<Event | null>(null)
  const [myRole, setMyRole] = useState<UserRole | null>(null)
  const [participants, setParticipants] = useState<Participant[]>([])
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteRole, setInviteRole] = useState<UserRole>('attendee')
  const [loading, setLoading] = useState(false)

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

      await loadParticipants(ev.id)
    }

    async function loadParticipants(eventId: string) {
      const { data } = await supabase
        .from('event_roles')
        .select('id, role, total_budget, profiles(display_name, email)')
        .eq('event_id', eventId)
        .order('joined_at', { ascending: false })
      // Normalize Supabase join: profiles comes back as array but is a single object
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const normalized = (data ?? []).map((r: any) => ({
        ...r,
        profiles: Array.isArray(r.profiles) ? r.profiles[0] ?? null : r.profiles,
      })) as Participant[]
      setParticipants(normalized)
    }

    init()
  }, [eventSlug])

  async function invite() {
    if (!event || !inviteEmail.trim()) return
    setLoading(true)

    // Find user by email
    const res = await fetch('/api/admin/invite', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: inviteEmail, role: inviteRole, eventId: event.id }),
    })
    const data = await res.json()

    if (data.success) {
      toast.success(`${inviteRole} role assigned to ${inviteEmail}`)
      setInviteEmail('')
      // Reload
      const { data: updated } = await supabase
        .from('event_roles')
        .select('id, role, total_budget, profiles(display_name, email)')
        .eq('event_id', event.id)
        .order('joined_at', { ascending: false })
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const norm = (updated ?? []).map((r: any) => ({ ...r, profiles: Array.isArray(r.profiles) ? r.profiles[0] ?? null : r.profiles })) as Participant[]
      setParticipants(norm)
    } else {
      toast.error('Failed', { description: data.error })
    }
    setLoading(false)
  }

  const ROLE_COLORS: Record<string, string> = {
    event_admin: 'text-purple-400 bg-purple-500/10',
    host: 'text-blue-400 bg-blue-500/10',
    startup: 'text-green-400 bg-green-500/10',
    investor: 'text-amber-400 bg-amber-500/10',
    attendee: 'text-white/60 bg-white/5',
  }

  return (
    <div className="flex min-h-screen">
      <Sidebar eventSlug={eventSlug} role={myRole} />
      <main className="flex-1 p-6 md:p-8 space-y-6">
        <div>
          <p className="text-blue-400 text-sm font-medium uppercase tracking-wider">Participants</p>
          <h1 className="text-3xl font-black text-white mt-1">Manage Roles</h1>
          <p className="text-white/50 text-sm mt-1">{participants.length} participants</p>
        </div>

        {/* Invite form */}
        <div className="rounded-xl border border-white/10 bg-white/5 p-5 space-y-4">
          <h3 className="font-bold text-white">Assign Role by Email</h3>
          <div className="grid sm:grid-cols-3 gap-3">
            <div className="space-y-1.5 sm:col-span-2">
              <Label className="text-white/70">Email Address</Label>
              <Input
                type="email"
                value={inviteEmail}
                onChange={e => setInviteEmail(e.target.value)}
                placeholder="user@example.com"
                className="bg-white/10 border-white/20 text-white"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-white/70">Role</Label>
              <Select value={inviteRole} onValueChange={v => setInviteRole(v as UserRole)}>
                <SelectTrigger className="bg-white/10 border-white/20 text-white">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ROLES.map(r => (
                    <SelectItem key={r} value={r}>{r.replace('_', ' ')}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <Button
            onClick={invite}
            disabled={loading || !inviteEmail.trim()}
            className="bg-blue-500 hover:bg-blue-600 text-white"
          >
            {loading ? 'Assigning…' : 'Assign Role'}
          </Button>
        </div>

        {/* Registration link */}
        <div className="rounded-xl border border-white/10 bg-white/5 p-4">
          <p className="text-xs text-white/40 uppercase tracking-wider mb-1">Self-Registration Link</p>
          <p className="text-blue-400 font-mono text-sm break-all">
            {typeof window !== 'undefined' ? `${window.location.origin}/events/${eventSlug}` : ''}
          </p>
          <p className="text-xs text-white/30 mt-1">Share this link — users who register via it get Attendee role by default.</p>
        </div>

        {/* Participants list */}
        <div className="rounded-xl border border-white/10 overflow-hidden">
          {participants.map((p, i) => (
            <div key={p.id} className={`flex items-center gap-3 px-4 py-3 ${i > 0 ? 'border-t border-white/5' : ''}`}>
              <div className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center text-sm font-bold text-white shrink-0">
                {p.profiles?.display_name?.[0] ?? '?'}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-white text-sm font-medium">{p.profiles?.display_name || 'Unknown'}</p>
                <p className="text-white/40 text-xs">{p.profiles?.email}</p>
              </div>
              <span className={`text-xs px-2 py-0.5 rounded-full capitalize font-medium ${ROLE_COLORS[p.role] ?? 'text-white/50 bg-white/5'}`}>
                {p.role.replace('_', ' ')}
              </span>
            </div>
          ))}
          {participants.length === 0 && (
            <div className="text-center py-12 text-white/40 text-sm">No participants yet</div>
          )}
        </div>
      </main>
    </div>
  )
}
