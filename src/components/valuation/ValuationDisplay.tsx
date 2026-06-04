'use client'

import { useEffect, useRef, useState } from 'react'
import { formatValuation } from '@/lib/valuation/calculator'

interface ValuationDisplayProps {
  value: number | null
  large?: boolean
  label?: string
}

export function ValuationDisplay({ value, large, label = 'Implied Valuation' }: ValuationDisplayProps) {
  const [animating, setAnimating] = useState(false)
  const prevRef = useRef<number | null>(null)

  useEffect(() => {
    if (value !== prevRef.current && prevRef.current !== undefined) {
      setAnimating(true)
      const id = setTimeout(() => setAnimating(false), 600)
      return () => clearTimeout(id)
    }
    prevRef.current = value
  }, [value])

  const formatted = formatValuation(value)

  if (large) {
    return (
      <div className="flex flex-col items-center gap-1">
        <p className="text-xs uppercase tracking-widest text-white/50">{label}</p>
        <p className={`font-black tabular-nums transition-all duration-300
          ${large ? 'text-6xl md:text-7xl' : 'text-3xl'}
          ${animating ? 'text-blue-400 scale-105' : 'text-white'}
        `}>
          {formatted}
        </p>
      </div>
    )
  }

  return (
    <div className="flex flex-col">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`font-bold tabular-nums transition-all duration-300 text-2xl
        ${animating ? 'text-blue-400' : 'text-foreground'}
      `}>
        {formatted}
      </p>
    </div>
  )
}
