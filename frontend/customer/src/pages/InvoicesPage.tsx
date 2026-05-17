import { useEffect, useState } from "react"
import { Link } from "react-router-dom"
import { Badge } from "@/components/ui/badge"
import PageLayout from "@/components/PageLayout"
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
    <PageLayout title="Invoices">
      <div className="bg-white rounded-xl border border-[hsl(var(--verita-border))] shadow-sm overflow-hidden">
        {loading && (
          <div className="px-5 py-10 text-center text-sm text-muted-foreground">Loading…</div>
        )}
        {error && (
          <div className="px-5 py-10 text-center text-sm text-destructive">{error}</div>
        )}
        {!loading && !error && invoices.length === 0 && (
          <div className="px-5 py-10 text-center text-sm text-muted-foreground">No invoices yet.</div>
        )}
        {!loading && !error && invoices.length > 0 && (
          <table className="w-full text-[13.5px]">
            <thead>
              <tr className="bg-[hsl(60_8%_97%)] border-b border-[hsl(var(--verita-border))]">
                <th className="text-left px-5 py-2.5 text-xs font-medium text-muted-foreground">Invoice</th>
                <th className="text-left px-5 py-2.5 text-xs font-medium text-muted-foreground">Period</th>
                <th className="text-left px-5 py-2.5 text-xs font-medium text-muted-foreground">Status</th>
                <th className="text-right px-5 py-2.5 text-xs font-medium text-muted-foreground">Amount</th>
                <th className="px-5 py-2.5"></th>
              </tr>
            </thead>
            <tbody>
              {invoices.map((inv) => (
                <tr key={inv.id} className="border-b last:border-0 border-[hsl(var(--verita-border))]">
                  <td className="px-5 py-3 font-mono-numeric text-xs font-medium">#{inv.id.slice(0, 8)}</td>
                  <td className="px-5 py-3 text-[12.5px] text-muted-foreground">{formatPeriod(inv.period_start, inv.period_end)}</td>
                  <td className="px-5 py-3">
                    <Badge variant={statusVariant[inv.status]}>
                      <span className="w-1 h-1 rounded-full bg-current mr-1" />{inv.status}
                    </Badge>
                  </td>
                  <td className="px-5 py-3 text-right font-mono-numeric font-medium">{formatMoney(inv.total_minor)}</td>
                  <td className="px-5 py-3 text-right">
                    <Link to={`/invoices/${inv.id}`} className="text-primary text-[12.5px] font-medium hover:underline">View</Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </PageLayout>
  )
}
