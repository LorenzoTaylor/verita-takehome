import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogClose,
} from "@/components/ui/dialog"
import { issueCredit } from "@/api"

export function CreditDialog({
  token, customerId, onSuccess,
}: {
  token: string; customerId: string; onSuccess: () => void
}) {
  const [open, setOpen] = useState(false)
  const [amount, setAmount] = useState("")
  const [reason, setReason] = useState("")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError("")
    const amount_minor = Math.round(parseFloat(amount) * 1000)
    if (isNaN(amount_minor) || amount_minor <= 0) { setError("Enter a valid amount."); return }
    if (!reason.trim()) { setError("Reason is required."); return }

    setLoading(true)
    // Idempotency key: stable per form submission — user re-opening gets a fresh key
    const idempotency_key = `credit-${customerId}-${Date.now()}`
    try {
      await issueCredit(token, customerId, amount_minor, reason.trim(), idempotency_key)
      setOpen(false)
      setAmount("")
      setReason("")
      onSuccess()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to issue credit.")
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>Issue Credit</Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Issue Credit</DialogTitle>
            <DialogDescription>This action will be recorded in the audit log.</DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4 mt-2">
            <div className="space-y-1">
              <label className="text-sm font-medium">Amount ($)</label>
              <Input
                type="number" step="0.001" min="0.001" placeholder="e.g. 4.50"
                value={amount} onChange={(e) => setAmount(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium">Reason <span className="text-destructive">*</span></label>
              <Input
                placeholder="Billing adjustment, SLA credit..."
                value={reason} onChange={(e) => setReason(e.target.value)}
              />
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <div className="flex gap-2 justify-end">
              <DialogClose asChild>
                <Button type="button" variant="outline" size="sm">Cancel</Button>
              </DialogClose>
              <Button type="submit" size="sm" disabled={loading}>
                {loading ? "Issuing..." : "Issue Credit"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}
