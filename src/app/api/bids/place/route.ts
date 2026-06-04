import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'

export async function POST(request: NextRequest) {
  try {
    const { caseId, equityPct, amount } = await request.json()

    if (!caseId || !equityPct || !amount) {
      return NextResponse.json({ success: false, error: 'Missing required fields' }, { status: 400 })
    }

    const supabase = await createServiceClient()

    // Get authenticated user
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ success: false, error: 'Not authenticated' }, { status: 401 })
    }

    // Call the atomic stored procedure
    const { data, error } = await supabase.rpc('place_bid', {
      p_investment_case_id: caseId,
      p_investor_user_id:   user.id,
      p_equity_pct:         equityPct,
      p_amount:             amount,
    })

    if (error) {
      return NextResponse.json({ success: false, error: error.message }, { status: 400 })
    }

    return NextResponse.json(data)
  } catch (err) {
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 })
  }
}
