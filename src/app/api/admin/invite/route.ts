import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'

export async function POST(request: NextRequest) {
  try {
    const { email, role, eventId } = await request.json()

    if (!email || !role || !eventId) {
      return NextResponse.json({ success: false, error: 'Missing fields' }, { status: 400 })
    }

    const supabase = await createServiceClient()

    // Verify caller has admin rights for this event
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ success: false, error: 'Not authenticated' }, { status: 401 })
    }

    const { data: callerRole } = await supabase
      .from('event_roles')
      .select('role')
      .eq('event_id', eventId)
      .eq('user_id', user.id)
      .single()

    const isSuperAdmin = await supabase
      .from('super_admins')
      .select('user_id')
      .eq('user_id', user.id)
      .single()

    if (!['event_admin'].includes(callerRole?.role ?? '') && !isSuperAdmin.data) {
      return NextResponse.json({ success: false, error: 'Not authorized' }, { status: 403 })
    }

    // Find profile by email
    const { data: profile } = await supabase
      .from('profiles')
      .select('id')
      .eq('email', email)
      .single()

    if (!profile) {
      return NextResponse.json({ success: false, error: 'User not found. They must sign up first.' }, { status: 404 })
    }

    // Upsert event role
    const { error } = await supabase
      .from('event_roles')
      .upsert({
        event_id: eventId,
        user_id: profile.id,
        role,
      }, { onConflict: 'event_id,user_id' })

    if (error) {
      return NextResponse.json({ success: false, error: error.message }, { status: 400 })
    }

    return NextResponse.json({ success: true })
  } catch {
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 })
  }
}
