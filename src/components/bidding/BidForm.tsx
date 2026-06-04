'use client'

import { useState, useEffect } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { formatValuation, formatAmount } from '@/lib/valuation/calculator'
import type { BiddingStatus, Bid } from '@/types/database'

const EQUITY_STEPS = [2, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50]

interface BidFormProps {
  caseId: string
  phase: BiddingStatus
  equityOffered: number
  equityAvailable: number
  availableBudget: number | null
  existingBid: Bid | null
  onSuccess?: () => void
}

export function BidForm({
  caseId,
  phase,
  equityOffered,
  equityAvailable,
  availableBudget,
  existingBid,
  onSuccess,
}: BidFormProps) {
  const [equityPct, setEquityPct] = useState<number>(existingBid?.equity_pct ?? 10)
  const [amount, setAmount] = useState<string>(existingBid?.amount?.toString() ?? '')
  const [loading, setLoading] = useState(false)

  // Reset to existing bid values when they change
  useEffect(() => {
    if (existingBid) {
      setEquityPct(existingBid.equity_pct)
      setAmount(existingBid.amount.toString())
    }
  }, [existingBid?.id])

  const amountNum = parseFloat(amount) || 0
  const impliedVal = amountNum > 0 && equityPct > 0
    ? amountNum / (equityPct / 100)
    : null

  const isOpen = phase === 'additive' || phase === 'competitive'
  const isDisabled = !isOpen || loading

  // Validation
  const errors: string[] = []
  if (amountNum <= 0) errors.push('Enter a bid amount')
  if (availableBudget !== null && amountNum > availableBudget) {
    errors.push(`Exceeds available budget (${formatAmount(availableBudget)})`)
  }
  if (phase === 'additive' && equityPct > equityAvailable) {
    errors.push(`Only ${equityAvailable}% equity remaining`)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (errors.length > 0) return
    setLoading(true)

    try {
      const res = await fetch('/api/bids/place', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ caseId, equityPct, amount: amountNum }),
      })
      const data = await res.json()

      if (data.success) {
        toast.success(existingBid ? 'Bid updated!' : 'Bid placed!', {
          description: `${equityPct}% equity at ${formatAmount(amountNum)}`,
        })
        onSuccess?.()
      } else {
        toast.error('Bid failed', { description: data.error })
      }
    } catch {
      toast.error('Network error. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  if (!isOpen) {
    return (
      <div className="rounded-xl border border-white/10 bg-white/5 p-6 text-center text-white/50">
        {phase === 'pending' && 'Bidding not yet open'}
        {phase === 'countdown' && 'Bidding is closing…'}
        {phase === 'closed' && 'Bidding has closed'}
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5 rounded-xl border border-white/10 bg-white/5 p-5">
      <div className="space-y-2">
        <Label className="text-white/70">Equity Stake</Label>
        <div className="flex flex-wrap gap-2">
          {EQUITY_STEPS.map(step => {
            const unavailable = phase === 'additive' && step > equityAvailable && step !== equityPct
            return (
              <button
                key={step}
                type="button"
                disabled={unavailable}
                onClick={() => setEquityPct(step)}
                className={`px-3 py-1.5 rounded-lg text-sm font-semibold transition-all
                  ${equityPct === step
                    ? 'bg-blue-500 text-white'
                    : unavailable
                    ? 'bg-white/5 text-white/20 cursor-not-allowed'
                    : 'bg-white/10 text-white/70 hover:bg-white/20'
                  }`}
              >
                {step}%
              </button>
            )
          })}
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="amount" className="text-white/70">Your Price ($)</Label>
        <Input
          id="amount"
          type="number"
          min={1}
          step={1000}
          value={amount}
          onChange={e => setAmount(e.target.value)}
          placeholder="e.g. 50000"
          className="bg-white/10 border-white/20 text-white placeholder:text-white/30 focus:border-blue-500"
        />
      </div>

      {amountNum > 0 && (
        <div className="rounded-lg bg-blue-500/10 border border-blue-500/20 p-3 space-y-1">
          <div className="flex justify-between text-sm">
            <span className="text-white/60">Implied Valuation</span>
            <span className="font-bold text-blue-400">{formatValuation(impliedVal)}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-white/60">Price per %</span>
            <span className="text-white/80">{formatAmount(amountNum / equityPct)}</span>
          </div>
        </div>
      )}

      {errors.length > 0 && (
        <div className="text-sm text-red-400 space-y-0.5">
          {errors.map(e => <p key={e}>⚠ {e}</p>)}
        </div>
      )}

      <Button
        type="submit"
        disabled={isDisabled || errors.length > 0}
        className="w-full bg-blue-500 hover:bg-blue-600 text-white font-semibold"
      >
        {loading ? 'Placing…' : existingBid ? 'Update Bid' : `Bid ${equityPct}% for ${amount ? formatAmount(amountNum) : '…'}`}
      </Button>

      {existingBid && (
        <p className="text-xs text-center text-white/40">
          Your current bid: {existingBid.equity_pct}% for {formatAmount(existingBid.amount)}
        </p>
      )}
    </form>
  )
}
