import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogClose,
} from "@/components/ui/dialog"
import { patchLineItem, formatMoney, type Invoice, type LineItem } from "@/api"

export function LineItemDialog({
  token, invoice, onSuccess,
}: {
  token: string; invoice: Invoice; onSuccess: () => void
}) {
  const [open, setOpen] = useState(false)
  const [selected, setSelected] = useState<LineItem | null>(null)
  const [newTotal, setNewTotal] = useState("")
  const [reason, setReason] = useState("")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const [lineItems, setLineItems] = useState<LineItem[]>([])
  const [loadingItems, setLoadingItems] = useState(false)

  async function openDialog() {
    setOpen(true)
    setLoadingItems(true)
    // Fetch line items via the customer-facing endpoint — ops user token doesn't work there,
    // so we embed them from the invoice detail. For now fetch them from the customer endpoint
    // using a workaround: the CustomerDetail already has invoices but not line items.
    // We'll fetch inline from the ops customer detail which doesn't return line items.
    // Simplest: store line items passed from outside, or fetch from /v1/invoices/:id using a no-auth bypass.
    // Actually we'll just list them from the invoice prop with a placeholder.
    setLoadingItems(false)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!selected) return
    setError("")
    const total_minor = Math.round(parseFloat(newTotal) * 1000)
    if (isNaN(total_minor) || total_minor < 0) { setError("Enter a valid amount."); return }
    if (!reason.trim()) { setError("Reason is required."); return }

    setLoading(true)
    try {
      await patchLineItem(token, invoice.id, selected.id, total_minor, reason.trim())
      setOpen(false)
      setSelected(null)
      setNewTotal("")
      setReason("")
      onSuccess()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to update line item.")
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="px-4 pb-4">
      <Button size="sm" variant="ghost" className="text-xs" onClick={openDialog}>
        Override line item
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Override Line Item</DialogTitle>
            <DialogDescription>
              Invoice: {invoice.id.slice(0, 8)}… · Current total: {formatMoney(invoice.total_minor)}
            </DialogDescription>
          </DialogHeader>

          {!selected ? (
            <div className="space-y-2 mt-2">
              <p className="text-sm font-medium">Select a line item to override:</p>
              <LineItemFetcher token={token} invoiceId={invoice.id} onSelect={(item) => {
                setSelected(item)
                setNewTotal((item.total_minor / 1000).toFixed(3))
              }} />
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4 mt-2">
              <div className="rounded-md border p-3 text-sm space-y-1">
                <p className="font-medium">{selected.description}</p>
                <p className="text-muted-foreground">
                  Current: {formatMoney(selected.total_minor)}
                  {selected.overridden_at && <Badge variant="warning" className="ml-2 text-xs">overridden</Badge>}
                </p>
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium">New Total ($)</label>
                <Input
                  type="number" step="0.001" min="0" value={newTotal}
                  onChange={(e) => setNewTotal(e.target.value)}
                />
                {newTotal && (
                  <p className="text-xs text-muted-foreground">
                    Before: {formatMoney(selected.total_minor)} → After: ${(parseFloat(newTotal) || 0).toFixed(2)}
                  </p>
                )}
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium">Reason <span className="text-destructive">*</span></label>
                <Input placeholder="Price correction, billing error..." value={reason} onChange={(e) => setReason(e.target.value)} />
              </div>
              {error && <p className="text-sm text-destructive">{error}</p>}
              <div className="flex gap-2 justify-end">
                <Button type="button" variant="outline" size="sm" onClick={() => setSelected(null)}>Back</Button>
                <DialogClose asChild>
                  <Button type="button" variant="outline" size="sm">Cancel</Button>
                </DialogClose>
                <Button type="submit" size="sm" disabled={loading}>
                  {loading ? "Saving..." : "Save Override"}
                </Button>
              </div>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}

function LineItemFetcher({ token, invoiceId, onSelect }: {
  token: string; invoiceId: string; onSelect: (item: LineItem) => void
}) {
  const [items, setItems] = useState<LineItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")

  useState(() => {
    fetch(`/ops/invoices/${invoiceId}/line-items`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.json()
      })
      .then(setItems)
      .catch(() => {
        // Fallback: the ops API doesn't have a list-line-items endpoint,
        // so fetch via the invoice detail route (customer route, no auth needed beyond key)
        // For the ops console we just show a message to use the customer ID
        setError("Line items not available — use the customer invoice detail.")
      })
      .finally(() => setLoading(false))
  })

  if (loading) return <p className="text-sm text-muted-foreground">Loading...</p>
  if (error || items.length === 0) {
    // Fallback: manual entry
    return (
      <div className="space-y-2">
        <p className="text-xs text-muted-foreground">
          Enter the line item ID directly (find it in the customer portal or database).
        </p>
        <ManualLineItemEntry onSelect={onSelect} />
      </div>
    )
  }

  return (
    <div className="space-y-1">
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          onClick={() => onSelect(item)}
          className="w-full text-left px-3 py-2 rounded-md border hover:bg-muted/50 text-sm transition-colors"
        >
          <span className="font-medium">{item.description}</span>
          <span className="text-muted-foreground ml-2">{formatMoney(item.total_minor)}</span>
          {item.overridden_at && <Badge variant="warning" className="ml-2 text-xs">overridden</Badge>}
        </button>
      ))}
    </div>
  )
}

function ManualLineItemEntry({ onSelect }: { onSelect: (item: LineItem) => void }) {
  const [itemId, setItemId] = useState("")
  const [currentTotal, setCurrentTotal] = useState("")

  function confirm() {
    if (!itemId.trim()) return
    onSelect({
      id: itemId.trim(),
      description: "Manual entry",
      units: 0,
      unit_price_minor: 0,
      total_minor: Math.round(parseFloat(currentTotal || "0") * 1000),
      overridden_at: null,
    })
  }

  return (
    <div className="space-y-2">
      <Input placeholder="Line item UUID" value={itemId} onChange={(e) => setItemId(e.target.value)} className="font-mono text-xs" />
      <Input placeholder="Current total ($)" type="number" value={currentTotal} onChange={(e) => setCurrentTotal(e.target.value)} />
      <Button size="sm" type="button" onClick={confirm} disabled={!itemId.trim()}>Continue</Button>
    </div>
  )
}
