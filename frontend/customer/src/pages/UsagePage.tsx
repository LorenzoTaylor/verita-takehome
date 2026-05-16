import { useEffect, useState } from "react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { fetchUsage, type UsageEvent, type UsageFilters } from "@/api"

export default function UsagePage({ token }: { token: string }) {
  const [events, setEvents] = useState<UsageEvent[]>([])
  const [cursor, setCursor] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const [filters, setFilters] = useState<UsageFilters>({})
  const [pending, setPending] = useState<UsageFilters>({})

  function load(filters: UsageFilters, append = false) {
    setLoading(true)
    setError("")
    fetchUsage(token, { ...filters, limit: 50 })
      .then((r) => {
        setEvents((prev) => (append ? [...prev, ...r.data] : r.data))
        setCursor(r.next_cursor)
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }

  useEffect(() => { load({}) }, [token])

  function applyFilters() {
    setFilters(pending)
    load(pending)
  }

  function loadMore() {
    if (!cursor) return
    load({ ...filters, cursor }, true)
  }

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Usage Events</h1>

      {/* Filters */}
      <div className="flex flex-wrap gap-2 items-end">
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">From</label>
          <Input type="datetime-local" className="h-9 text-sm w-48"
            onChange={(e) => setPending((p) => ({ ...p, from: e.target.value ? new Date(e.target.value).toISOString() : undefined }))} />
        </div>
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">To</label>
          <Input type="datetime-local" className="h-9 text-sm w-48"
            onChange={(e) => setPending((p) => ({ ...p, to: e.target.value ? new Date(e.target.value).toISOString() : undefined }))} />
        </div>
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">API Key ID</label>
          <Input placeholder="uuid..." className="h-9 text-sm w-64 font-mono"
            onChange={(e) => setPending((p) => ({ ...p, api_key_id: e.target.value || undefined }))} />
        </div>
        <Button size="sm" onClick={applyFilters}>Apply</Button>
      </div>

      {error && <p className="text-destructive text-sm">{error}</p>}

      {/* Table */}
      <div className="rounded-md border overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-b bg-muted/50">
            <tr>
              <th className="text-left px-4 py-3 font-medium text-muted-foreground">Timestamp</th>
              <th className="text-left px-4 py-3 font-medium text-muted-foreground">Endpoint</th>
              <th className="text-right px-4 py-3 font-medium text-muted-foreground">Units</th>
              <th className="text-left px-4 py-3 font-medium text-muted-foreground">Status</th>
              <th className="text-left px-4 py-3 font-medium text-muted-foreground">API Key ID</th>
            </tr>
          </thead>
          <tbody>
            {events.length === 0 && !loading && (
              <tr><td colSpan={5} className="text-center py-8 text-muted-foreground">No events found.</td></tr>
            )}
            {events.map((e) => (
              <tr key={e.id} className="border-b last:border-0 hover:bg-muted/30 transition-colors">
                <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">
                  {new Date(e.timestamp).toLocaleString()}
                </td>
                <td className="px-4 py-3 font-mono text-xs">{e.endpoint}</td>
                <td className="px-4 py-3 text-right tabular-nums">{e.units.toLocaleString()}</td>
                <td className="px-4 py-3">
                  <Badge variant={e.status === "normal" ? "success" : "warning"}>
                    {e.status}
                  </Badge>
                </td>
                <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                  {e.api_key_id.slice(0, 8)}…
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex justify-center gap-2">
        {loading && <p className="text-sm text-muted-foreground">Loading...</p>}
        {cursor && !loading && (
          <Button variant="outline" size="sm" onClick={loadMore}>Load more</Button>
        )}
      </div>
    </div>
  )
}
