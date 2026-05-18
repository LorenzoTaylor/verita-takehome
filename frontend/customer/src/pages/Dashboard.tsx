import { useEffect, useState } from "react"
import { Link } from "react-router-dom"
import { AreaChart, Area, XAxis, CartesianGrid, Tooltip, ResponsiveContainer, Line, LineChart } from "recharts"
import { Badge } from "@/components/ui/badge"
import { Icon } from "@/components/SidebarLayout"
import { fetchUsage, fetchUsageStats, fetchInvoices, fetchMe, formatMoney, formatPeriod, type UsageEvent, type UsageStats, type DailyUsage, type Invoice, type Me } from "@/api"

const ACCENT = "hsl(258 65% 56%)"

const TOOLTIP_PROPS = {
  contentStyle: { background: "white", border: "1px solid #e8e7e3", borderRadius: 8, boxShadow: "0 4px 12px rgba(0,0,0,0.07)", padding: "8px 12px" },
  labelStyle: { color: "#999", fontSize: 11, marginBottom: 4 },
  itemStyle: { fontSize: 15, fontWeight: 600, color: "#111" },
}

function calcDelta(current: number, prev: number): string | undefined {
  if (prev === 0) return undefined
  const pct = ((current - prev) / Math.abs(prev)) * 100
  return (pct >= 0 ? "+" : "") + pct.toFixed(1) + "%"
}

function bucketDaily(daily: DailyUsage[], getValue: (d: DailyUsage) => number, buckets = 12): number[] {
  if (daily.length === 0) return Array(buckets).fill(0)
  const result = Array(buckets).fill(0)
  daily.forEach((d, i) => {
    const idx = Math.min(Math.floor((i / daily.length) * buckets), buckets - 1)
    result[idx] += getValue(d)
  })
  return result
}

