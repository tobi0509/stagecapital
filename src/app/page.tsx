import Link from 'next/link'

export default function Home() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-black px-6">
      {/* Background gradient */}
      <div className="absolute inset-0 bg-gradient-to-br from-blue-950/20 via-black to-black pointer-events-none" />

      <div className="relative z-10 flex flex-col items-center text-center gap-8 max-w-2xl">
        {/* Badge */}
        <span className="px-3 py-1 rounded-full border border-blue-500/30 bg-blue-500/10 text-blue-400 text-xs font-semibold uppercase tracking-widest">
          Young AI Leaders Linz
        </span>

        {/* Logo */}
        <h1 className="text-5xl sm:text-6xl md:text-7xl font-black tracking-tight">
          Stage<span className="text-blue-400">Capital</span>
        </h1>

        <p className="text-xl text-white/60 leading-relaxed max-w-lg">
          The virtual investment platform for live pitch events.
          Receive a budget. Bid on equity. Determine the winner.
        </p>

        {/* Stats row */}
        <div className="flex gap-8 text-center">
          {[
            { label: 'Roles', value: '6' },
            { label: 'Real-time', value: '< 2s' },
            { label: 'Equity Steps', value: '11' },
          ].map(({ label, value }) => (
            <div key={label}>
              <p className="text-3xl font-black text-white">{value}</p>
              <p className="text-xs text-white/40 uppercase tracking-wider mt-1">{label}</p>
            </div>
          ))}
        </div>

        {/* CTA */}
        <div className="flex flex-col sm:flex-row gap-3 w-full sm:w-auto">
          <Link
            href="/login"
            className="px-8 py-3 bg-blue-500 hover:bg-blue-600 text-white font-semibold rounded-xl transition-colors text-center"
          >
            Sign In
          </Link>
          <Link
            href="/signup"
            className="px-8 py-3 border border-white/20 hover:bg-white/5 text-white font-semibold rounded-xl transition-colors text-center"
          >
            Create Account
          </Link>
        </div>

        <p className="text-xs text-white/30 mt-4">
          Virtual currency only · No real monetary value · GDPR compliant
        </p>
      </div>
    </div>
  )
}
