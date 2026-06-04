import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ eventSlug: string }> }
) {
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

    // Verify the caller is host/admin for this event
    const { eventSlug } = await params
    const { data: event } = await supabase
      .from('events')
      .select('id')
      .eq('slug', eventSlug)
      .single()

    if (!event) {
      return NextResponse.json({ success: false, error: 'Event not found' }, { status: 404 })
    }

    const { data: role } = await supabase
      .from('event_roles')
      .select('role')
      .eq('event_id', event.id)
      .eq('user_id', user.id)
      .single()

    if (!role || !['host', 'event_admin', 'super_admin'].includes(role.role)) {
      return NextResponse.json({ success: false, error: 'Not authorized' }, { status: 403 })
    }

    const { data, error } = await supabase.rpc('close_bidding', {
      p_investment_case_id: caseId,
    })

    if (error) {
      return NextResponse.json({ success: false, error: error.message }, { status: 400 })
    }

    return NextResponse.json(data)
  } catch {
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 })
  }
}
