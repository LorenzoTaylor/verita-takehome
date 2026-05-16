import { useEffect, useState } from "react"
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { fetchUsage, type UsageEvent } from "@/api"

type ChartPoint = { hour: string; units: number }

function groupByHour(events: UsageEvent[]): ChartPoint[] {
  const map = new Map<string, number>()
  for (const e of events) {
    const d = new Date(e.timestamp)
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:00`
    map.set(key, (map.get(key) ?? 0) + e.units)
  }
  return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([hour, units]) => ({ hour, units }))
}

export default function Dashboard({ token }: { token: string }) {
  const [events, setEvents] = useState<UsageEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")

  useEffect(() => {
    setLoading(true)
    fetchUsage(token, { limit: 200 })
      .then((r) => setEvents(r.data))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }, [token])

  const totalUnits = events.reduce((s, e) => s + e.units, 0)
  const normalCount = events.filter((e) => e.status === "normal").length
  const lateCount = events.filter((e) => e.status === "late").length
  const chartData = groupByHour(events)

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Dashboard</h1>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Total Units (recent)</CardDescription>
            <CardTitle className="text-3xl">{totalUnits.toLocaleString()}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Normal Events</CardDescription>
            <CardTitle className="text-3xl">{normalCount.toLocaleString()}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Late Events</CardDescription>
            <CardTitle className="text-3xl">{lateCount.toLocaleString()}</CardTitle>
          </CardHeader>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Usage Over Time</CardTitle>
          <CardDescription>Units per hour (most recent 200 events)</CardDescription>
        </CardHeader>
        <CardContent>
          {loading && <p className="text-muted-foreground text-sm">Loading...</p>}
          {error && <p className="text-destructive text-sm">{error}</p>}
          {!loading && !error && (
            <ResponsiveContainer width="100%" height={280}>
              <AreaChart data={chartData}>
                <defs>
                  <linearGradient id="units" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="hsl(222.2 47.4% 11.2%)" stopOpacity={0.2} />
                    <stop offset="95%" stopColor="hsl(222.2 47.4% 11.2%)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                <XAxis dataKey="hour" tick={{ fontSize: 11 }} tickFormatter={(v) => v.slice(5, 13)} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip formatter={(v) => [typeof v === "number" ? v.toLocaleString() : v, "Units"]} />
                <Area type="monotone" dataKey="units" stroke="hsl(222.2 47.4% 11.2%)" fill="url(#units)" />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
