import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'

export async function POST(request: NextRequest) {
  try {
    const { caseId } = await request.json()
    if (!caseId) {
      return NextResponse.json({ success: false, error: 'Missing caseId' }, { status: 400 })
    }

    const supabase = await createServiceClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ success: false, error: 'Not authenticated' }, { status: 401 })
    }

    const { data, error } = await supabase.rpc('open_bidding', {
      p_investment_case_id: caseId,
      p_caller_user_id:     user.id,
    })

    if (error) {
      return NextResponse.json({ success: false, error: error.message }, { status: 400 })
    }

    return NextResponse.json(data)
  } catch {
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 })
  }
}
