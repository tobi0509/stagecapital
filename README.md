# StageCapital

**StageCapital** is a virtual investment platform for live pitch events — think of it as a stock exchange for startup pitch nights. Startups pitch on stage, and investors and audience members bid virtual capital for equity in real time, on their phones or laptops, while a host runs the show from a control panel and a "big screen" view projects the live action for the room.

Built for [Young AI Leaders Linz](https://www.instagram.com/youngaileaderslinz).

> Virtual currency only. No real monetary value. GDPR compliant.

## How it works

1. An **event admin** creates an event and invites participants (by email) into one of six roles.
2. Each **startup** signs up, fills in their company profile, and sets their own **ask**: a valuation and the percentage of equity they're offering. From that, the app computes how much capital is up for grabs (e.g. a $1M valuation offering 20% puts $200K on the table).
3. On the day, a **host** opens bidding for one startup at a time from a control panel. The moment the *first* pitch opens, every startup's ask is locked for the rest of the event — only an event admin (or super admin) can still adjust it after that point.
4. **Investors** and **attendees** each get a budget (investors get a bigger one) and bid on the open case. Bidding runs in two phases:
   - **Additive**: bids simply fill up the offered equity, as long as there's room left.
   - **Competitive**: once the offered equity is fully subscribed, a new bid must beat the current lowest price-per-percent to get in — and if it does, it *displaces* the cheapest existing bid, freeing up exactly the equity it needs. This is what drives the valuation up live, like an auction.
5. Everyone watching — investor or attendee — sees the same three numbers side by side: their own remaining budget, the startup's original asking valuation, and the live, bid-derived current valuation. No one only sees "how much money they have"; the market context is always visible.
6. The host can start a 60-second countdown to force a close, or close bidding immediately. Once closed, bids are finalized and the leaderboard updates.

## Roles

| Role | Can do |
|---|---|
| `super_admin` | Platform-wide access across all events |
| `event_admin` | Create/manage a specific event, invite participants, assign startups to cases, override a startup's ask at any time |
| `host` | Open/close bidding, start countdowns, run the live show for an event |
| `startup` | Fill in their company profile and pitch deck, set their own valuation/equity ask (until the event starts) |
| `investor` | Bid on startups with a (typically larger) budget |
| `attendee` | Bid on startups with a (typically smaller) budget — same market visibility as investors |

Roles are assigned **per event**, not globally (a user can be an investor at one event and a startup at another), except `super_admin`, which is platform-wide.

## Tech stack

- **Next.js 16** (App Router, Turbopack) + **React 19** + **TypeScript**
- **Supabase** (Postgres, Auth, Row-Level Security, Realtime, `pg_cron`) — no separate backend server
- **Tailwind CSS 4** + **shadcn/ui** components (on top of `@base-ui/react`)
- Most of the bidding logic lives in **Postgres functions** (`SECURITY DEFINER` RPCs), not in the Next.js API layer — the database is the source of truth and the last line of defense, even if the client is compromised.

## Project structure

```
src/
  app/
    login/, signup/                        — auth pages
    dashboard/                              — "your events" landing page after login
    admin/                                  — super-admin panel (create events)
    events/[eventSlug]/
      page.tsx                              — "Startups" market overview (investor/attendee)
      manage/                               — event admin: event settings, participants, startup cases
      host/                                 — host control panel (open/close bidding, countdown)
      pitch/[caseId]/                       — "big screen" view for projecting during the event
      startup/, startup/profile/            — startup's own dashboard and profile/ask editor
      invest/, invest/[caseId]/             — investor/attendee portfolio and per-startup bidding page
      leaderboard/                          — final results per event
  components/
    bidding/                                — BidForm, PhaseIndicator, BudgetMeter
    valuation/                              — ValuationDisplay, EquityCapBar
    realtime/                               — useInvestmentCaseLive (Supabase Realtime subscription hook)
    layout/                                 — Sidebar (role-aware navigation)
  lib/
    supabase/                               — browser + server Supabase clients
    roles/guards.ts                         — role-permission helper functions
    valuation/calculator.ts                 — formatting/valuation math shared by client and display components
  types/database.ts                         — hand-written types mirroring the Supabase schema
supabase/
  migrations/                               — every schema change, RLS policy, and stored procedure, in order
```

## Database schema (high level)

- `events` — one row per pitch night; holds default budgets and status (`draft` → `registration_open` → `active` → `closed` → `results_published`)
- `event_roles` — maps a user to a role *within* a specific event, with an optional per-user budget override
- `investment_cases` — one row per startup's pitch slot: `equity_offered_pct`, `ask_amount`, `bidding_status` (`pending` → `additive` → `competitive` → `countdown` → `closed`), and `data_locked_at` (set event-wide the instant the first pitch opens)
- `startup_profiles` / `team_members` — the pitch content itself (company info, deck, team)
- `bids` — one active row per investor per case (older bids move to `displaced`/`withdrawn`/`finalized`); `price_per_pct` is a generated column used to rank competitive bids
- `bid_history` — append-only audit log of every placement, displacement, and finalization

All of the actual bidding rules — phase transitions, displacement, budget checks — live in Postgres functions defined across the migrations in `supabase/migrations/` (see `0003_procedures.sql` and `0005_security_fixes.sql` for `place_bid`, `open_bidding`, `start_countdown`, `close_bidding`). Read the comments at the top of each migration file — several were written specifically to document a bug that was found and fixed (race conditions, identity spoofing, RLS visibility leaks), so they're a good place to look before changing that logic.

## Getting started

### Prerequisites

- Node.js 20+
- A [Supabase](https://supabase.com) project

### Setup

1. Install dependencies:
   ```bash
   npm install
   ```
2. Copy `.env.local.example` to `.env.local` and fill in your Supabase project's URL and keys (**Project Settings → API** in the Supabase dashboard):
   ```bash
   cp .env.local.example .env.local
   ```
3. Run every file in `supabase/migrations/` against your Supabase project, **in order** — either via the Supabase CLI (`supabase db push`, once the project is linked with `supabase link`) or by pasting each file into the Supabase SQL Editor one at a time.
4. Start the dev server:
   ```bash
   npm run dev
   ```
5. Open [http://localhost:3000](http://localhost:3000).

### Environment variables

| Variable | Where to find it |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase dashboard → Project Settings → API |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | same page — safe to expose to the browser |
| `SUPABASE_SERVICE_ROLE_KEY` | same page — **server-side only**, bypasses Row-Level Security, never expose to the client |

### Trying it out

Create a `super_admin` for yourself directly in the database (there's no UI for the very first one — everyone else is invited by an existing admin):

```sql
insert into public.super_admins (user_id) values ('<your-auth-user-id>');
```

From there: sign up, log in, create an event from `/admin`, invite people into it from **Manage Event → Participants**, and add a startup pitch slot from **Manage Event → Startups**. The startup then logs in themselves and sets their own valuation/ask from their profile page — the admin only picks *who* the startup is, not *what* they're worth.

## Notable design decisions

- **The database enforces the rules, not just the UI.** Every bid, phase transition, and role check is re-verified inside a `SECURITY DEFINER` Postgres function using `auth.uid()` — a compromised or malicious client can't place a bid as someone else, open bidding without the host role, or bid more than their remaining budget, no matter what the browser sends.
- **Aggregate numbers (implied valuation, capital raised, equity sold) are computed by dedicated RPCs, not by summing rows the client can see.** Row-level security intentionally restricts which individual bids an `attendee` can see, but the market-wide totals must stay accurate for everyone — so those totals are computed server-side across *all* rows, independent of who's asking.
- **A startup's ask locks the moment the event starts**, not the moment their own turn comes up — otherwise a startup pitching 5th could keep adjusting their number while watching how the first four went.

## Known follow-ups

- Two migrations (`0007_startup_ask.sql`, `0008_lock_ask_on_event_start.sql`) were applied to the live Supabase project by hand through the SQL Editor rather than via `supabase db push`, since CLI auth wasn't available in the environment they were written in. Confirm they're reflected correctly if you re-link the project with the Supabase CLI.
- The startup's own dashboard currently also lists every investor/attendee registered for the event, not just the bids on their own case — worth revisiting if that's more visibility than startups should have.
