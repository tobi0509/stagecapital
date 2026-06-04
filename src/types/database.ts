// Database types — mirrors Supabase schema
// In production, generate with: supabase gen types typescript --local > src/types/database.ts

export type EventStatus = 'draft' | 'registration_open' | 'active' | 'closed' | 'results_published'
export type BiddingStatus = 'pending' | 'additive' | 'competitive' | 'countdown' | 'closed'
export type UserRole = 'super_admin' | 'event_admin' | 'host' | 'startup' | 'investor' | 'attendee'
export type BidStatus = 'active' | 'displaced' | 'withdrawn' | 'finalized'
export type BidEventType = 'placed' | 'updated' | 'displaced' | 'withdrawn' | 'finalized'

export interface Profile {
  id: string
  email: string
  display_name: string
  avatar_url: string | null
  created_at: string
  updated_at: string
}

export interface Event {
  id: string
  slug: string
  name: string
  description: string | null
  event_date: string
  status: EventStatus
  default_budget: number
  investor_budget: number
  logo_url: string | null
  created_by: string
  created_at: string
  updated_at: string
}

export interface EventRole {
  id: string
  event_id: string
  user_id: string
  role: UserRole
  total_budget: number | null
  joined_at: string
}

export interface InvestmentCase {
  id: string
  event_id: string
  startup_user_id: string
  title: string
  equity_offered_pct: number
  ask_amount: number
  pitch_order: number
  bidding_status: BiddingStatus
  countdown_started_at: string | null
  countdown_ends_at: string | null
  data_locked_at: string | null
  created_at: string
  updated_at: string
}

export interface StartupProfile {
  id: string
  investment_case_id: string
  company_name: string
  logo_url: string | null
  pitch_deck_url: string | null
  website_url: string | null
  contact_email: string | null
  problem_statement: string | null
  solution: string | null
  one_liner: string | null
  industry: string | null
  traction: string | null
  founded_year: number | null
  team_size: number | null
  country: string | null
  created_at: string
  updated_at: string
}

export interface TeamMember {
  id: string
  startup_profile_id: string
  name: string
  title: string
  avatar_url: string | null
  sort_order: number
  created_at: string
}

export interface Bid {
  id: string
  investment_case_id: string
  investor_user_id: string
  equity_pct: number
  amount: number
  price_per_pct: number
  status: BidStatus
  placed_at: string
  updated_at: string
}

export interface BidHistory {
  id: string
  bid_id: string
  investment_case_id: string
  investor_user_id: string
  event_type: BidEventType
  equity_pct: number
  amount: number
  price_per_pct: number
  phase: 'additive' | 'competitive'
  displaced_by_bid_id: string | null
  snapshot_equity_sold_pct: number | null
  snapshot_implied_val: number | null
  recorded_at: string
}

export interface InvestmentCaseLive {
  investment_case_id: string
  event_id: string
  equity_offered_pct: number
  ask_amount: number
  bidding_status: BiddingStatus
  countdown_ends_at: string | null
  pitch_order: number
  total_equity_sold_pct: number
  total_capital_raised: number
  implied_valuation: number | null
  active_bid_count: number
}

// Joined type for startup card display
export interface InvestmentCaseWithStartup extends InvestmentCase {
  startup_profiles: StartupProfile | null
}
