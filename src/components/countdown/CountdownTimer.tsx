'use client'

import { useEffect, useState } from 'react'

interface CountdownTimerProps {
  endsAt: Date | null
  onExpired?: () => void
  large?: boolean
}

export function CountdownTimer({ endsAt, onExpired, large }: CountdownTimerProps) {
  const [remaining, setRemaining] = useState<number | null>(null)

  useEffect(() => {
    if (!endsAt) { setRemaining(null); return }

    const tick = () => {
      const diff = Math.max(0, endsAt.getTime() - Date.now())
      setRemaining(diff)
      if (diff === 0) onExpired?.()
    }

    tick()
    const id = setInterval(tick, 250)
    return () => clearInterval(id)
  }, [endsAt, onExpired])

  if (remaining === null) return null

  const seconds = Math.ceil(remaining / 1000)
  const isUrgent = seconds <= 10

  if (large) {
    return (
      <div className={`flex flex-col items-center gap-2 ${isUrgent ? 'text-red-500' : 'text-blue-400'}`}>
        <span className="text-8xl font-black tabular-nums leading-none">
          {seconds}
        </span>
        <span className="text-sm uppercase tracking-widest opacity-70">seconds remaining</span>
      </div>
    )
  }

  return (
    <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-bold tabular-nums
      ${isUrgent
        ? 'bg-red-500/10 text-red-500 border border-red-500/30'
        : 'bg-blue-500/10 text-blue-400 border border-blue-500/30'
      }`}>
      <span className={`w-2 h-2 rounded-full ${isUrgent ? 'bg-red-500' : 'bg-blue-400'} animate-pulse`} />
      Closes in {seconds}s
    </div>
  )
}
