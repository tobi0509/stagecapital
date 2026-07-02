import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import {
  admin,
  callRpc,
  setupEventFixture,
  teardownEventFixture,
  type TestEventFixture,
} from './helpers'

// Regression coverage for two bugs found via live adversarial testing
// of the production platform (see git history for the fixes):
//
//   1. place_bid/open_bidding/start_countdown trusted a client-supplied
//      user id instead of the caller's real session (auth.uid()),
//      letting any authenticated user act as someone else.
//   2. close_bidding had no permission check at all and was directly
//      callable by any authenticated user via the RPC endpoint.
//
// These run against the real Supabase project (see tests/helpers.ts)
// since the bidding engine's correctness lives entirely in Postgres
// stored procedures + RLS, not in application code a mock DB could
// stand in for.

describe('bidding engine', () => {
  let fx: TestEventFixture

  beforeAll(async () => {
    fx = await setupEventFixture()
  })

  afterAll(async () => {
    await teardownEventFixture(fx)
  })

  describe('identity enforcement', () => {
    it('rejects a bid placed on behalf of another user', async () => {
      const result = await callRpc(fx.attendee.client, 'place_bid', {
        p_investment_case_id: fx.caseId,
        p_investor_user_id: fx.investorA.id, // spoofed — attendee is signed in as themselves
        p_equity_pct: 5,
        p_amount: 50000,
      })
      expect(result.success).toBe(false)
      expect(result.error).toMatch(/own behalf/i)
    })

    it('rejects open_bidding called with a spoofed caller id', async () => {
      const result = await callRpc(fx.attendee.client, 'open_bidding', {
        p_investment_case_id: fx.caseId,
        p_caller_user_id: fx.host.id, // spoofed
      })
      expect(result.success).toBe(false)
    })

    it('rejects close_bidding from a non-privileged role, called directly', async () => {
      // Regression test for the exact exploit: close_bidding took no
      // caller parameter at all and had zero internal permission check.
      const result = await callRpc(fx.attendee.client, 'close_bidding', {
        p_investment_case_id: fx.caseId,
      })
      expect(result.success).toBe(false)
      expect(result.error).toMatch(/not authorized/i)
    })
  })

  describe('additive phase', () => {
    it('host can open bidding', async () => {
      const result = await callRpc(fx.host.client, 'open_bidding', {
        p_investment_case_id: fx.caseId,
        p_caller_user_id: fx.host.id,
      })
      expect(result.success).toBe(true)
    })

    it('accepts bids up to the equity cap and transitions to competitive on fill', async () => {
      const first = await callRpc(fx.investorA.client, 'place_bid', {
        p_investment_case_id: fx.caseId,
        p_investor_user_id: fx.investorA.id,
        p_equity_pct: 10,
        p_amount: 100000,
      })
      expect(first.success).toBe(true)
      expect(first.phase).toBe('additive')

      const second = await callRpc(fx.investorB.client, 'place_bid', {
        p_investment_case_id: fx.caseId,
        p_investor_user_id: fx.investorB.id,
        p_equity_pct: 10,
        p_amount: 120000,
      })
      expect(second.success).toBe(true)
      // 10% + 10% = 20% = full equity offered -> auto-transition
      expect(second.phase).toBe('competitive')
    })

    it('rejects bids exceeding the investor budget', async () => {
      const result = await callRpc(fx.attendee.client, 'place_bid', {
        p_investment_case_id: fx.caseId,
        p_investor_user_id: fx.attendee.id,
        p_equity_pct: 2,
        p_amount: 999999, // attendee default budget is 50000
      })
      expect(result.success).toBe(false)
      expect(result.error).toMatch(/insufficient budget/i)
    })
  })

  describe('competitive phase', () => {
    it('rejects a bid that does not beat the current floor price', async () => {
      // Floor is min(100000/10=10000, 120000/10=12000) = 10000/pt.
      // 2% for 19000 = 9500/pt, below the floor.
      const result = await callRpc(fx.attendee.client, 'place_bid', {
        p_investment_case_id: fx.caseId,
        p_investor_user_id: fx.attendee.id,
        p_equity_pct: 2,
        p_amount: 19000,
      })
      expect(result.success).toBe(false)
      expect(result.error).toMatch(/not competitive enough/i)
    })

    it('displaces the cheapest active bid when outbid on price-per-percent', async () => {
      // 2% for 30000 = 15000/pt, clears the 10000/pt floor (investorA's bid).
      const result = await callRpc(fx.attendee.client, 'place_bid', {
        p_investment_case_id: fx.caseId,
        p_investor_user_id: fx.attendee.id,
        p_equity_pct: 2,
        p_amount: 30000,
      })
      expect(result.success).toBe(true)
      expect(result.displaced_ids).toHaveLength(1)

      const { data: displaced } = await admin
        .from('bids')
        .select('status, investor_user_id')
        .eq('investment_case_id', fx.caseId)
        .eq('investor_user_id', fx.investorA.id)
        .single()
      expect(displaced?.status).toBe('displaced')
    })
  })

  describe('close_bidding', () => {
    it('allows the host to close bidding', async () => {
      const result = await callRpc(fx.host.client, 'close_bidding', {
        p_investment_case_id: fx.caseId,
      })
      expect(result.success).toBe(true)

      const { data: ic } = await admin
        .from('investment_cases')
        .select('bidding_status')
        .eq('id', fx.caseId)
        .single()
      expect(ic?.bidding_status).toBe('closed')
    })

    it('finalizes all active bids on close', async () => {
      const { data: bids } = await admin
        .from('bids')
        .select('status')
        .eq('investment_case_id', fx.caseId)
        .in('status', ['active', 'finalized'])
      expect(bids?.every(b => b.status === 'finalized')).toBe(true)
    })

    it('rejects placing a bid after bidding has closed', async () => {
      const result = await callRpc(fx.investorB.client, 'place_bid', {
        p_investment_case_id: fx.caseId,
        p_investor_user_id: fx.investorB.id,
        p_equity_pct: 2,
        p_amount: 40000,
      })
      expect(result.success).toBe(false)
    })
  })
})