export default function Dashboard({ token }: { token: string }) {
  const [stats, setStats] = useState<UsageStats | null>(null)
  const [prevStats, setPrevStats] = useState<UsageStats | null>(null)
  const [recentEvents, setRecentEvents] = useState<UsageEvent[]>([])
  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [me, setMe] = useState<Me | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [range, setRange] = useState<"7d" | "30d" | "90d" | "MTD">("30d")

  useEffect(() => {
    fetchMe(token).then(setMe).catch(() => {})
  }, [token])

  useEffect(() => {
    setLoading(true)
    const from = rangeFrom(range)
    const prev = prevRangeFrom(range)
    Promise.all([
      fetchUsageStats(token, { from }).then(setStats),
      fetchUsageStats(token, prev).then(setPrevStats),
      fetchUsage(token, { limit: 7 }).then((r) => setRecentEvents(r.data)),
      fetchInvoices(token).then(setInvoices).catch(() => setInvoices([])),
    ])
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }, [token, range])

  const daily = stats?.daily ?? []

  const totalUnits = stats?.total_units ?? 0
  const normalCount = (stats?.event_count ?? 0) - (stats?.late_count ?? 0)
  const lateCount = stats?.late_count ?? 0
  const endpoints = stats?.endpoints_used ?? 0

  const prevTotalUnits = prevStats?.total_units ?? 0
  const prevNormalCount = (prevStats?.event_count ?? 0) - (prevStats?.late_count ?? 0)
  const prevLateCount = prevStats?.late_count ?? 0
  const prevEndpoints = prevStats?.endpoints_used ?? 0

  const unitsDelta = calcDelta(totalUnits, prevTotalUnits)
  const normalDelta = calcDelta(normalCount, prevNormalCount)
  const lateDelta = calcDelta(lateCount, prevLateCount)
  const endpointsDelta = calcDelta(endpoints, prevEndpoints)

  const unitsSpark = bucketDaily(daily, (d) => d.units)
  const normalSpark = bucketDaily(daily, (d) => d.events - d.late_events)
  const lateSpark = bucketDaily(daily, (d) => d.late_events)
  const endpointSpark = Array(12).fill(endpoints)

  const chartData = daily.map((d) => ({ date: d.date, units: d.units }))
  const peakDay = daily.reduce((best, d) => (d.units > best.units ? d : best), { date: "—", units: 0 })

  const recentInvoices = invoices.slice(0, 3)
  const openInvoice = invoices.find((i) => i.status !== "paid")
  const firstName = me?.name?.split(" ")[0] ?? "there"

  return (
    <>
      {/* Topbar */}
      <div className="h-14 flex-shrink-0 border-b border-[hsl(var(--verita-border))] bg-white flex items-center px-7 gap-3.5">
        <h1 className="text-base font-semibold tracking-tight">Dashboard</h1>
      </div>

      <div className="p-7 w-full">
        {/* Page head */}
        <div className="flex items-end justify-between mb-5">
          <div>
            <h2 className="text-[22px] font-semibold tracking-[-0.018em]">Welcome back, {firstName}</h2>
          </div>
          <div className="flex gap-0.5 bg-[hsl(60_8%_95%)] p-0.5 rounded-md">
            {(["7d", "30d", "90d", "MTD"] as const).map((r) => (
              <button key={r} onClick={() => setRange(r)}
                className={
                  "px-2.5 py-1 text-xs font-medium rounded-[5px] transition-all " +
                  (range === r ? "bg-white text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")
                }>{r}</button>
            ))}
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5 mb-5">
          <StatCard label="Total units" value={totalUnits} sparkData={unitsSpark} delta={unitsDelta} positiveWhenDown={false} />
          <StatCard label="Normal events" value={normalCount} sparkData={normalSpark} delta={normalDelta} positiveWhenDown={false} />
          <StatCard label="Late events" value={lateCount} sparkData={lateSpark} delta={lateDelta} positiveWhenDown={true} />
          <StatCard label="Endpoints used" value={endpoints} sparkData={endpointSpark} delta={endpointsDelta} positiveWhenDown={false} />
        </div>

        {/* Main chart */}
        <div className="bg-white rounded-xl border border-[hsl(var(--verita-border))] shadow-sm mb-5">
          <div className="flex items-center justify-between px-5 pt-4 pb-3 border-b border-[hsl(var(--verita-border))]">
            <div>
              <h3 className="text-sm font-semibold">Usage over time</h3>
                </div>
          </div>
          <div className="px-5 pt-4 pb-5">
            <div className="flex gap-6 mb-4">
              <div>
                <div className="text-[11.5px] text-muted-foreground font-medium">Busiest day</div>
                <div className="text-[22px] font-semibold tracking-[-0.02em] tabular mt-0.5">{peakDay.units.toLocaleString()}</div>
                <div className="text-xs text-muted-foreground mt-0.5">{peakDay.date !== "—" ? peakDay.date : "—"}</div>
              </div>
            </div>

            {loading && <div className="h-[240px] grid place-items-center text-sm text-muted-foreground">Loading…</div>}
            {error && <div className="h-[240px] grid place-items-center text-sm text-destructive">{error}</div>}
            {!loading && !error && (
              <ResponsiveContainer width="100%" height={240}>
                <AreaChart data={chartData} margin={{ top: 5, right: 5, left: 5, bottom: 0 }}>
                  <defs>
                    <linearGradient id="vr-units" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor={ACCENT} stopOpacity={0.22} />
                      <stop offset="95%" stopColor={ACCENT} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 4" stroke="hsl(var(--verita-border))" vertical={false} />
                  <XAxis dataKey="date" tick={{ fontSize: 11, fill: "hsl(var(--verita-fg-subtle))" }}
                    tickFormatter={(v) => v.slice(5)} tickLine={false} axisLine={false} />
                  <Tooltip {...TOOLTIP_PROPS} formatter={(v) => [typeof v === "number" ? v.toLocaleString() : v, "Units"]} />
                  <Area type="monotone" dataKey="units" stroke={ACCENT} strokeWidth={1.75} fill="url(#vr-units)"
                    animationDuration={1100} animationEasing="ease-out" />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        {/* Recent events + invoices */}
        <div className="grid grid-cols-1 lg:grid-cols-[1.4fr_1fr] gap-5">
          <div className="bg-white rounded-xl border border-[hsl(var(--verita-border))] shadow-sm">
            <div className="flex items-center justify-between px-5 pt-4 pb-3 border-b border-[hsl(var(--verita-border))]">
              <div>
                <h3 className="text-sm font-semibold">Recent events</h3>
              </div>
              <Link to="/usage" className="text-primary text-[12.5px] font-medium hover:underline">View all →</Link>
            </div>
            <table className="w-full text-[13.5px]">
              <thead>
                <tr className="bg-[hsl(60_8%_97%)] border-b border-[hsl(var(--verita-border))]">
                  <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground">Event</th>
                  <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground">Endpoint</th>
                  <th className="text-right px-4 py-2.5 text-xs font-medium text-muted-foreground">Units</th>
                  <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground">Status</th>
                  <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground">Time</th>
                </tr>
              </thead>
              <tbody>
                {recentEvents.length === 0 && !loading && (
                  <tr><td colSpan={5} className="text-center py-8 text-muted-foreground">No events yet.</td></tr>
                )}
                {recentEvents.map((e) => (
                  <tr key={e.id} className="border-b last:border-0 border-[hsl(var(--verita-border))] hover:bg-[hsl(60_8%_97%)] transition-colors">
                    <td className="px-4 py-3 font-mono-numeric text-[12.5px]">{e.id.slice(0, 10)}</td>
                    <td className="px-4 py-3 font-mono-numeric text-[12.5px]">{e.endpoint}</td>
                    <td className="px-4 py-3 text-right tabular font-mono-numeric">{e.units}</td>
                    <td className="px-4 py-3">
                      <Badge variant={e.status === "normal" ? "success" : "warning"}>
                        {e.status}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">{relativeTime(e.timestamp)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="bg-white rounded-xl border border-[hsl(var(--verita-border))] shadow-sm">
            <div className="flex items-center justify-between px-5 pt-4 pb-3 border-b border-[hsl(var(--verita-border))]">
              <div>
                <h3 className="text-sm font-semibold">Recent invoices</h3>
              </div>
              <Link to="/invoices" className="text-primary text-[12.5px] font-medium hover:underline">All invoices →</Link>
            </div>
            <div>
              {recentInvoices.map((inv) => (
                <div key={inv.id} className="flex items-center gap-3.5 px-5 py-3.5 border-b last:border-0 border-[hsl(var(--verita-border))] hover:bg-[hsl(60_8%_97%)] cursor-pointer transition-colors">
                  <div className="w-[34px] h-[34px] rounded-md bg-[hsl(60_8%_95%)] grid place-items-center text-muted-foreground">
                    <Icon name="invoice" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-[13.5px] font-medium">Invoice #{inv.id.slice(0, 8)}</div>
                    <div className="text-xs text-muted-foreground">{formatPeriod(inv.period_start, inv.period_end)}</div>
                  </div>
                  <div className="text-right">
                    <div className="font-mono-numeric text-[13.5px] font-semibold">{formatMoney(inv.total_minor)}</div>
                    <Badge variant={inv.status === "paid" ? "success" : "info"} className="mt-0.5">
                      {inv.status}
                    </Badge>
                  </div>
                </div>
              ))}
              {openInvoice && (
                <div className="flex items-center gap-3.5 px-5 py-3.5">
                  <div className="w-[34px] h-[34px] rounded-md bg-[hsl(var(--verita-accent-soft))] grid place-items-center text-[hsl(var(--verita-accent-soft-fg))]">
                    <Icon name="invoice" />
                  </div>
                  <div className="flex-1">
                    <div className="text-[13.5px] font-medium">Current period</div>
                    <div className="text-xs text-muted-foreground">{formatPeriod(openInvoice.period_start, openInvoice.period_end)}</div>
                  </div>
                  <div className="text-right">
                    <div className="font-mono-numeric text-[13.5px] font-semibold">{formatMoney(openInvoice.total_minor)}</div>
                    <Badge className="mt-0.5 bg-[hsl(var(--verita-accent-soft))] text-[hsl(var(--verita-accent-soft-fg))] border-transparent">
                      open
                    </Badge>
                  </div>
                </div>
              )}
              {recentInvoices.length === 0 && !openInvoice && (
                <div className="px-5 py-8 text-center text-sm text-muted-foreground">No invoices yet.</div>
              )}
            </div>
          </div>
        </div>
      </div>
    </>
  )
}

function StatCard({ label, value, sparkData, delta, positiveWhenDown = false }: {
  label: string; value: number; sparkData: number[]; delta?: string; positiveWhenDown?: boolean
}) {
  const isDown = delta ? (delta.startsWith("-") || delta.startsWith("−")) : false
  const isGreen = delta ? (positiveWhenDown ? isDown : !isDown) : false
  return (
    <div className="bg-white rounded-xl border border-[hsl(var(--verita-border))] shadow-sm p-4">
      <div className="text-xs font-medium text-muted-foreground">{label}</div>
      <div className="flex items-end justify-between gap-2 mt-1.5">
        <div className="text-[26px] font-semibold tracking-[-0.022em] tabular">{value.toLocaleString()}</div>
        <ResponsiveContainer width={72} height={26}>
          <LineChart data={sparkData.map((v, i) => ({ i, v }))}>
            <Line type="monotone" dataKey="v" stroke={ACCENT} strokeWidth={1.5} dot={false} animationDuration={900} />
          </LineChart>
        </ResponsiveContainer>
      </div>
      {delta && (
        <div className="text-xs text-muted-foreground mt-1.5 flex items-center gap-1.5">
          <span className={isGreen ? "text-green-700 font-medium" : "text-red-700 font-medium"}>{delta}</span>
          <span>vs. previous period</span>
        </div>
      )}
    </div>
  )
}

function rangeFrom(range: "7d" | "30d" | "90d" | "MTD"): string {
  const now = new Date()
  if (range === "MTD") return new Date(now.getFullYear(), now.getMonth(), 1).toISOString()
  const days = range === "7d" ? 7 : range === "30d" ? 30 : 90
  return new Date(now.getTime() - days * 86400_000).toISOString()
}

function prevRangeFrom(range: "7d" | "30d" | "90d" | "MTD"): { from: string; to: string } {
  const now = new Date()
  if (range === "MTD") {
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1)
    const startOfPrevMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1)
    return { from: startOfPrevMonth.toISOString(), to: startOfMonth.toISOString() }
  }
  const days = range === "7d" ? 7 : range === "30d" ? 30 : 90
  const to = new Date(now.getTime() - days * 86400_000).toISOString()
  const from = new Date(now.getTime() - days * 2 * 86400_000).toISOString()
  return { from, to }
}

function relativeTime(iso: string): string {
  const diff = (Date.now() - new Date(iso).getTime()) / 1000
  if (diff < 60) return `${Math.floor(diff)}s ago`
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  return `${Math.floor(diff / 86400)}d ago`
}
