'use client'

import { useEffect, useState } from 'react'
import QRCode from 'qrcode'
import { toast } from 'sonner'

export function RegistrationLinkCard({ eventSlug }: { eventSlug: string }) {
  const [url, setUrl] = useState('')
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null)

  useEffect(() => {
    const link = `${window.location.origin}/events/${eventSlug}`
    setUrl(link)
    QRCode.toDataURL(link, { margin: 1, width: 160, color: { dark: '#FFFFFF', light: '#00000000' } })
      .then(setQrDataUrl)
      .catch(() => setQrDataUrl(null))
  }, [eventSlug])

  async function copyLink() {
    await navigator.clipboard.writeText(url)
    toast.success('Link copied!')
  }

  return (
    <div className="rounded-xl border border-white/10 bg-white/5 p-4">
      <p className="text-xs text-white/40 uppercase tracking-wider mb-1">Self-Registration Link</p>
      <div className="flex items-start gap-4 flex-wrap">
        {qrDataUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={qrDataUrl} alt="QR code for event registration link" className="w-24 h-24 rounded-lg border border-white/10 bg-white/5 shrink-0" />
        )}
        <div className="flex-1 min-w-[200px] space-y-2">
          <p className="text-blue-400 font-mono text-sm break-all">{url}</p>
          <p className="text-xs text-white/30">
            Anyone who signs in and opens this link can join as an Attendee while registration is open — scan the QR code at the door or share the link directly.
          </p>
          <button
            onClick={copyLink}
            className="text-xs px-3 py-1.5 rounded-lg border border-white/20 hover:bg-white/10 text-white/70 transition-colors"
          >
            Copy Link
          </button>
        </div>
      </div>
    </div>
  )
}
