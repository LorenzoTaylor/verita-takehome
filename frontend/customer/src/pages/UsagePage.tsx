import { useEffect, useState } from "react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import PageLayout from "@/components/PageLayout"
import { fetchUsage, type UsageEvent, type UsageFilters } from "@/api"

export default function UsagePage({ token }: { token: string }) {
  const [events, setEvents] = useState<UsageEvent[]>([])
  const [cursor, setCursor] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const [filters, setFilters] = useState<UsageFilters>({})
  const [pending, setPending] = useState<UsageFilters>({})

  function load(f: UsageFilters, append = false) {
    setLoading(true)
    setError("")
    fetchUsage(token, { ...f, limit: 50 })
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
    <PageLayout
      title="Usage"
      actions={
        <div className="flex items-center gap-2">
          <Input
            type="date"
            className="h-8 text-xs w-36"
            onChange={(e) => setPending((p) => ({ ...p, from: e.target.value ? new Date(e.target.value).toISOString() : undefined }))}
          />
          <span className="text-xs text-muted-foreground">–</span>
          <Input
            type="date"
            className="h-8 text-xs w-36"
            onChange={(e) => setPending((p) => ({ ...p, to: e.target.value ? new Date(e.target.value).toISOString() : undefined }))}
          />
          <Input
            placeholder="API key ID…"
            className="h-8 text-xs w-44 font-mono"
            onChange={(e) => setPending((p) => ({ ...p, api_key_id: e.target.value || undefined }))}
          />
          <Button size="sm" className="h-8" onClick={applyFilters}>Apply</Button>
        </div>
      }
    >
      {error && <p className="text-sm text-destructive mb-4">{error}</p>}

      <div className="bg-white rounded-xl border border-[hsl(var(--verita-border))] shadow-sm overflow-hidden">
        <table className="w-full text-[13.5px]">
          <thead>
            <tr className="bg-[hsl(60_8%_97%)] border-b border-[hsl(var(--verita-border))]">
              <th className="text-left px-5 py-2.5 text-xs font-medium text-muted-foreground">Timestamp</th>
              <th className="text-left px-5 py-2.5 text-xs font-medium text-muted-foreground">Endpoint</th>
              <th className="text-right px-5 py-2.5 text-xs font-medium text-muted-foreground">Units</th>
              <th className="text-left px-5 py-2.5 text-xs font-medium text-muted-foreground">Status</th>
              <th className="text-left px-5 py-2.5 text-xs font-medium text-muted-foreground">API Key</th>
            </tr>
          </thead>
          <tbody>
            {events.length === 0 && !loading && (
              <tr>
                <td colSpan={5} className="text-center py-10 text-sm text-muted-foreground">No events found.</td>
              </tr>
            )}
            {events.map((e) => (
              <tr key={e.id} className="border-b last:border-0 border-[hsl(var(--verita-border))]">
                <td className="px-5 py-3 text-[12.5px] text-muted-foreground whitespace-nowrap">
                  {new Date(e.timestamp).toLocaleString()}
                </td>
                <td className="px-5 py-3 font-mono-numeric text-xs">{e.endpoint}</td>
                <td className="px-5 py-3 text-right font-mono-numeric">{e.units.toLocaleString()}</td>
                <td className="px-5 py-3">
                  <Badge variant={e.status === "normal" ? "success" : "warning"}>
                    <span className="w-1 h-1 rounded-full bg-current mr-1" />{e.status}
                  </Badge>
                </td>
                <td className="px-5 py-3 font-mono-numeric text-xs text-muted-foreground">
                  {e.api_key_id.slice(0, 8)}…
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {(loading || cursor) && (
        <div className="flex justify-center mt-4">
          {loading && <p className="text-sm text-muted-foreground">Loading…</p>}
          {cursor && !loading && (
            <Button variant="outline" size="sm" onClick={loadMore}>Load more</Button>
          )}
        </div>
      )}
    </PageLayout>
  )
}
