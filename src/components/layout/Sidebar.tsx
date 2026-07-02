'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { BarChart3, Home, Settings, Users, Zap, Trophy, Mic, Building2 } from 'lucide-react'
import type { UserRole } from '@/types/database'

interface SidebarProps {
  eventSlug?: string
  role?: UserRole | null
}

export function Sidebar({ eventSlug, role }: SidebarProps) {
  const pathname = usePathname()

  const links = getLinks(eventSlug, role)

  return (
    <aside className="w-56 shrink-0 border-r border-white/10 bg-black/40 hidden md:flex flex-col">
      <div className="p-5 border-b border-white/10">
        <Link href="/dashboard" className="font-black text-xl tracking-tight text-white">
          Stage<span className="text-blue-400">Capital</span>
        </Link>
      </div>

      <nav className="flex-1 p-3 space-y-0.5">
        {links.map(({ href, icon: Icon, label }) => {
          const active = pathname === href || pathname.startsWith(href + '/')
          return (
            <Link
              key={href}
              href={href}
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
        })}
      </nav>
    </aside>
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
      { href: `${base}/host`, icon: Mic, label: 'Host Panel' },
      { href: `${base}/leaderboard`, icon: Trophy, label: 'Leaderboard' },
    ]
  }

  if (role === 'host') {
    return [
      { href: `${base}/host`, icon: Mic, label: 'Host Panel' },
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
