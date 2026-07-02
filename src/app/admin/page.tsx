import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { Sidebar } from '@/components/layout/Sidebar'
import type { Event } from '@/types/database'

export const revalidate = 10

export default async function AdminPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: superAdmin } = await supabase
    .from('super_admins')
    .select('user_id')
    .eq('user_id', user.id)
    .single()

  if (!superAdmin) redirect('/dashboard')

  const { data: events } = await supabase
    .from('events')
    .select('*')
    .order('created_at', { ascending: false })

  const STATUS_BADGE: Record<string, string> = {
    draft:             'bg-white/10 text-white/50',
    registration_open: 'bg-blue-500/20 text-blue-400',
    active:            'bg-green-500/20 text-green-400',
    closed:            'bg-white/5 text-white/30',
    results_published: 'bg-amber-500/20 text-amber-400',
  }

  return (
    <div className="flex flex-col md:flex-row min-h-screen">
      <Sidebar role="super_admin" />
      <main className="flex-1 p-6 md:p-8 space-y-8">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-blue-400 text-sm font-medium uppercase tracking-wider">Super Admin</p>
            <h1 className="text-3xl font-black text-white mt-1">All Events</h1>
          </div>
          <Link
            href="/admin/events/new"
            className="px-4 py-2 bg-blue-500 hover:bg-blue-600 text-white text-sm font-semibold rounded-xl transition-colors"
          >
            + New Event
          </Link>
        </div>

        <div className="space-y-3">
          {(events ?? []).map((ev: Event) => (
            <div key={ev.id} className="rounded-xl border border-white/10 bg-white/5 p-5 flex items-center gap-4 flex-wrap">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-3 flex-wrap">
                  <p className="font-bold text-white">{ev.name}</p>
                  <span className={`text-xs px-2 py-0.5 rounded-full capitalize font-medium ${STATUS_BADGE[ev.status] ?? ''}`}>
                    {ev.status.replace('_', ' ')}
                  </span>
                </div>
                <p className="text-white/40 text-xs mt-0.5">
                  {new Date(ev.event_date).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
                  {' · '}slug: {ev.slug}
                </p>
              </div>
              <Link
                href={`/events/${ev.slug}/manage`}
                className="px-3 py-1.5 rounded-lg border border-white/20 hover:bg-white/10 text-white/70 text-sm transition-colors"
              >
                Manage →
              </Link>
            </div>
          ))}

          {(events ?? []).length === 0 && (
            <div className="text-center py-20 text-white/40">
              No events yet. Create the first one.
            </div>
          )}
        </div>
      </main>
    </div>
  )
}
