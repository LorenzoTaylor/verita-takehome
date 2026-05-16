import { useEffect, useState } from "react"
import { Link } from "react-router-dom"
import { Badge } from "@/components/ui/badge"
import { fetchInvoices, formatMoney, formatPeriod, type Invoice } from "@/api"

const statusVariant: Record<Invoice["status"], "secondary" | "info" | "success"> = {
  draft: "secondary",
  issued: "info",
  paid: "success",
}

export default function InvoicesPage({ token }: { token: string }) {
  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")

  useEffect(() => {
    fetchInvoices(token)
      .then(setInvoices)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }, [token])

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Invoices</h1>
      {loading && <p className="text-sm text-muted-foreground">Loading...</p>}
      {error && <p className="text-destructive text-sm">{error}</p>}
      {!loading && !error && (
        <div className="rounded-md border overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/50">
              <tr>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Period</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Status</th>
                <th className="text-right px-4 py-3 font-medium text-muted-foreground">Amount</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {invoices.length === 0 && (
                <tr><td colSpan={4} className="text-center py-8 text-muted-foreground">No invoices yet.</td></tr>
              )}
              {invoices.map((inv) => (
                <tr key={inv.id} className="border-b last:border-0 hover:bg-muted/30 transition-colors">
                  <td className="px-4 py-3">{formatPeriod(inv.period_start, inv.period_end)}</td>
                  <td className="px-4 py-3">
                    <Badge variant={statusVariant[inv.status]}>{inv.status}</Badge>
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums font-medium">
                    {formatMoney(inv.total_minor)}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Link to={`/invoices/${inv.id}`} className="text-primary text-xs underline-offset-4 hover:underline">
                      View
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
