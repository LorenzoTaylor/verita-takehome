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
      const token = await login(email, password)
      onLogin(token)
      navigate("/customers")
    } catch {
      setError("Invalid credentials.")
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex bg-white">
      {/* Left: form */}
      <div className="flex-1 flex items-center justify-center p-10 grain grain-light">
        <div className="w-full max-w-[400px]">
          <div className="mb-9">
            <span className="text-lg font-semibold tracking-tight">Verita AI</span>
          </div>

          <h1 className="text-[26px] font-semibold tracking-[-0.025em] mb-7">Sign in to operations</h1>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-[12.5px] font-medium">Email</label>
              <Input type="email" placeholder="you@verita.com" value={email}
                onChange={(e) => setEmail(e.target.value)} autoFocus />
            </div>
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label className="text-[12.5px] font-medium">Password</label>
                <a className="text-[12.5px] font-medium text-primary hover:underline cursor-pointer">Reset</a>
              </div>
              <Input type="password" placeholder="••••••••" value={password}
                onChange={(e) => setPassword(e.target.value)} />
            </div>

            {error && (
              <div className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md bg-destructive/10 text-destructive text-xs font-medium">
                {error}
              </div>
            )}

            <Button type="submit" size="lg" className="w-full" disabled={loading || !email || !password}>
              {loading ? "Verifying…" : "Continue"}
            </Button>

          </form>
        </div>
      </div>

      {/* Right: liquid gradient panel (deep teal scheme for ops) */}
      <div className="flex-1 hidden md:block relative border-l border-border">
        <LiquidGradient scheme={3} className="absolute inset-0">
          <div>
            <div className="font-mono-numeric text-[11.5px] tracking-[0.12em] uppercase font-medium text-white/75 mb-3">
              verita · ops console
            </div>
            <h2 className="text-[32px] font-semibold tracking-[-0.03em] leading-[1.05] max-w-[360px]">
              Every credit, override, and refund — logged and traceable.
            </h2>
          </div>

          <div className="flex-1 flex items-center justify-center py-5">
            <OpsStatusCard />
          </div>

          <div />
        </LiquidGradient>
      </div>
    </div>
  )
}

function OpsStatusCard() {
  const today = new Date().toLocaleDateString("en-US", { month: "short", day: "numeric" })
  const rows = [
    { lab: "Active customers", val: "248",   delta: "+12" },
    { lab: "Open anomalies",   val: "7",     delta: "−4" },
    { lab: "Invoices today",   val: "92",    delta: "+8" },
    { lab: "Webhook success",  val: "99.98%", delta: "SLO" },
  ]
  return (
    <div className="w-[320px]">
      <div className="bg-white rounded-2xl p-5 text-foreground border border-black/5 shadow-[0_30px_80px_-20px_rgba(15,10,50,0.35),0_12px_30px_-10px_rgba(15,10,50,0.18)]">
        <div className="flex items-center justify-between mb-2.5">
          <div className="text-[11px] uppercase tracking-[0.06em] font-medium text-muted-foreground">
            This shift · {today}
          </div>
          <span className="inline-flex items-center gap-1 font-mono-numeric text-[10.5px] font-medium tracking-[0.04em] text-green-700">
            <span className="w-1.5 h-1.5 rounded-full bg-green-600" />
            LIVE
          </span>
        </div>
        {rows.map((r, i) => (
          <div key={r.lab}
            className={"flex items-baseline justify-between py-2.5 " + (i === 0 ? "" : "border-t border-[hsl(var(--verita-border))]")}>
            <span className="text-[13px] text-muted-foreground">{r.lab}</span>
            <div className="flex items-baseline gap-2">
              <span className="font-mono-numeric text-base font-semibold tracking-tight">{r.val}</span>
              <span className="font-mono-numeric text-[11px] text-[hsl(var(--verita-fg-subtle))] min-w-[28px] text-right">{r.delta}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
