import type { UserRole } from '@/types/database'

export const ROLE_HIERARCHY: Record<UserRole, number> = {
  super_admin: 100,
  event_admin: 80,
  host: 60,
  startup: 40,
  investor: 30,
  attendee: 20,
}

export function canOpenBidding(role: UserRole | null): boolean {
  return role === 'host' || role === 'event_admin' || role === 'super_admin'
}

export function canManageEvent(role: UserRole | null): boolean {
  return role === 'event_admin' || role === 'super_admin'
}

export function canPlaceBids(role: UserRole | null): boolean {
  return role === 'investor' || role === 'attendee'
}

export function canViewContactDetails(role: UserRole | null): boolean {
  return role === 'investor' || role === 'event_admin' || role === 'super_admin'
}

export function canViewStartupBidders(role: UserRole | null): boolean {
  return role === 'startup' || role === 'event_admin' || role === 'host' || role === 'super_admin'
}

export function isAdminRole(role: UserRole | null): boolean {
  return role === 'event_admin' || role === 'super_admin'
}
