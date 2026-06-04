'use client'

import { createContext, useContext, useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { Event, EventRole, UserRole } from '@/types/database'

interface EventContextValue {
  event: Event | null
  myRole: UserRole | null
  myBudget: number | null
  loading: boolean
}

const EventContext = createContext<EventContextValue>({
  event: null,
  myRole: null,
  myBudget: null,
  loading: true,
})

export function EventProvider({
  children,
  eventSlug,
}: {
  children: React.ReactNode
  eventSlug: string
}) {
  const [event, setEvent] = useState<Event | null>(null)
  const [myRole, setMyRole] = useState<UserRole | null>(null)
  const [myBudget, setMyBudget] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const supabase = createClient()

  useEffect(() => {
    async function load() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { setLoading(false); return }

      const { data: ev } = await supabase
        .from('events')
        .select('*')
        .eq('slug', eventSlug)
        .single()

      if (!ev) { setLoading(false); return }
      setEvent(ev)

      const { data: role } = await supabase
        .from('event_roles')
        .select('role, total_budget')
        .eq('event_id', ev.id)
        .eq('user_id', user.id)
        .single()

      if (role) {
        setMyRole(role.role as UserRole)
        const budget = role.total_budget ??
          (role.role === 'investor' ? ev.investor_budget : ev.default_budget)
        setMyBudget(budget)
      }
      setLoading(false)
    }
    load()
  }, [eventSlug])

  return (
    <EventContext.Provider value={{ event, myRole, myBudget, loading }}>
      {children}
    </EventContext.Provider>
  )
}

export const useEventContext = () => useContext(EventContext)
