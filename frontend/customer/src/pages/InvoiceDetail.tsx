import { useEffect, useState } from "react"
import { useParams, Link } from "react-router-dom"
import { Badge } from "@/components/ui/badge"
import { fetchInvoice, formatMoney, formatPeriod, type InvoiceDetail as InvoiceDetailType } from "@/api"

export default function InvoiceDetail({ token }: { token: string }) {
  const { id } = useParams<{ id: string }>()
  const [invoice, setInvoice] = useState<InvoiceDetailType | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")

  useEffect(() => {
    if (!id) return
    setLoading(true)
    fetchInvoice(token, id)
      .then(setInvoice)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }, [token, id])

  return (
    <>
      {/* Topbar */}
      <div className="h-14 flex-shrink-0 border-b border-[hsl(var(--verita-border))] bg-white flex items-center px-7 gap-3.5">
        <Link to="/invoices" className="inline-flex items-center gap-1 text-[13px] text-muted-foreground hover:text-foreground">
          <svg className="h-3 w-3 -rotate-90" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
            <path d="m8 9 4-4 4 4M8 15l4 4 4-4" />
          </svg>
          Invoices
        </Link>
        <span className="text-[13px] text-muted-foreground">/</span>
        <h1 className="text-base font-semibold tracking-tight">
          Invoice {invoice ? `#${invoice.id.slice(0, 8)}` : ""}
        </h1>
      </div>

      <div className="p-7 max-w-[1280px] w-full">
        {loading && <div className="text-sm text-muted-foreground">Loading…</div>}
        {error && <div className="text-sm text-destructive">{error}</div>}
        {invoice && (
          <>
            {/* Header card */}
            <div className="bg-white rounded-xl border border-[hsl(var(--verita-border))] shadow-sm mb-5 overflow-hidden">
              <div className="p-6 flex items-start justify-between border-b border-[hsl(var(--verita-border))]">
                <div>
                  <div className="flex items-center gap-2.5 mb-2.5">
                    <Badge variant={invoice.status === "paid" ? "success" : invoice.status === "issued" ? "info" : "secondary"}>
                      <span className="w-1 h-1 rounded-full bg-current mr-1" />{invoice.status}
                    </Badge>
                    <span className="font-mono-numeric text-xs text-muted-foreground">INV-{invoice.id.slice(0, 8)}</span>
                  </div>
                  <div className="text-[28px] font-semibold tracking-[-0.025em] tabular leading-none">
                    {formatMoney(invoice.total_minor)}
                  </div>
                  <p className="text-[13.5px] text-muted-foreground mt-2">
                    Billing period: <span className="font-medium text-foreground">{formatPeriod(invoice.period_start, invoice.period_end)}</span>
                  </p>
                </div>
                <div className="text-right">
                  <div className="text-[11.5px] uppercase tracking-[0.05em] text-muted-foreground font-medium">Issued</div>
                  <div className="text-base font-semibold mt-1">{new Date(invoice.created_at).toLocaleDateString()}</div>
                </div>
              </div>

              <div className="grid grid-cols-2 divide-x divide-[hsl(var(--verita-border))]">
                <div className="px-6 py-4">
                  <div className="text-[11.5px] text-muted-foreground font-medium">Line items</div>
                  <div className="text-lg font-semibold tabular mt-0.5">{invoice.line_items.length}</div>
                </div>
                <div className="px-6 py-4">
                  <div className="text-[11.5px] text-muted-foreground font-medium">Total units</div>
                  <div className="text-lg font-semibold tabular mt-0.5">
                    {invoice.line_items.reduce((s, li) => s + li.units, 0).toLocaleString()}
                  </div>
                </div>
              </div>
            </div>

            {/* Line items */}
            <div className="bg-white rounded-xl border border-[hsl(var(--verita-border))] shadow-sm mb-5">
              <div className="px-5 pt-4 pb-3 border-b border-[hsl(var(--verita-border))]">
                <h3 className="text-sm font-semibold">Line items</h3>
              </div>
              <table className="w-full text-[13.5px]">
                <thead>
                  <tr className="bg-[hsl(60_8%_97%)] border-b border-[hsl(var(--verita-border))]">
                    <th className="text-left px-5 py-2.5 text-xs font-medium text-muted-foreground">Description</th>
                    <th className="text-right px-5 py-2.5 text-xs font-medium text-muted-foreground">Units</th>
                    <th className="text-right px-5 py-2.5 text-xs font-medium text-muted-foreground">Rate</th>
                    <th className="text-right px-5 py-2.5 text-xs font-medium text-muted-foreground">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {invoice.line_items.map((li) => (
                    <tr key={li.id} className="border-b last:border-0 border-[hsl(var(--verita-border))]">
                      <td className="px-5 py-3">
                        {li.description}
                        {li.overridden_at && (
                          <Badge variant="warning" className="ml-2 text-[10.5px]">overridden</Badge>
                        )}
                      </td>
                      <td className="px-5 py-3 text-right font-mono-numeric tabular">{li.units.toLocaleString()}</td>
                      <td className="px-5 py-3 text-right font-mono-numeric tabular text-muted-foreground">{formatMoney(li.unit_price_minor)}</td>
                      <td className="px-5 py-3 text-right font-mono-numeric tabular font-medium">{formatMoney(li.total_minor)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

          </>
        )}
      </div>
    </>
  )
}
