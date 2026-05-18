import { useEffect, useState } from "react"
import { Link } from "react-router-dom"
import { fetchAnomaliesPage, type AnomalyListItem } from "@/api"

type CustomerGroup = {
  customer_id: string
  customer_name: string
  signals: string[]
  latest: string
}

function CheckIcon() {
  return (
    <svg className="w-5 h-5 text-green-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round">
      <path d="m5 12 5 5L20 7" />
    </svg>
  )
}

function AlertIcon() {
  return (
    <svg className="w-5 h-5 text-amber-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round">
      <path d="M10.3 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
      <path d="M12 9v4M12 17h.01" />
    </svg>
  )
}

export default function AnomaliesPage({ token }: { token: string }) {
  const [anomalies, setAnomalies] = useState<AnomalyListItem[]>([])
  const [cursor, setCursor] = useState<string | null>(null)
  const [total, setTotal] = useState<number | null>(null)
  const [hasMore, setHasMore] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")

  useEffect(() => {
    fetchAnomaliesPage(token)
      .then((res) => {
        setAnomalies(res.data)
        setCursor(res.next_cursor)
        setTotal(res.total)
        setHasMore(res.next_cursor !== null)
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }, [token])

  async function loadMore() {
    if (!cursor) return
    setLoadingMore(true)
    try {
      const res = await fetchAnomaliesPage(token, cursor)
      setAnomalies((prev) => [...prev, ...res.data])
      setCursor(res.next_cursor)
      setHasMore(res.next_cursor !== null)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoadingMore(false)
    }
  }

  const open = anomalies.filter((a) => !a.resolved_at)

  const byCustomer = open.reduce<Record<string, CustomerGroup>>((acc, a) => {
    if (!acc[a.customer_id]) {
      acc[a.customer_id] = { customer_id: a.customer_id, customer_name: a.customer_name, signals: [], latest: a.flagged_at }
    }
    if (!acc[a.customer_id].signals.includes(a.signal_type)) {
      acc[a.customer_id].signals.push(a.signal_type)
    }
    if (a.flagged_at > acc[a.customer_id].latest) {
      acc[a.customer_id].latest = a.flagged_at
    }
    return acc
  }, {})

  const affected = Object.values(byCustomer).sort((a, b) => b.latest.localeCompare(a.latest))
  const allClear = !loading && !error && affected.length === 0

  return (
    <>
      <div className="h-14 flex-shrink-0 border-b border-[hsl(var(--verita-border))] bg-white flex items-center px-7 gap-3.5">
        <h1 className="text-base font-semibold tracking-tight">Anomalies</h1>
        {!loading && !error && total !== null && (
          <span className="text-[13px] text-muted-foreground">
            {hasMore ? `1–${anomalies.length} of ${total}` : `${total} total`}
          </span>
        )}
      </div>

      <div className="p-7 w-full space-y-5">
        {error && <p className="text-sm text-destructive">{error}</p>}

        {/* Status banner */}
        <div className={`rounded-xl border shadow-sm px-6 py-5 flex items-center gap-4 bg-white ${
          loading ? "border-[hsl(var(--verita-border))]"
          : allClear ? "border-green-200"
          : "border-amber-300"
        }`}>
          <div className="flex-shrink-0">
            {!loading && (allClear ? <CheckIcon /> : <AlertIcon />)}
          </div>
          <div>
            <div className={`text-sm font-semibold ${
              loading ? "text-foreground"
              : allClear ? "text-green-800"
              : "text-foreground"
            }`}>
              {loading ? "Checking…"
                : allClear ? "All clear"
                : `${affected.length} customer${affected.length !== 1 ? "s" : ""} with open anomalies`}
            </div>
            {(loading || allClear) && (
              <div className={`text-[12.5px] mt-0.5 ${loading ? "text-muted-foreground" : "text-green-700"}`}>
                {loading ? "Loading anomaly data" : "No unresolved anomaly flags"}
              </div>
            )}
          </div>
        </div>

        {/* Affected customers */}
        {affected.length > 0 && (
          <div className="bg-white rounded-xl border border-[hsl(var(--verita-border))] shadow-sm overflow-hidden">
            {affected.map((c, i) => (

              <div
                key={c.customer_id}
                className={`px-5 py-4 flex items-center gap-4 ${i < affected.length - 1 ? "border-b border-[hsl(var(--verita-border))]" : ""}`}
              >
                <div className="flex-1 min-w-0">
                  <Link to={`/customers/${c.customer_id}`} className="font-medium text-primary hover:underline">
                    {c.customer_name}
                  </Link>
                  <div className="flex flex-wrap gap-1.5 mt-1.5">
                    {c.signals.map((sig) => (
                      <span key={sig} className="inline-flex items-center px-2 py-px rounded text-[11px] font-mono text-amber-700 border border-amber-300">
                        {sig}
                      </span>
                    ))}
                  </div>
                </div>
                <div className="text-[12px] text-muted-foreground flex-shrink-0">
                  {new Date(c.latest).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                </div>
              </div>
            ))}
            {hasMore && (
              <div className="px-5 py-3 border-t border-[hsl(var(--verita-border))] flex justify-center">
                <button onClick={loadMore} disabled={loadingMore} className="text-sm text-muted-foreground hover:text-foreground disabled:opacity-50">
                  {loadingMore ? "Loading…" : "Load more"}
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </>
  )
}
