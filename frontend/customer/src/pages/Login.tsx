import { useState } from "react"
import { useNavigate } from "react-router-dom"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import LiquidGradient from "@/components/LiquidGradient"
import { login } from "@/api"

export default function Login({ onLogin }: { onLogin: (token: string) => void }) {
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(false)
  const navigate = useNavigate()

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError("")
    setLoading(true)
    try {
      const token = await login(email.trim(), password)
      onLogin(token)
      navigate("/dashboard")
    } catch {
      setError("Invalid email or password.")
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex bg-white">
      {/* Left: form */}
      <div className="flex-1 flex items-center justify-center p-10 grain grain-light">
        <div className="w-full max-w-[360px]">
          <div className="mb-9">
            <span className="text-lg font-semibold tracking-tight">Verita AI</span>
          </div>

          <h1 className="text-[26px] font-semibold tracking-[-0.025em] mb-1.5">Sign in to your account</h1>
          <p className="text-sm text-muted-foreground mb-7">View usage, download invoices, manage API keys.</p>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-[12.5px] font-medium">Email</label>
              <Input type="email" placeholder="you@company.com" value={email}
                onChange={(e) => setEmail(e.target.value)} autoFocus />
            </div>
            <div className="space-y-1.5">
              <label className="text-[12.5px] font-medium">Password</label>
              <Input type="password" placeholder="••••••••" value={password}
                onChange={(e) => setPassword(e.target.value)} />
            </div>

            {error && (
              <div className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md bg-destructive/10 text-destructive text-xs font-medium">
                {error}
              </div>
            )}

            <Button type="submit" size="lg" className="w-full" disabled={loading || !email.trim() || !password}>
              {loading ? "Signing in…" : <>Sign in <span className="opacity-80 ml-0.5">→</span></>}
            </Button>

          </form>
        </div>
      </div>

      {/* Right: liquid gradient panel */}
      <div className="flex-1 hidden md:block relative border-l border-border">
        <LiquidGradient scheme={1} className="absolute inset-0">
          <div>
            <div className="font-mono-numeric text-[11.5px] tracking-[0.12em] uppercase font-medium text-white/75 mb-3">
              verita · billing
            </div>
            <h2 className="text-[38px] font-semibold tracking-[-0.03em] leading-[1.05] max-w-[360px]">
              Metering that moves at the speed of your product.
            </h2>
          </div>

          <div className="flex-1 flex items-center justify-center py-5">
            <FloatingPreview />
          </div>

<div />
        </LiquidGradient>
      </div>
    </div>
  )
}

function FloatingPreview() {
  const data = [3.2, 4.1, 3.8, 5.6, 5.2, 6.4, 7.1, 7.8, 7.4, 8.6, 9.2, 10.1, 11.4, 12.0, 12.6, 13.8, 14.4, 15.1, 16.3, 17.0]
  const max = Math.max(...data)
  const xs = data.map((_, i) => (i / (data.length - 1)) * 280)
  const ys = data.map((v) => 70 - (v / max) * 60)
  let line = `M ${xs[0]} ${ys[0]}`
  for (let i = 0; i < xs.length - 1; i++) {
    const cx = (xs[i] + xs[i + 1]) / 2
    line += ` C ${cx} ${ys[i]}, ${cx} ${ys[i + 1]}, ${xs[i + 1]} ${ys[i + 1]}`
  }
  const area = `${line} L 280 80 L 0 80 Z`

  return (
    <div className="w-[320px] -translate-y-2">
      <div className="bg-white rounded-2xl p-5 text-foreground border border-black/5 shadow-[0_30px_80px_-20px_rgba(15,10,50,0.35),0_12px_30px_-10px_rgba(15,10,50,0.18)]">
        <div className="flex items-center justify-between mb-3.5">
          <div>
            <div className="text-[11px] uppercase tracking-[0.06em] font-medium text-muted-foreground">Current period</div>
            <div className="text-[26px] font-semibold tracking-[-0.025em] tabular mt-1">$12,428<span className="text-muted-foreground">.40</span></div>
          </div>
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11.5px] font-medium bg-green-100 text-green-800">
            <span className="w-1 h-1 rounded-full bg-current" /> on track
          </span>
        </div>
        <svg viewBox="0 0 280 80" width="100%" height="80" className="block">
          <defs>
            <linearGradient id="lp-line" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="hsl(258 65% 56%)" />
              <stop offset="100%" stopColor="hsl(290 60% 50%)" />
            </linearGradient>
            <linearGradient id="lp-area" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="hsl(258 65% 56%)" stopOpacity="0.25" />
              <stop offset="100%" stopColor="hsl(258 65% 56%)" stopOpacity="0" />
            </linearGradient>
          </defs>
          <path d={area} fill="url(#lp-area)" />
          <path d={line} fill="none" stroke="url(#lp-line)" strokeWidth="2" strokeLinecap="round" />
          <circle cx={xs[xs.length - 1]} cy={ys[ys.length - 1]} r="4" fill="hsl(258 65% 56%)" stroke="white" strokeWidth="1.5" />
        </svg>
        <div className="flex gap-2.5 mt-3 font-mono-numeric text-[11.5px] text-muted-foreground">
          <span className="flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-sm bg-primary" /> requests
          </span>
          <span>· 2.4M this month</span>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-black/5 shadow-xl p-3.5 mt-[-10px] ml-[30px] -mr-[30px] rotate-2">
        <div className="flex items-center gap-2.5">
          <div className="w-[26px] h-[26px] rounded-md grid place-items-center text-[10px] font-semibold bg-[hsl(var(--verita-accent-soft))] text-[hsl(var(--verita-accent-soft-fg))] tracking-[0.04em]">INV</div>
          <div className="flex-1">
            <div className="text-[12.5px] font-medium">Invoice #20451</div>
            <div className="text-[11px] text-muted-foreground">Paid · Apr 2026</div>
          </div>
          <div className="font-mono-numeric text-[12.5px] font-semibold">$11,204.18</div>
        </div>
      </div>
    </div>
  )
}
