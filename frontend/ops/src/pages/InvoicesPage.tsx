import { useEffect, useState } from "react"
import { Link } from "react-router-dom"
import { Badge } from "@/components/ui/badge"
import { fetchInvoicesPage, formatMoney, formatPeriod, type InvoiceListItem } from "@/api"

const statusVariant: Record<string, "secondary" | "info" | "success"> = {
  draft: "secondary",
  issued: "info",
  paid: "success",
}

export default function InvoicesPage({ token }: { token: string }) {
  const [invoices, setInvoices] = useState<InvoiceListItem[]>([])
  const [cursor, setCursor] = useState<string | null>(null)
  const [total, setTotal] = useState<number | null>(null)
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState("")

  useEffect(() => {
    fetchInvoicesPage(token)
      .then((res) => {
        setInvoices(res.data)
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
      const res = await fetchInvoicesPage(token, cursor)
      setInvoices((prev) => [...prev, ...res.data])
      setCursor(res.next_cursor)
      setHasMore(res.next_cursor !== null)
      setTotal(res.total)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoadingMore(false)
    }
  }

  return (
    <>
      <div className="h-14 flex-shrink-0 border-b border-[hsl(var(--verita-border))] bg-white flex items-center px-7 gap-3.5">
        <h1 className="text-base font-semibold tracking-tight">Invoices</h1>
        {!loading && !error && (
          <span className="text-[13px] text-muted-foreground">
            {hasMore ? `1–${invoices.length} of ${total}` : `${total ?? invoices.length} total`}
          </span>
        )}
      </div>

      <div className="p-7 w-full">
        <div className="bg-white rounded-xl border border-[hsl(var(--verita-border))] shadow-sm overflow-hidden">
          {loading && <div className="px-5 py-10 text-center text-sm text-muted-foreground">Loading…</div>}
          {error && <div className="px-5 py-10 text-center text-sm text-destructive">{error}</div>}
          {!loading && !error && (
            <table className="w-full text-[13.5px]">
              <thead>
                <tr className="bg-[hsl(60_8%_97%)] border-b border-[hsl(var(--verita-border))]">
                  <th className="text-left px-5 py-2.5 text-xs font-medium text-muted-foreground">Invoice</th>
                  <th className="text-left px-5 py-2.5 text-xs font-medium text-muted-foreground">Customer</th>
                  <th className="text-left px-5 py-2.5 text-xs font-medium text-muted-foreground">Period</th>
                  <th className="text-left px-5 py-2.5 text-xs font-medium text-muted-foreground">Status</th>
                  <th className="text-right px-5 py-2.5 text-xs font-medium text-muted-foreground">Amount</th>
                </tr>
              </thead>
              <tbody>
                {invoices.length === 0 && (
                  <tr>
                    <td colSpan={6} className="text-center py-10 text-sm text-muted-foreground">No invoices yet.</td>
                  </tr>
                )}
                {invoices.map((inv) => (
                  <tr key={inv.id} className="border-b last:border-0 border-[hsl(var(--verita-border))] hover:bg-[hsl(60_8%_97%)] transition-colors">
                    <td className="px-5 py-3 font-mono-numeric text-xs font-medium">#{inv.id.slice(0, 8)}</td>
                    <td className="px-5 py-3">
                      <Link to={`/customers/${inv.customer_id}`} className="font-medium hover:underline text-primary">
                        {inv.customer_name}
                      </Link>
                    </td>
                    <td className="px-5 py-3 text-[12.5px] text-muted-foreground">{formatPeriod(inv.period_start, inv.period_end)}</td>
                    <td className="px-5 py-3">
                      <Badge variant={statusVariant[inv.status]}>
                        {inv.status}
                      </Badge>
                    </td>
                    <td className="px-5 py-3 text-right font-mono-numeric font-medium">{formatMoney(inv.total_minor)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        {hasMore && (
          <div className="mt-4 flex justify-center">
            <button
              onClick={loadMore}
              disabled={loadingMore}
              className="text-sm text-muted-foreground hover:text-foreground disabled:opacity-50"
            >
              {loadingMore ? "Loading…" : `Load more`}
            </button>
          </div>
        )}
      </div>
    </>
  )
}
