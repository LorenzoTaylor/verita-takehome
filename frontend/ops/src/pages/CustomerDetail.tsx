import { useEffect, useState } from "react"
import { useParams, Link } from "react-router-dom"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { CreditDialog } from "@/components/CreditDialog"
import { LineItemDialog } from "@/components/LineItemDialog"
import { fetchCustomer, formatMoney, formatPeriod, type CustomerDetail as Detail, type Invoice } from "@/api"

const invoiceVariant: Record<Invoice["status"], "secondary" | "info" | "success"> = {
  draft: "secondary", issued: "info", paid: "success",
}

export default function CustomerDetail({ token }: { token: string }) {
  const { id } = useParams<{ id: string }>()
  const [detail, setDetail] = useState<Detail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")

  function reload() {
    if (!id) return
    fetchCustomer(token, id).then(setDetail).catch((e) => setError(e.message))
  }

  useEffect(() => {
    if (!id) return
    fetchCustomer(token, id)
      .then(setDetail)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }, [token, id])

  if (loading) return <p className="text-sm text-muted-foreground">Loading...</p>
  if (error) return <p className="text-destructive text-sm">{error}</p>
  if (!detail || !id) return null

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <Link to="/customers" className="text-sm text-muted-foreground hover:text-foreground">← Customers</Link>
      </div>

      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold">{detail.name}</h1>
          <p className="text-muted-foreground">{detail.email}</p>
        </div>
        <CreditDialog token={token} customerId={id} onSuccess={reload} />
      </div>

      {/* Credits */}
      {detail.credits.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Credits Issued</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/50">
                <tr>
                  <th className="text-left px-4 py-2 font-medium text-muted-foreground">Amount</th>
                  <th className="text-left px-4 py-2 font-medium text-muted-foreground">Reason</th>
                  <th className="text-left px-4 py-2 font-medium text-muted-foreground">Date</th>
                </tr>
              </thead>
              <tbody>
                {detail.credits.map((c) => (
                  <tr key={c.id} className="border-b last:border-0">
                    <td className="px-4 py-2 font-medium text-green-700">{formatMoney(c.amount_minor)}</td>
                    <td className="px-4 py-2 text-muted-foreground">{c.reason}</td>
                    <td className="px-4 py-2 text-muted-foreground">{new Date(c.created_at).toLocaleDateString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}

      {/* Invoices */}
      <div>
        <h2 className="text-lg font-semibold mb-3">Invoices</h2>
        {detail.invoices.length === 0 && <p className="text-sm text-muted-foreground">No invoices yet.</p>}
        <div className="space-y-4">
          {detail.invoices.map((inv) => (
            <Card key={inv.id}>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="text-base">{formatPeriod(inv.period_start, inv.period_end)}</CardTitle>
                    <CardDescription>{formatMoney(inv.total_minor)}</CardDescription>
                  </div>
                  <Badge variant={invoiceVariant[inv.status]}>{inv.status}</Badge>
                </div>
              </CardHeader>
              <CardContent className="p-0">
                <LineItemDialog token={token} invoice={inv} onSuccess={reload} />
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </div>
  )
}
