'use client'

import { useEffect, useState, useMemo, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { Bid, BiddingStatus } from '@/types/database'

interface ValuationStats {
  total_equity_sold_pct: number
  total_capital_raised: number
  implied_valuation: number | null
  investor_count: number
}

export function useInvestmentCaseLive(caseId: string | undefined) {
  const [bids, setBids] = useState<Bid[]>([])
  const [phase, setPhase] = useState<BiddingStatus>('pending')
  const [countdownEndsAt, setCountdownEndsAt] = useState<Date | null>(null)
  const [equityOffered, setEquityOffered] = useState(0)
  const [stats, setStats] = useState<ValuationStats | null>(null)
  const [loading, setLoading] = useState(true)
  const supabase = createClient()

  // Case-level totals come from a SECURITY DEFINER RPC, not from
  // summing the locally visible `bids` rows — per-row visibility
  // is intentionally restricted for some roles (see migration
  // 0005), but the aggregate totals must stay accurate for everyone.
  const fetchStats = useCallback(async () => {
    if (!caseId) return
    const { data } = await supabase.rpc('case_valuation_stats', { p_case_id: caseId }).single()
    if (data) setStats(data as ValuationStats)
  }, [caseId])

  const fetchInitial = useCallback(async () => {
    if (!caseId) return
    const [{ data: ic }, { data: bidsData }] = await Promise.all([
      supabase.from('investment_cases').select('*').eq('id', caseId).single(),
      supabase.from('bids').select('*').eq('investment_case_id', caseId),
    ])
    if (ic) {
      setPhase(ic.bidding_status)
      setEquityOffered(ic.equity_offered_pct)
      if (ic.countdown_ends_at) setCountdownEndsAt(new Date(ic.countdown_ends_at))
    }
    setBids(bidsData ?? [])
    await fetchStats()
    setLoading(false)
  }, [caseId, fetchStats])

  useEffect(() => {
    fetchInitial()
    if (!caseId) return

    const channel = supabase
      .channel(`case:${caseId}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'bids',
        filter: `investment_case_id=eq.${caseId}`,
      }, (payload) => {
        setBids(prev => {
          const next = [...prev]
          if (payload.eventType === 'INSERT') {
            next.push(payload.new as Bid)
          } else if (payload.eventType === 'UPDATE') {
            const idx = next.findIndex(b => b.id === (payload.new as Bid).id)
            if (idx >= 0) next[idx] = payload.new as Bid
            else next.push(payload.new as Bid)
          } else if (payload.eventType === 'DELETE') {
            return next.filter(b => b.id !== (payload.old as Bid).id)
          }
          return next
        })
        fetchStats()
      })
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'investment_cases',
        filter: `id=eq.${caseId}`,
      }, (payload) => {
        const ic = payload.new as { bidding_status: BiddingStatus; countdown_ends_at: string | null; equity_offered_pct: number }
        setPhase(ic.bidding_status)
        setEquityOffered(ic.equity_offered_pct)
        if (ic.countdown_ends_at) setCountdownEndsAt(new Date(ic.countdown_ends_at))
        else setCountdownEndsAt(null)
      })
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [caseId, fetchInitial, fetchStats])

  const activeBids = useMemo(() => bids.filter(b => b.status === 'active'), [bids])
  const finalizedBids = useMemo(() => bids.filter(b => b.status === 'finalized'), [bids])
  const displayBids = phase === 'closed' ? finalizedBids : activeBids

  const totalEquitySold = stats?.total_equity_sold_pct ?? 0
  const totalCapital = stats?.total_capital_raised ?? 0
  const impliedValuation = stats?.implied_valuation ?? null

  return {
    bids: displayBids,
    allBids: bids,
    phase,
    countdownEndsAt,
    equityOffered,
    totalEquitySold,
    totalCapital,
    impliedValuation,
    loading,
    refresh: fetchInitial,
  }
}
