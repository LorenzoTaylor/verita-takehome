import { useEffect, useState } from "react"
import { Link } from "react-router-dom"
import { Button } from "@/components/ui/button"
import { fetchCreditsPage, fetchCustomersPage, formatMoney, type CreditListItem, type Customer } from "@/api"
import IssueCreditDialog from "@/components/IssueCreditDialog"

export default function CreditsPage({ token }: { token: string }) {
  const [credits, setCredits] = useState<CreditListItem[]>([])
  const [cursor, setCursor] = useState<string | null>(null)
  const [total, setTotal] = useState<number | null>(null)
  const [hasMore, setHasMore] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [customers, setCustomers] = useState<Customer[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [creditOpen, setCreditOpen] = useState(false)
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null)
  const [pickOpen, setPickOpen] = useState(false)

  function reload() {
    fetchCreditsPage(token).then((res) => {
      setCredits(res.data)
      setCursor(res.next_cursor)
      setTotal(res.total)
      setHasMore(res.next_cursor !== null)
    }).catch(() => {})
  }

  useEffect(() => {
    fetchCreditsPage(token)
      .then((res) => {
        setCredits(res.data)
        setCursor(res.next_cursor)
        setTotal(res.total)
        setHasMore(res.next_cursor !== null)
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
    fetchCustomersPage(token).then((res) => setCustomers(res.data)).catch(() => {})
  }, [token])

  async function loadMore() {
    if (!cursor) return
    setLoadingMore(true)
    try {
      const res = await fetchCreditsPage(token, cursor)
      setCredits((prev) => [...prev, ...res.data])
      setCursor(res.next_cursor)
      setHasMore(res.next_cursor !== null)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoadingMore(false)
    }
  }

  function openIssueCredit() {
    setSelectedCustomer(null)
    setPickOpen(true)
  }

  function pickCustomer(c: Customer) {
    setSelectedCustomer(c)
    setPickOpen(false)
    setCreditOpen(true)
  }

  return (
    <>
      <div className="h-14 flex-shrink-0 border-b border-[hsl(var(--verita-border))] bg-white flex items-center px-7 gap-3.5">
        <h1 className="text-base font-semibold tracking-tight">Credits</h1>
        {!loading && !error && (
          <span className="text-[13px] text-muted-foreground">
            {hasMore ? `1–${credits.length} of ${total}` : `${total ?? credits.length} total`}
          </span>
        )}
        <div className="ml-auto">
          <Button size="sm" className="h-8" onClick={openIssueCredit}>
            <span className="mr-1">+</span> Issue credit
          </Button>
        </div>
      </div>

      <div className="p-7 w-full">
        <div className="bg-white rounded-xl border border-[hsl(var(--verita-border))] shadow-sm overflow-hidden">
          {loading && <div className="px-5 py-10 text-center text-sm text-muted-foreground">Loading…</div>}
          {error && <div className="px-5 py-10 text-center text-sm text-destructive">{error}</div>}
          {!loading && !error && (
            <table className="w-full text-[13.5px]">
              <thead>
                <tr className="bg-[hsl(60_8%_97%)] border-b border-[hsl(var(--verita-border))]">
                  <th className="text-left px-5 py-2.5 text-xs font-medium text-muted-foreground">Customer</th>
                  <th className="text-left px-5 py-2.5 text-xs font-medium text-muted-foreground">Reason</th>
                  <th className="text-left px-5 py-2.5 text-xs font-medium text-muted-foreground">Issued</th>
                  <th className="text-right px-5 py-2.5 text-xs font-medium text-muted-foreground">Amount</th>
                </tr>
              </thead>
              <tbody>
                {credits.length === 0 && (
                  <tr>
                    <td colSpan={4} className="text-center py-10 text-sm text-muted-foreground">No credits issued yet.</td>
                  </tr>
                )}
                {credits.map((c) => (
                  <tr key={c.id} className="border-b last:border-0 border-[hsl(var(--verita-border))] hover:bg-[hsl(60_8%_97%)] transition-colors">
                    <td className="px-5 py-3">
                      <Link to={`/customers/${c.customer_id}`} className="font-medium hover:underline text-primary">
                        {c.customer_name}
                      </Link>
                    </td>
                    <td className="px-5 py-3 text-muted-foreground">{c.reason}</td>
                    <td className="px-5 py-3 text-[12.5px] text-muted-foreground">
                      {new Date(c.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                    </td>
                    <td className="px-5 py-3 text-right font-mono-numeric font-medium">{formatMoney(c.amount_minor)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {hasMore && (
            <div className="px-5 py-3 border-t border-[hsl(var(--verita-border))] flex justify-center">
              <button onClick={loadMore} disabled={loadingMore} className="text-sm text-muted-foreground hover:text-foreground disabled:opacity-50">
                {loadingMore ? "Loading…" : "Load more"}
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Customer picker */}
      {pickOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
          <div className="bg-white rounded-xl border border-[hsl(var(--verita-border))] shadow-xl w-full max-w-[460px] max-h-[520px] flex flex-col">
            <div className="px-5 py-4 border-b border-[hsl(var(--verita-border))]">
              <h2 className="text-sm font-semibold">Select customer</h2>
              <p className="text-[12.5px] text-muted-foreground mt-0.5">Choose who to issue the credit to</p>
            </div>
            <div className="overflow-y-auto flex-1">
              {customers.length === 0 ? (
                <div className="p-8 text-center text-sm text-muted-foreground">Loading customers…</div>
              ) : customers.map((c, i) => {
                const initials = c.name.split(" ").map((w) => w[0]).slice(0, 2).join("").toUpperCase()
                const hue = (c.id.charCodeAt(0) * 7) % 360
                return (
                  <button
                    key={c.id}
                    onClick={() => pickCustomer(c)}
                    className={`w-full flex items-center gap-3 px-5 py-3 text-left hover:bg-[hsl(60_8%_97%)] transition-colors ${i < customers.length - 1 ? "border-b border-[hsl(var(--verita-border))]" : ""}`}
                  >
                    <div
                      className="w-[28px] h-[28px] flex-shrink-0 rounded-md grid place-items-center text-[11px] font-semibold"
                      style={{ background: `hsl(${hue} 50% 92%)`, color: `hsl(${hue} 40% 35%)` }}
                    >{initials || "?"}</div>
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-[13.5px]">{c.name}</div>
                      <div className="text-[12px] text-muted-foreground truncate">{c.email}</div>
                    </div>
                  </button>
                )
              })}
            </div>
            <div className="px-5 py-3 border-t border-[hsl(var(--verita-border))]">
              <Button variant="ghost" size="sm" onClick={() => setPickOpen(false)}>Cancel</Button>
            </div>
          </div>
        </div>
      )}

      {selectedCustomer && (
        <IssueCreditDialog
          open={creditOpen}
          onClose={() => setCreditOpen(false)}
          token={token}
          customer={selectedCustomer}
          onSuccess={() => { setCreditOpen(false); reload() }}
        />
      )}
    </>
  )
}
