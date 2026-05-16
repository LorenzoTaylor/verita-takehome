import { useEffect, useState } from "react"
import { useParams, Link } from "react-router-dom"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { fetchInvoice, formatMoney, formatPeriod, type InvoiceDetail as InvoiceDetailType } from "@/api"

export default function InvoiceDetail({ token }: { token: string }) {
  const { id } = useParams<{ id: string }>()
  const [invoice, setInvoice] = useState<InvoiceDetailType | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")

  useEffect(() => {
    if (!id) return
    fetchInvoice(token, id)
      .then(setInvoice)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }, [token, id])

  if (loading) return <p className="text-sm text-muted-foreground">Loading...</p>
  if (error) return <p className="text-destructive text-sm">{error}</p>
  if (!invoice) return null

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <Link to="/invoices" className="text-sm text-muted-foreground hover:text-foreground">← Invoices</Link>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-start justify-between">
            <div>
              <CardTitle>Invoice</CardTitle>
              <CardDescription>{formatPeriod(invoice.period_start, invoice.period_end)}</CardDescription>
            </div>
            <Badge variant={invoice.status === "paid" ? "success" : invoice.status === "issued" ? "info" : "secondary"}>
              {invoice.status}
            </Badge>
          </div>
        </CardHeader>
        <CardContent>
          <p className="text-3xl font-bold">{formatMoney(invoice.total_minor)}</p>
          <p className="text-xs text-muted-foreground mt-1">
            Created {new Date(invoice.created_at).toLocaleDateString()}
          </p>
        </CardContent>
      </Card>

      <div>
        <h2 className="text-lg font-semibold mb-3">Line Items</h2>
        <div className="rounded-md border overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/50">
              <tr>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Description</th>
                <th className="text-right px-4 py-3 font-medium text-muted-foreground">Units</th>
                <th className="text-right px-4 py-3 font-medium text-muted-foreground">Unit Price</th>
                <th className="text-right px-4 py-3 font-medium text-muted-foreground">Total</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {invoice.line_items.map((item) => (
                <tr key={item.id} className="border-b last:border-0">
                  <td className="px-4 py-3">{item.description}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{item.units.toLocaleString()}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{formatMoney(item.unit_price_minor)}</td>
                  <td className="px-4 py-3 text-right tabular-nums font-medium">{formatMoney(item.total_minor)}</td>
                  <td className="px-4 py-3">
                    {item.overridden_at && (
                      <Badge variant="warning" className="text-xs">overridden</Badge>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot className="border-t bg-muted/30">
              <tr>
                <td colSpan={3} className="px-4 py-3 text-right font-medium">Total</td>
                <td className="px-4 py-3 text-right font-bold tabular-nums">{formatMoney(invoice.total_minor)}</td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    </div>
  )
}
