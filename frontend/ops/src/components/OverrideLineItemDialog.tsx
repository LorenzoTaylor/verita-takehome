// Override Line Item — fetches line items for an invoice, lets ops pick one,
// and presents a before/after diff with required reason text before saving.
//
// Uses existing api.ts `patchLineItem(token, invoiceId, itemId, total_minor, reason)`.

import { useEffect, useMemo, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Dialog, DialogContent, DialogHeader, DialogBody, DialogFooter, DialogTitle,
} from "@/components/ui/dialog"
import { Icon } from "@/components/SidebarLayout"
import { cn } from "@/lib/utils"
import { patchLineItem, formatMoney, API_BASE, type Invoice, type LineItem } from "@/api"

type Props = {
  open: boolean
  onClose: () => void
  token: string
  invoice: Invoice
  onSuccess: () => void
}

export default function OverrideLineItemDialog({ open, onClose, token, invoice, onSuccess }: Props) {
  const [items, setItems] = useState<LineItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [selected, setSelected] = useState<LineItem | null>(null)
  const [newTotal, setNewTotal] = useState("")
  const [reason, setReason] = useState("")
  const [submitting, setSubmitting] = useState(false)

  // Fetch line items when the dialog opens.
  useEffect(() => {
    if (!open) return
    setLoading(true); setError(""); setSelected(null); setNewTotal(""); setReason("")
    fetch(`${API_BASE}/ops/invoices/${invoice.id}/line-items`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.json() as Promise<LineItem[]>
      })
      .then(setItems)
      .catch((e) => setError(e instanceof Error ? e.message : "Couldn't load line items."))
      .finally(() => setLoading(false))
  }, [open, token, invoice.id])

  const idempotencyKey = useMemo(() => `override-${invoice.id}-${selected?.id ?? ""}-${Date.now()}`, [invoice.id, selected, open])

  const parsedNew = parseFloat(newTotal)
  const newMinor = isFinite(parsedNew) ? Math.round(parsedNew * 1000) : 0
  const delta = selected ? newMinor - selected.total_minor : 0
  const valid = selected !== null && newMinor >= 0 && reason.trim().length >= 6

  async function submit() {
    if (!selected) return
    setSubmitting(true); setError("")
    try {
      await patchLineItem(token, invoice.id, selected.id, newMinor, reason.trim())
      onSuccess()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save override.")
    } finally {
      setSubmitting(false)
    }
  }

  function close() {
    if (submitting) return
    onClose()
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && close()}>
      <DialogContent className="max-w-[560px]">
        <DialogHeader>
          <DialogTitle>Override line item</DialogTitle>
        </DialogHeader>

        <DialogBody>
          {/* Pick a line item */}
          {!selected && (
            <>
              <p className="text-[12.5px] text-muted-foreground mb-2.5">Line item</p>
              {loading && <div className="text-sm text-muted-foreground py-4">Loading…</div>}
              {error && <div className="text-sm text-destructive py-2">{error}</div>}
              {!loading && !error && items.length === 0 && (
                <div className="text-sm text-muted-foreground py-4">No line items on this invoice.</div>
              )}
              <div className="space-y-1.5">
                {items.map((it) => (
                  <button
                    key={it.id}
                    onClick={() => { setSelected(it); setNewTotal((it.total_minor / 1000).toFixed(2)) }}
                    className="w-full text-left rounded-md border border-[hsl(var(--verita-border))] bg-[hsl(var(--verita-bg-app))] hover:border-primary hover:bg-[hsl(var(--verita-accent-soft))] px-3.5 py-2.5 transition-colors"
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-[13.5px] font-medium">{it.description}</span>
                      <span className="font-mono-numeric text-[13.5px] font-medium">{formatMoney(it.total_minor)}</span>
                    </div>
                    <div className="text-[11.5px] text-muted-foreground font-mono-numeric mt-0.5">
                      units · {it.units.toLocaleString()} · rate · {formatMoney(it.unit_price_minor)}
                    </div>
                  </button>
                ))}
              </div>
            </>
          )}

          {/* Override the selected line item */}
          {selected && (
            <>
              <p className="text-[12.5px] text-muted-foreground mb-2.5">Line item</p>
              <div className="rounded-md border border-[hsl(var(--verita-border))] bg-[hsl(var(--verita-bg-app))] px-3.5 py-3 mb-4">
                <div className="font-medium mb-1">{selected.description}</div>
                <div className="text-xs text-muted-foreground font-mono-numeric flex gap-4">
                  <span>units · {selected.units.toLocaleString()}</span>
                  <span>rate · {formatMoney(selected.unit_price_minor)}</span>
                  <span>invoice · #{invoice.id.slice(0, 8)}</span>
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-[12.5px] font-medium">New total</label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm pointer-events-none">$</span>
                  <Input
                    value={newTotal}
                    onChange={(e) => setNewTotal(e.target.value.replace(/[^0-9.]/g, ""))}
                    className="pl-7 font-mono-numeric"
                    autoFocus
                  />
                </div>
              </div>

              {/* Before / after */}
              <div className="flex items-center gap-5 mt-3.5 px-4 py-3.5 bg-[hsl(var(--verita-bg-app))] border border-[hsl(var(--verita-border))] rounded-md">
                <div className="flex-1">
                  <div className="text-[11px] uppercase tracking-[0.05em] text-muted-foreground font-medium">Before</div>
                  <div className="font-mono-numeric text-lg font-semibold mt-1 line-through text-muted-foreground">
                    {formatMoney(selected.total_minor)}
                  </div>
                </div>
                <span className="text-[hsl(var(--verita-fg-subtle))] text-2xl">→</span>
                <div className="flex-1">
                  <div className="text-[11px] uppercase tracking-[0.05em] text-muted-foreground font-medium">After</div>
                  <div className={cn(
                    "font-mono-numeric text-lg font-semibold mt-1",
                    delta < 0 && "text-green-700",
                    delta > 0 && "text-destructive",
                  )}>
                    ${isFinite(parsedNew) ? parsedNew.toFixed(2) : "—"}
                    {isFinite(delta) && delta !== 0 && (
                      <span className="text-[11.5px] ml-2 font-medium">
                        ({delta > 0 ? "+" : ""}{formatMoney(delta)})
                      </span>
                    )}
                  </div>
                </div>
              </div>

              <div className="space-y-1.5 mt-3.5">
                <label className="text-[12.5px] font-medium">Reason</label>
                <textarea
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 min-h-[70px] resize-y"
                  placeholder="e.g. Duplicate metering May 10–14; reduced by 100k units."
                />
              </div>

              {error && <p className="text-sm text-destructive mt-3">{error}</p>}
            </>
          )}
        </DialogBody>

        <DialogFooter>
          {selected && (
            <span className="mr-auto text-[11.5px] text-[hsl(var(--verita-fg-subtle))] font-mono-numeric">
              idem · {idempotencyKey.slice(-12)}
            </span>
          )}
          {selected && (
            <Button variant="ghost" size="sm" onClick={() => setSelected(null)} disabled={submitting}>← Back</Button>
          )}
          <Button variant="ghost" size="sm" onClick={close} disabled={submitting}>Cancel</Button>
          {selected && (
            <Button size="sm" onClick={submit} disabled={!valid || submitting} variant="destructive">
              {submitting ? "Saving…" : "Save override"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
