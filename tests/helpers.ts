import { readFileSync } from 'fs'
import { createClient, SupabaseClient } from '@supabase/supabase-js'

function loadEnvLocal() {
  try {
    const raw = readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
    for (const line of raw.split('\n')) {
      const m = line.match(/^([A-Z_]+)=(.*)$/)
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim()
    }
  } catch {
    // .env.local absent — assume env vars are already set (e.g. in CI)
  }
}
loadEnvLocal()

export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
export const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
export const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!

if (!SUPABASE_URL || !ANON_KEY || !SERVICE_KEY) {
  throw new Error(
    'Missing Supabase env vars. These are integration tests that run against a real ' +
    'Supabase project — populate .env.local (see .env.local.example) before running them.'
  )
}

export const admin: SupabaseClient = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})

const TEST_PASSWORD = 'VitestRunner1234!'
const runId = Date.now().toString(36) + Math.random().toString(36).slice(2, 6)

export interface TestUser {
  id: string
  email: string
  client: SupabaseClient
}

/** Creates a confirmed test user and a signed-in client scoped to their session. */
export async function createTestUser(label: string): Promise<TestUser> {
  const email = `vitest-${label}-${runId}@stagecapital.test`
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: TEST_PASSWORD,
    email_confirm: true,
  })
  if (error || !data.user) throw new Error(`Failed to create test user ${label}: ${error?.message}`)

  const client = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } })
  const { error: signInError } = await client.auth.signInWithPassword({ email, password: TEST_PASSWORD })
  if (signInError) throw new Error(`Failed to sign in test user ${label}: ${signInError.message}`)

  return { id: data.user.id, email, client }
}

export async function deleteTestUser(userId: string) {
  await admin.auth.admin.deleteUser(userId).catch(() => {})
}

export interface TestEventFixture {
  eventId: string
  caseId: string
  caseId2: string
  host: TestUser
  investorA: TestUser
  investorB: TestUser
  attendee: TestUser
  startup: TestUser
  startup2: TestUser
}

/**
 * Spins up a disposable event with TWO investment cases (20% equity,
 * $500k ask each) and five role-holders (host, two investors, one
 * attendee, two startups), all pointed at the real Supabase project.
 * Two cases exist specifically so concurrency tests can exercise
 * cross-case races (budget, deadlocks) that a single-case fixture
 * can't reach. Call teardownEventFixture() when done.
 */
export async function setupEventFixture(): Promise<TestEventFixture> {
  const [host, investorA, investorB, attendee, startup, startup2] = await Promise.all([
    createTestUser('host'),
    createTestUser('inv-a'),
    createTestUser('inv-b'),
    createTestUser('attendee'),
    createTestUser('startup'),
    createTestUser('startup2'),
  ])

  const { data: event, error: eventErr } = await admin
    .from('events')
    .insert({
      slug: `vitest-${runId}`,
      name: 'Vitest Fixture Event',
      event_date: '2026-01-01',
      status: 'active',
      default_budget: 50000,
      investor_budget: 150000,
      created_by: host.id,
    })
    .select()
    .single()
  if (eventErr || !event) throw new Error(`Failed to create test event: ${eventErr?.message}`)

  const { error: rolesErr } = await admin.from('event_roles').insert([
    { event_id: event.id, user_id: host.id, role: 'host' },
    { event_id: event.id, user_id: investorA.id, role: 'investor' },
    { event_id: event.id, user_id: investorB.id, role: 'investor' },
    { event_id: event.id, user_id: attendee.id, role: 'attendee' },
    { event_id: event.id, user_id: startup.id, role: 'startup' },
    { event_id: event.id, user_id: startup2.id, role: 'startup' },
  ])
  if (rolesErr) throw new Error(`Failed to assign roles: ${rolesErr.message}`)

  const { data: cases, error: caseErr } = await admin
    .from('investment_cases')
    .insert([
      { event_id: event.id, startup_user_id: startup.id, title: 'Vitest Test Startup', equity_offered_pct: 20, ask_amount: 500000, pitch_order: 1, bidding_status: 'pending' },
      { event_id: event.id, startup_user_id: startup2.id, title: 'Vitest Test Startup 2', equity_offered_pct: 20, ask_amount: 500000, pitch_order: 2, bidding_status: 'pending' },
    ])
    .select()
  if (caseErr || !cases || cases.length !== 2) throw new Error(`Failed to create investment cases: ${caseErr?.message}`)

  return {
    eventId: event.id,
    caseId: cases[0].id,
    caseId2: cases[1].id,
    host, investorA, investorB, attendee, startup, startup2,
  }
}

export async function teardownEventFixture(fixture: TestEventFixture) {
  const { error } = await admin.from('events').delete().eq('id', fixture.eventId)
  if (error) {
    // Surfaced loudly on purpose: a silent failure here previously
    // masked a schema bug (bid_history lacked ON DELETE CASCADE from
    // investment_cases) that left every test run's fixture data
    // behind in the real database indefinitely.
    console.error(`Failed to delete test event ${fixture.eventId}:`, error.message)
  }
  await Promise.all(
    [fixture.host, fixture.investorA, fixture.investorB, fixture.attendee, fixture.startup, fixture.startup2]
      .map(u => deleteTestUser(u.id))
  )
}

interface RpcResult {
  success: boolean
  error?: string
  [key: string]: unknown
}

export async function callRpc(
  client: SupabaseClient,
  fn: string,
  params: Record<string, unknown>
): Promise<RpcResult> {
  const { data, error } = await client.rpc(fn, params)
  if (error) return { success: false, error: error.message }
  return data as RpcResult
}
