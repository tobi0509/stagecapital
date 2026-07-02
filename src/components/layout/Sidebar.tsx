'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useState } from 'react'
import { BarChart3, Home, Settings, Users, Zap, Trophy, Mic, Building2, LogOut, Menu, X, ScrollText } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import type { UserRole } from '@/types/database'

interface SidebarProps {
  eventSlug?: string
  role?: UserRole | null
}

export function Sidebar({ eventSlug, role }: SidebarProps) {
  const pathname = usePathname()
  const supabase = createClient()
  const [mobileOpen, setMobileOpen] = useState(false)

  const links = getLinks(eventSlug, role)

  async function handleSignOut() {
    await supabase.auth.signOut()
    window.location.href = '/login'
  }

  const navLinks = (onNavigate?: () => void) => links.map(({ href, icon: Icon, label }) => {
    const active = pathname === href || pathname.startsWith(href + '/')
    return (
      <Link
        key={href}
        href={href}
        onClick={onNavigate}
        className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors
          ${active
            ? 'bg-blue-500/20 text-blue-300 font-medium'
            : 'text-white/50 hover:text-white hover:bg-white/5'
          }`}
      >
        <Icon className="w-4 h-4 shrink-0" />
        {label}
      </Link>
    )
  })

  return (
    <>
      {/* Desktop sidebar */}
      <aside className="w-56 shrink-0 border-r border-white/10 bg-black/40 hidden md:flex flex-col">
        <div className="p-5 border-b border-white/10">
          <Link href="/dashboard" className="font-black text-xl tracking-tight text-white">
            Stage<span className="text-blue-400">Capital</span>
          </Link>
        </div>

        <nav className="flex-1 p-3 space-y-0.5">{navLinks()}</nav>

        <div className="p-3 border-t border-white/10">
          <button
            onClick={handleSignOut}
            className="flex items-center gap-3 px-3 py-2 rounded-lg text-sm w-full text-left text-white/50 hover:text-white hover:bg-white/5 transition-colors"
          >
            <LogOut className="w-4 h-4 shrink-0" />
            Sign Out
          </button>
        </div>
      </aside>

      {/* Mobile top bar */}
      <div className="md:hidden sticky top-0 z-40 flex items-center justify-between px-4 h-14 border-b border-white/10 bg-black/90 backdrop-blur">
        <Link href="/dashboard" className="font-black text-lg tracking-tight text-white">
          Stage<span className="text-blue-400">Capital</span>
        </Link>
        <button
          onClick={() => setMobileOpen(v => !v)}
          aria-label={mobileOpen ? 'Close menu' : 'Open menu'}
          className="p-2 -mr-2 text-white/70 hover:text-white"
        >
          {mobileOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
        </button>
      </div>

      {mobileOpen && (
        <div className="md:hidden fixed inset-x-0 top-14 bottom-0 z-30 bg-black/95 flex flex-col p-3">
          <nav className="flex-1 space-y-0.5">{navLinks(() => setMobileOpen(false))}</nav>
          <div className="pt-3 border-t border-white/10">
            <button
              onClick={handleSignOut}
              className="flex items-center gap-3 px-3 py-2 rounded-lg text-sm w-full text-left text-white/50 hover:text-white hover:bg-white/5 transition-colors"
            >
              <LogOut className="w-4 h-4 shrink-0" />
              Sign Out
            </button>
          </div>
        </div>
      )}
    </>
  )
}

function getLinks(eventSlug?: string, role?: UserRole | null) {
  if (!eventSlug) {
    const base = [{ href: '/dashboard', icon: Home, label: 'Dashboard' }]
    return role === 'super_admin'
      ? [...base, { href: '/admin', icon: Settings, label: 'Admin' }]
      : base
  }

  const base = `/events/${eventSlug}`

  if (role === 'super_admin' || role === 'event_admin') {
    return [
      { href: `${base}`, icon: Home, label: 'Overview' },
      { href: `${base}/manage`, icon: Settings, label: 'Manage Event' },
      { href: `${base}/manage/participants`, icon: Users, label: 'Participants' },
      { href: `${base}/manage/startups`, icon: Building2, label: 'Startups' },
      { href: `${base}/manage/history`, icon: ScrollText, label: 'Bid History' },
      { href: `${base}/host`, icon: Mic, label: 'Host Panel' },
      { href: `${base}/leaderboard`, icon: Trophy, label: 'Leaderboard' },
    ]
  }

  if (role === 'host') {
    return [
      { href: `${base}/host`, icon: Mic, label: 'Host Panel' },
      { href: `${base}/manage/history`, icon: ScrollText, label: 'Bid History' },
      { href: `${base}/leaderboard`, icon: Trophy, label: 'Leaderboard' },
    ]
  }

  if (role === 'startup') {
    return [
      { href: `${base}/startup`, icon: BarChart3, label: 'My Dashboard' },
      { href: `${base}/startup/profile`, icon: Building2, label: 'My Profile' },
      { href: `${base}/leaderboard`, icon: Trophy, label: 'Leaderboard' },
    ]
  }

  // investor / attendee
  return [
    { href: `${base}`, icon: Home, label: 'Startups' },
    { href: `${base}/invest`, icon: Zap, label: 'My Portfolio' },
    { href: `${base}/leaderboard`, icon: Trophy, label: 'Leaderboard' },
  ]
}
