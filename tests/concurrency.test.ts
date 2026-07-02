import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import {
  admin,
  callRpc,
  setupEventFixture,
  teardownEventFixture,
  type TestEventFixture,
} from './helpers'

// Regression coverage for two bugs found by actually running every
// role at once against the live platform (a host, two investors, two
// startups, two attendees, all firing simultaneous requests). Neither
// bug was reachable by testing one action at a time — both only
// exist under genuine concurrency:
//
//   1. open_bidding deadlocked (Postgres 40P01) when a host opened
//      two different cases in the same event at the exact same
//      instant, because the "lock startup data on first pitch" step
//      touched every case row in the event, in whatever order each
//      concurrent transaction happened to reach them.
//   2. place_bid let a single investor overspend their budget by
//      firing simultaneous bids on two different startups — the
//      per-case row lock didn't protect the cross-case budget total,
//      so both bids read "nothing committed yet" and both succeeded.

describe('concurrency', () => {
  let fx: TestEventFixture

  beforeAll(async () => {
    fx = await setupEventFixture()
  })

  afterAll(async () => {
    await teardownEventFixture(fx)
  })

  it('opens two different cases in the same event at the same instant without deadlocking', async () => {
    const [a, b] = await Promise.all([
      callRpc(fx.host.client, 'open_bidding', { p_investment_case_id: fx.caseId, p_caller_user_id: fx.host.id }),
      callRpc(fx.host.client, 'open_bidding', { p_investment_case_id: fx.caseId2, p_caller_user_id: fx.host.id }),
    ])
    expect(a.success).toBe(true)
    expect(b.success).toBe(true)
  })

  it('never lets an investor overspend by bidding on two cases at the same instant', async () => {
    // investorA's budget is 150000. Two simultaneous 100000 bids on
    // different cases would total 200000 if both succeeded.
    const [a, b] = await Promise.all([
      callRpc(fx.investorA.client, 'place_bid', {
        p_investment_case_id: fx.caseId,
        p_investor_user_id: fx.investorA.id,
        p_equity_pct: 10,
        p_amount: 100000,
      }),
      callRpc(fx.investorA.client, 'place_bid', {
        p_investment_case_id: fx.caseId2,
        p_investor_user_id: fx.investorA.id,
        p_equity_pct: 10,
        p_amount: 100000,
      }),
    ])

    const successes = [a, b].filter(r => r.success)
    expect(successes).toHaveLength(1)

    const { data: activeBids } = await admin
      .from('bids')
      .select('amount, investment_cases!inner(event_id)')
      .eq('investor_user_id', fx.investorA.id)
      .eq('status', 'active')
      .eq('investment_cases.event_id', fx.eventId)

    const totalCommitted = (activeBids ?? []).reduce((sum, b) => sum + Number(b.amount), 0)
    expect(totalCommitted).toBeLessThanOrEqual(150000)
  })

  it('two different investors bidding on two different cases at the same instant both succeed', async () => {
    // Sanity check that the fix above serializes per-investor, not
    // globally — unrelated investors on unrelated cases shouldn't
    // block each other.
    const [a, b] = await Promise.all([
      callRpc(fx.investorB.client, 'place_bid', {
        p_investment_case_id: fx.caseId,
        p_investor_user_id: fx.investorB.id,
        p_equity_pct: 5,
        p_amount: 60000,
      }),
      callRpc(fx.attendee.client, 'place_bid', {
        p_investment_case_id: fx.caseId2,
        p_investor_user_id: fx.attendee.id,
        p_equity_pct: 5,
        p_amount: 45000,
      }),
    ])
    expect(a.success).toBe(true)
    expect(b.success).toBe(true)
  })
})
