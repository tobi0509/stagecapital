import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { Sidebar } from '@/components/layout/Sidebar'
import type { UserRole } from '@/types/database'

export default async function ManagePage({
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

  if (!['event_admin', 'super_admin'].includes(myRole ?? '')) {
    redirect(`/events/${eventSlug}`)
  }

  const [{ count: participantCount }, { count: caseCount }] = await Promise.all([
    supabase.from('event_roles').select('id', { count: 'exact', head: true }).eq('event_id', event.id),
    supabase.from('investment_cases').select('id', { count: 'exact', head: true }).eq('event_id', event.id),
  ])

  const STATUS_TRANSITIONS: Record<string, { label: string; next: string }> = {
    draft:             { label: 'Open Registration',  next: 'registration_open' },
    registration_open: { label: 'Activate Event',     next: 'active' },
    active:            { label: 'Close Event',        next: 'closed' },
    closed:            { label: 'Publish Results',    next: 'results_published' },
    results_published: { label: 'Done',               next: '' },
  }

  const transition = STATUS_TRANSITIONS[event.status]

  return (
    <div className="flex min-h-screen">
      <Sidebar eventSlug={eventSlug} role={myRole} />
      <main className="flex-1 p-6 md:p-8 space-y-8">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <p className="text-blue-400 text-sm font-medium uppercase tracking-wider">Admin Panel</p>
            <h1 className="text-3xl font-black text-white mt-1">{event.name}</h1>
            <p className="text-white/50 text-sm mt-1 capitalize">{event.status.replace('_', ' ')}</p>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: 'Participants', value: participantCount ?? 0 },
            { label: 'Investment Cases', value: caseCount ?? 0 },
            { label: 'Default Budget', value: `$${(event.default_budget / 1000).toFixed(0)}K` },
            { label: 'Investor Budget', value: `$${(event.investor_budget / 1000).toFixed(0)}K` },
          ].map(({ label, value }) => (
            <div key={label} className="rounded-xl border border-white/10 bg-white/5 p-4 text-center">
              <p className="text-2xl font-black text-white">{value}</p>
              <p className="text-xs text-white/40 uppercase tracking-wider mt-1">{label}</p>
            </div>
          ))}
        </div>

        {/* Quick links */}
        <div className="grid sm:grid-cols-3 gap-4">
          {[
            { href: `manage/participants`, icon: '👥', label: 'Manage Participants', desc: 'Invite users, assign roles, set budgets' },
            { href: `manage/startups`, icon: '🚀', label: 'Investment Cases', desc: 'Create and order startup pitches' },
            { href: `${eventSlug}/host`, icon: '🎤', label: 'Host Panel', desc: 'Open bidding and control live event' },
          ].map(({ href, icon, label, desc }) => (
            <Link
              key={href}
              href={href}
              className="rounded-xl border border-white/10 bg-white/5 hover:border-blue-500/30 hover:bg-white/8 p-5 transition-all space-y-2"
            >
              <div className="text-3xl">{icon}</div>
              <p className="font-bold text-white">{label}</p>
              <p className="text-xs text-white/50">{desc}</p>
            </Link>
          ))}
        </div>

        {/* Event settings */}
        <div className="rounded-xl border border-white/10 bg-white/5 p-5 space-y-4">
          <h3 className="font-bold text-white">Event Settings</h3>
          <div className="grid sm:grid-cols-2 gap-4 text-sm">
            <div>
              <p className="text-white/40">Date</p>
              <p className="text-white">{event.event_date}</p>
            </div>
            <div>
              <p className="text-white/40">Registration Link</p>
              <p className="text-blue-400 font-mono text-xs break-all">
                {typeof window !== 'undefined' ? window.location.origin : ''}/events/{eventSlug}
              </p>
            </div>
          </div>
        </div>
      </main>
    </div>
  )
}
