import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import Link from 'next/link'
import { Sidebar } from '@/components/layout/Sidebar'

export default async function DashboardPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  // Get all events this user is enrolled in
  const { data: roles } = await supabase
    .from('event_roles')
    .select('role, event_id, events(id, slug, name, event_date, status)')
    .eq('user_id', user.id)
    .order('joined_at', { ascending: false })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const events = (roles as any[] ?? [])
    .map((r: { role: string; event_id: string; events: { id: string; slug: string; name: string; event_date: string; status: string } }) => ({
      role: r.role,
      event: Array.isArray(r.events) ? r.events[0] ?? null : r.events,
    }))
    .filter((r: { role: string; event: { id: string; slug: string; name: string; event_date: string; status: string } | null }) => r.event)

  // Check super admin
  const { data: superAdmin } = await supabase
    .from('super_admins')
    .select('user_id')
    .eq('user_id', user.id)
    .single()

  return (
    <div className="flex flex-col md:flex-row min-h-screen">
      <Sidebar role={superAdmin ? 'super_admin' : null} />
      <main className="flex-1 p-6 md:p-8 space-y-8">
        <div>
          <h1 className="text-3xl font-black text-white">Dashboard</h1>
          <p className="text-white/50 mt-1">Welcome back, {user.email}</p>
        </div>

        {superAdmin && (
          <div className="rounded-xl border border-blue-500/30 bg-blue-500/10 p-4">
            <p className="text-blue-400 font-semibold text-sm">Super Admin</p>
            <p className="text-white/60 text-sm mt-0.5">You have platform-wide access.</p>
            <Link href="/admin" className="text-blue-400 text-sm underline mt-2 inline-block">
              Open Admin Panel →
            </Link>
          </div>
        )}

        <section className="space-y-4">
          <h2 className="text-lg font-bold text-white">Your Events</h2>

          {events.length === 0 ? (
            <div className="rounded-xl border border-white/10 bg-white/5 p-12 text-center text-white/40">
              <p className="text-4xl mb-3">🎤</p>
              <p className="font-medium">No events yet</p>
              <p className="text-sm mt-1">You&apos;ll be added to events by an Event Admin via the registration link.</p>
            </div>
          ) : (
            <div className="grid sm:grid-cols-2 gap-4">
              {events.map(({ role, event }: { role: string; event: { id: string; slug: string; name: string; event_date: string; status: string } | null }) => {
                if (!event) return null
                const href = role === 'event_admin' || role === 'super_admin'
                  ? `/events/${event.slug}/manage`
                  : role === 'host'
                  ? `/events/${event.slug}/host`
                  : role === 'startup'
                  ? `/events/${event.slug}/startup`
                  : `/events/${event.slug}`

                return (
                  <Link
                    key={event.id}
                    href={href}
                    className="group rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 hover:border-blue-500/30 p-5 transition-all space-y-3"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <h3 className="font-bold text-white group-hover:text-blue-300 transition-colors">
                        {event.name}
                      </h3>
                      <span className="text-xs px-2 py-0.5 rounded-full bg-white/10 text-white/50 shrink-0 capitalize">
                        {role.replace('_', ' ')}
                      </span>
                    </div>
                    <div className="flex items-center gap-4 text-sm text-white/40">
                      <span>{new Date(event.event_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</span>
                      <span className="capitalize">{event.status.replace('_', ' ')}</span>
                    </div>
                  </Link>
                )
              })}
            </div>
          )}
        </section>
      </main>
    </div>
  )
}
