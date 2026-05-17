import { useEffect, useState } from "react"
import { Link } from "react-router-dom"
import {
  AreaChart, Area, XAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, BarChart, Bar, LineChart, Line,
} from "recharts"
import { Badge } from "@/components/ui/badge"
import { Icon } from "@/components/SidebarLayout"
import {
  fetchCustomers, fetchOverview, fetchAnomalies, fetchRevenueChart, fetchEventsByHour, formatMoney,
  type Customer, type OverviewStats, type AnomalyListItem, type RevenueDay, type EventsHour,
} from "@/api"

const ACCENT = "hsl(258 65% 56%)"

const TOOLTIP_PROPS = {
  contentStyle: { background: "white", border: "1px solid #e8e7e3", borderRadius: 8, boxShadow: "0 4px 12px rgba(0,0,0,0.07)", padding: "8px 12px" },
  labelStyle: { color: "#999", fontSize: 11, marginBottom: 4 },
  itemStyle: { fontSize: 15, fontWeight: 600, color: "#111" },
}

function greeting() {
  const h = new Date().getHours()
  if (h < 12) return "Good morning"
  if (h < 17) return "Good afternoon"
  return "Good evening"
}

function timeAgo(iso: string): string {
  const m = Math.floor((Date.now() - new Date(iso).getTime()) / 60000)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

function severityFor(type: string): "high" | "med" | "low" {
  if (type === "usage_spike" || type === "invoice_spike") return "high"
  if (type === "usage_drop" || type === "request_id_flood") return "med"
  return "low"
}

function detailFor(a: AnomalyListItem): string {
  if (a.value != null && a.threshold != null)
    return `${a.value.toLocaleString()} vs ${a.threshold.toLocaleString()} threshold`
  if (a.value != null) return `value: ${a.value.toLocaleString()}`
  return "—"
}

const RANGE_DAYS: Record<string, number> = { Today: 1, "7d": 7, "30d": 30, "90d": 90 }


function calcDelta(current: number, prev: number): string | undefined {
  if (prev === 0) return undefined
  const pct = ((current - prev) / Math.abs(prev)) * 100
  return (pct >= 0 ? "+" : "") + pct.toFixed(1) + "%"
}

export default function OverviewPage({ token }: { token: string }) {
  const [customers, setCustomers] = useState<Customer[]>([])
  const [stats, setStats] = useState<OverviewStats | null>(null)
  const [allAnomalies, setAllAnomalies] = useState<AnomalyListItem[]>([])
  const [chartData, setChartData] = useState<RevenueDay[]>([])
  const [eventsByHour, setEventsByHour] = useState<EventsHour[]>([])
  const [error, setError] = useState("")
  const [range, setRange] = useState("30d")

  // Customers and anomalies load once
  useEffect(() => {
    fetchCustomers(token).then(setCustomers).catch((e) => setError(e.message))
    fetchAnomalies(token).then(setAllAnomalies).catch(() => {})
    fetchRevenueChart(token, 90).then(setChartData).catch(() => {})
    fetchEventsByHour(token).then(setEventsByHour).catch(() => {})
  }, [token])

  // Stats re-fetch whenever range changes
  useEffect(() => {
    fetchOverview(token, RANGE_DAYS[range]).then(setStats).catch(() => {})
  }, [token, range])

  // Client-side anomaly filter for the selected range
  const cutoff = new Date(Date.now() - RANGE_DAYS[range] * 86_400_000).toISOString()
  const anomalies = allAnomalies.filter((a) => !a.resolved_at && a.flagged_at >= cutoff)

  const chartDays = Math.max(RANGE_DAYS[range], 7)
  const xInterval = chartDays <= 7 ? 0 : chartDays <= 30 ? 4 : 14
  const revenueData = chartData.slice(-chartDays).map((d) => ({
    date: new Date(d.date).toLocaleDateString("en-US", { month: "short", day: "numeric" }),
    revenue: d.revenue_minor / 1000,
  }))
  const yesterday = chartData.length >= 2 ? chartData[chartData.length - 2].revenue_minor : null
  const rangeLabel = range === "Today" ? "Last 24h" : `Last ${range}`

  const revenueDelta = stats ? calcDelta(stats.total_revenue_minor, stats.prev_revenue_minor) : undefined
  const customersDelta = stats ? calcDelta(stats.total_customers, stats.prev_customers) : undefined
  const anomalyDelta = stats ? calcDelta(stats.active_anomalies, stats.prev_active_anomalies) : undefined

  // Sparklines derived from real data
  const revenueSpark = chartData.slice(-12).map((d) => d.revenue_minor / 1000)

  // Bucket customers by join week (last 12 weeks), cumulative
  const customerSpark = (() => {
    const now = Date.now()
    const buckets = Array(12).fill(0)
    for (const c of customers) {
      const weeksAgo = Math.floor((now - new Date(c.created_at).getTime()) / (7 * 86_400_000))
      if (weeksAgo < 12) buckets[11 - weeksAgo]++
    }
    // make it cumulative
    for (let i = 1; i < 12; i++) buckets[i] += buckets[i - 1]
    return buckets
  })()

  // Bucket anomalies by day (last 12 days), open count
  const anomalySpark = (() => {
    const now = Date.now()
    const buckets = Array(12).fill(0)
    for (const a of allAnomalies) {
      const daysAgo = Math.floor((now - new Date(a.flagged_at).getTime()) / 86_400_000)
      if (daysAgo < 12) buckets[11 - daysAgo]++
    }
    return buckets
  })()

  const peakHour = eventsByHour.reduce((best, d) => d.events > best.events ? d : best, { h: "--", events: 0 })

  return (
    <>
      {/* Topbar */}
      <div className="h-14 flex-shrink-0 border-b border-[hsl(var(--verita-border))] bg-white flex items-center px-7 gap-3.5">
        <h1 className="text-base font-semibold tracking-tight">Overview</h1>
        <span className="text-[13px] text-muted-foreground">/</span>
        <span className="text-[13px] text-muted-foreground">All customers</span>
        <div className="ml-auto flex items-center gap-2">
          <Badge variant={anomalies.length === 0 ? "success" : "warning"} className="mr-1">
            <span className="w-1 h-1 rounded-full bg-current mr-1" />
            {anomalies.length === 0 ? "all systems normal" : `${anomalies.length} anomalies`}
          </Badge>
        </div>
      </div>

      <div className="p-7 w-full max-w-[1440px]">
        <div className="flex items-end justify-between mb-5">
          <div>
            <h2 className="text-[22px] font-semibold tracking-[-0.018em]">{greeting()}</h2>
            <p className="text-[13.5px] text-muted-foreground mt-1">
              {stats?.total_customers ?? customers.length} active customers
              {anomalies.length > 0 ? ` · ${anomalies.length} anomalies need review` : ""}
            </p>
          </div>
          <div className="flex gap-0.5 bg-[hsl(60_8%_95%)] p-0.5 rounded-md">
            {["Today", "7d", "30d", "90d"].map((r) => (
              <button
                key={r}
                onClick={() => setRange(r)}
                className={"px-2.5 py-1 text-xs font-medium rounded-[5px] transition-all " + (range === r ? "bg-white shadow-sm" : "text-muted-foreground hover:text-foreground")}
              >{r}</button>
            ))}
          </div>
        </div>

        {error && <div className="text-sm text-destructive mb-4">{error}</div>}

        {/* Stat cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5 mb-5">
          <StatCard
            label="Paid revenue"
            value={stats ? formatMoney(stats.total_revenue_minor) : "—"}
            sparkData={revenueSpark}
            delta={revenueDelta}
            positiveWhenDown={false}
          />
          <StatCard
            label="Active customers"
            value={stats?.total_customers ?? customers.length}
            sparkData={customerSpark}
            delta={customersDelta}
            positiveWhenDown={false}
          />
          <StatCard
            label="Open invoices"
            value={stats?.open_invoices ?? "—"}
            sparkData={anomalySpark}
          />
          <StatCard
            label="Open anomalies"
            value={stats?.active_anomalies ?? anomalies.length}
            sparkData={anomalySpark}
            delta={anomalyDelta}
            positiveWhenDown={true}
          />
        </div>

        {/* Charts row */}
        <div className="grid grid-cols-1 lg:grid-cols-[2fr_1fr] gap-5 mb-5">
          {/* Revenue chart */}
          <div className="bg-white rounded-xl border border-[hsl(var(--verita-border))] shadow-sm">
            <div className="flex items-center justify-between px-5 pt-4 pb-3 border-b border-[hsl(var(--verita-border))]">
              <div>
                <h3 className="text-sm font-semibold">Revenue</h3>
              </div>
            </div>
            <div className="px-5 pt-4 pb-5">
              <div className="flex gap-6 mb-4">
                <div>
                  <div className="text-[11.5px] text-muted-foreground font-medium">{rangeLabel}</div>
                  <div className="text-[22px] font-semibold tracking-[-0.02em] tabular mt-0.5">
                    {stats ? formatMoney(stats.total_revenue_minor) : "—"}
                  </div>
                </div>
                <div className="border-l border-[hsl(var(--verita-border))] pl-6">
                  <div className="text-[11.5px] text-muted-foreground font-medium">Yesterday</div>
                  <div className="text-[22px] font-semibold tracking-[-0.02em] tabular mt-0.5">
                    {yesterday !== null ? formatMoney(yesterday) : "—"}
                  </div>
                </div>
              </div>
              <ResponsiveContainer width="100%" height={220}>
                <AreaChart data={revenueData} margin={{ top: 5, right: 5, left: 5, bottom: 0 }}>
                  <defs>
                    <linearGradient id="vr-rev" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor={ACCENT} stopOpacity={0.22} />
                      <stop offset="95%" stopColor={ACCENT} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 4" stroke="hsl(var(--verita-border))" vertical={false} />
                  <XAxis dataKey="date" interval={xInterval} tick={{ fontSize: 11, fill: "hsl(var(--verita-fg-subtle))" }} tickLine={false} axisLine={false} />
                  <Tooltip {...TOOLTIP_PROPS} formatter={(v) => [`$${v}k`, "Revenue"]} />
                  <Area type="monotone" dataKey="revenue" stroke={ACCENT} strokeWidth={1.75} fill="url(#vr-rev)" animationDuration={1100} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Events by hour */}
          <div className="bg-white rounded-xl border border-[hsl(var(--verita-border))] shadow-sm">
            <div className="px-5 pt-4 pb-3 border-b border-[hsl(var(--verita-border))]">
              <h3 className="text-sm font-semibold">Events by hour</h3>
              <p className="text-[12.5px] text-muted-foreground mt-0.5">Today, UTC</p>
            </div>
            <div className="px-5 pt-4 pb-5">
              <div className="mb-2">
                <div className="text-[11.5px] text-muted-foreground font-medium">Peak hour</div>
                <div className="text-[22px] font-semibold tracking-[-0.02em] tabular mt-0.5">
                  {peakHour.events.toLocaleString()}
                </div>
                <div className="text-[12px] text-muted-foreground">
                  {peakHour.h !== "--" ? `${peakHour.h}:00 – ${String(parseInt(peakHour.h) + 1).padStart(2, "0")}:00 UTC` : "no events today"}
                </div>
              </div>
              <ResponsiveContainer width="100%" height={170}>
                <BarChart data={eventsByHour} margin={{ top: 8, right: 0, left: 5, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 4" stroke="hsl(var(--verita-border))" vertical={false} />
                  <XAxis dataKey="h" tick={{ fontSize: 10.5, fill: "hsl(var(--verita-fg-subtle))" }} tickLine={false} axisLine={false} />
                  <Tooltip {...TOOLTIP_PROPS} formatter={(v) => [Number(v).toLocaleString(), "Events"]} />
                  <Bar dataKey="events" fill={ACCENT} radius={[3, 3, 0, 0]} animationDuration={800} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>

        {/* Anomalies row */}
        <div className="bg-white rounded-xl border border-[hsl(var(--verita-border))] shadow-sm mb-5">
          <div className="flex items-center justify-between px-5 pt-4 pb-3 border-b border-[hsl(var(--verita-border))]">
            <div>
              <h3 className="text-sm font-semibold">Anomalies needing review</h3>
            </div>
            <Link to="/anomalies" className="text-primary text-[12.5px] font-medium hover:underline">
              View all {anomalies.length} →
            </Link>
          </div>
          {anomalies.length === 0 ? (
            <div className="px-5 py-8 text-center text-sm text-muted-foreground">No open anomalies.</div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 divide-x divide-[hsl(var(--verita-border))]">
              {anomalies.slice(0, 4).map((a) => {
                const sev = severityFor(a.signal_type)
                return (
                  <Link
                    key={a.id}
                    to={`/customers/${a.customer_id}`}
                    className="p-4 hover:bg-[hsl(60_8%_97%)] transition-colors block"
                  >
                    <div className="flex items-center gap-1.5 mb-1.5">
                      <Badge variant={sev === "high" ? "destructive" : sev === "med" ? "warning" : "secondary"} className="text-[10.5px]">
                        <span className="w-1 h-1 rounded-full bg-current mr-1" />{sev}
                      </Badge>
                      <span className="font-mono-numeric text-[11px] text-[hsl(var(--verita-fg-subtle))]">{a.id.slice(0, 8)}</span>
                    </div>
                    <div className="font-medium text-[13.5px] mb-0.5">{a.customer_name}</div>
                    <div className="text-[12px] text-muted-foreground">
                      <span className="font-mono-numeric">{a.signal_type}</span> · {detailFor(a)}
                    </div>
                    <div className="text-[11.5px] text-[hsl(var(--verita-fg-subtle))] mt-1.5">{timeAgo(a.flagged_at)}</div>
                  </Link>
                )
              })}
            </div>
          )}
        </div>

        {/* Customers table */}
        <div className="bg-white rounded-xl border border-[hsl(var(--verita-border))] shadow-sm">
          <div className="flex items-center justify-between px-5 pt-4 pb-3 border-b border-[hsl(var(--verita-border))]">
            <div>
              <h3 className="text-sm font-semibold">Customers</h3>
              <p className="text-[12.5px] text-muted-foreground mt-0.5">{customers.length} total</p>
            </div>
            <Link to="/customers" className="text-primary text-[12.5px] font-medium hover:underline">View all →</Link>
          </div>
          <table className="w-full text-[13.5px]">
            <thead>
              <tr className="bg-[hsl(60_8%_97%)] border-b border-[hsl(var(--verita-border))]">
                <th className="text-left px-5 py-2.5 text-xs font-medium text-muted-foreground">Customer</th>
                <th className="text-left px-5 py-2.5 text-xs font-medium text-muted-foreground">ID</th>
                <th className="text-left px-5 py-2.5 text-xs font-medium text-muted-foreground">Email</th>
                <th className="text-left px-5 py-2.5 text-xs font-medium text-muted-foreground">Joined</th>
                <th className="text-right px-5 py-2.5 text-xs font-medium text-muted-foreground"></th>
              </tr>
            </thead>
            <tbody>
              {customers.slice(0, 8).map((c) => {
                const initials = c.name.split(" ").map((w) => w[0]).slice(0, 2).join("").toUpperCase()
                const hue = (c.id.charCodeAt(0) * 7) % 360
                return (
                  <tr key={c.id} className="border-b last:border-0 border-[hsl(var(--verita-border))] hover:bg-[hsl(60_8%_97%)] group">
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-2.5">
                        <div
                          className="w-[26px] h-[26px] rounded-md grid place-items-center text-[11px] font-semibold tracking-tight"
                          style={{ background: `hsl(${hue} 50% 92%)`, color: `hsl(${hue} 40% 35%)` }}
                        >{initials || "?"}</div>
                        <span className="font-medium">{c.name}</span>
                      </div>
                    </td>
                    <td className="px-5 py-3 font-mono-numeric text-muted-foreground text-[12.5px]">{c.id.slice(0, 8)}</td>
                    <td className="px-5 py-3 text-muted-foreground">{c.email}</td>
                    <td className="px-5 py-3 text-muted-foreground text-[12.5px]">{new Date(c.created_at).toLocaleDateString()}</td>
                    <td className="px-5 py-3 text-right">
                      <Link to={`/customers/${c.id}`} className="text-primary text-[12.5px] font-medium hover:underline opacity-70 group-hover:opacity-100">View →</Link>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </>
  )
}

function StatCard({ label, value, sparkData, delta, positiveWhenDown = false }: {
  label: string; value: string | number; sparkData: number[]
  delta?: string; positiveWhenDown?: boolean
}) {
  const isDown = delta ? (delta.startsWith("-") || delta.startsWith("−")) : false
  const isGreen = delta ? (positiveWhenDown ? isDown : !isDown) : false
  return (
    <div className="bg-white rounded-xl border border-[hsl(var(--verita-border))] shadow-sm p-4">
      <div className="text-xs font-medium text-muted-foreground">{label}</div>
      <div className="flex items-end justify-between gap-2 mt-1.5">
        <div className="text-[26px] font-semibold tracking-[-0.022em] tabular">{value}</div>
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
