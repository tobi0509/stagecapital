'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { createClient } from '@/lib/supabase/client'

export function JoinEventButton({ eventId }: { eventId: string }) {
  const [loading, setLoading] = useState(false)
  const router = useRouter()
  const supabase = createClient()

  async function join() {
    setLoading(true)
    const { data, error } = await supabase.rpc('join_event_as_attendee', { p_event_id: eventId })
    setLoading(false)

    if (error || !data?.success) {
      toast.error('Could not join event', { description: error?.message ?? data?.error })
      return
    }

    toast.success("You're in! Welcome as an Attendee.")
    router.refresh()
  }

  return (
    <Button onClick={join} disabled={loading} className="bg-blue-500 hover:bg-blue-600 text-white font-semibold">
      {loading ? 'Joining…' : 'Join This Event'}
    </Button>
  )
}
