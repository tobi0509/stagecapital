'use client'

import { useEffect, useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { formatAmount } from '@/lib/valuation/calculator'

export function useBudget(eventId: string | undefined, userId: string | undefined, totalBudget: number | null) {
  const [committed, setCommitted] = useState(0)
  const supabase = createClient()

  const fetchCommitted = useCallback(async () => {
    if (!eventId || !userId) return
    const { data } = await supabase
      .from('bids')
      .select('amount, investment_cases!inner(event_id)')
      .eq('investment_cases.event_id', eventId)
      .eq('investor_user_id', userId)
      .eq('status', 'active')

    const total = (data ?? []).reduce((sum: number, b: { amount: number }) => sum + b.amount, 0)
    setCommitted(total)
  }, [eventId, userId])

  useEffect(() => {
    fetchCommitted()

    if (!eventId || !userId) return
    const channel = supabase
      .channel(`budget:${userId}:${eventId}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'bids',
        filter: `investor_user_id=eq.${userId}`,
      }, () => fetchCommitted())
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [eventId, userId, fetchCommitted])

  const available = totalBudget !== null ? Math.max(0, totalBudget - committed) : null

  return {
    total: totalBudget,
    committed,
    available,
    totalFormatted: totalBudget !== null ? formatAmount(totalBudget) : '—',
    committedFormatted: formatAmount(committed),
    availableFormatted: available !== null ? formatAmount(available) : '—',
    refresh: fetchCommitted,
  }
}
