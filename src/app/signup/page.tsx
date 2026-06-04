'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { toast } from 'sonner'

export default function SignupPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [loading, setLoading] = useState(false)
  const [done, setDone] = useState(false)
  const router = useRouter()
  const supabase = createClient()

  async function handleSignup(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { full_name: name },
        emailRedirectTo: `${window.location.origin}/auth/callback`,
      },
    })
    if (error) {
      toast.error('Signup failed', { description: error.message })
    } else {
      setDone(true)
    }
    setLoading(false)
  }

  async function handleGoogleLogin() {
    await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    })
  }

  if (done) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-black px-4">
        <div className="text-center space-y-4 max-w-sm">
          <div className="w-16 h-16 rounded-full bg-blue-500/20 border border-blue-500/30 flex items-center justify-center mx-auto text-3xl">
            ✉️
          </div>
          <h2 className="text-xl font-bold text-white">Check your email</h2>
          <p className="text-white/50 text-sm">
            We sent a confirmation link to <strong className="text-white">{email}</strong>.
            Click it to activate your account and join the event.
          </p>
          <Link href="/login" className="text-blue-400 text-sm hover:underline">
            Back to sign in
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-black px-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center space-y-2">
          <Link href="/" className="text-3xl font-black text-white">
            Stage<span className="text-blue-400">Capital</span>
          </Link>
          <p className="text-white/50 text-sm">Create your account</p>
        </div>

        <div className="rounded-2xl border border-white/10 bg-white/5 p-6 space-y-4">
          <Button
            onClick={handleGoogleLogin}
            variant="outline"
            className="w-full border-white/20 bg-white/5 hover:bg-white/10 text-white"
          >
            <svg className="w-4 h-4 mr-2" viewBox="0 0 24 24">
              <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
              <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
              <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
              <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
            </svg>
            Continue with Google
          </Button>

          <div className="flex items-center gap-3">
            <div className="flex-1 h-px bg-white/10" />
            <span className="text-xs text-white/30">or</span>
            <div className="flex-1 h-px bg-white/10" />
          </div>

          <form onSubmit={handleSignup} className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="name" className="text-white/70 text-sm">Full Name</Label>
              <Input
                id="name"
                type="text"
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder="Alex Johnson"
                required
                className="bg-white/10 border-white/20 text-white placeholder:text-white/30"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="email" className="text-white/70 text-sm">Email</Label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="you@example.com"
                required
                className="bg-white/10 border-white/20 text-white placeholder:text-white/30"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="password" className="text-white/70 text-sm">Password</Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="Min. 8 characters"
                minLength={8}
                required
                className="bg-white/10 border-white/20 text-white placeholder:text-white/30"
              />
            </div>
            <p className="text-xs text-white/30">
              By creating an account you agree to our privacy policy.
              Your data is stored in the EU (GDPR compliant).
            </p>
            <Button
              type="submit"
              disabled={loading}
              className="w-full bg-blue-500 hover:bg-blue-600 text-white font-semibold"
            >
              {loading ? 'Creating account…' : 'Create Account'}
            </Button>
          </form>
        </div>

        <p className="text-center text-sm text-white/40">
          Already have an account?{' '}
          <Link href="/login" className="text-blue-400 hover:text-blue-300 font-medium">
            Sign in
          </Link>
        </p>
      </div>
    </div>
  )
}
