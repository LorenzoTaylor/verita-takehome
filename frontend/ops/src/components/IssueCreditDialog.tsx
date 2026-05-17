// Issue Credit — 2-step (Details → Confirm) dialog with idempotency key.
// Uses your existing api.ts `issueCredit(token, customerId, amount_minor, reason, idempotency_key)`.

import { useMemo, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Dialog, DialogContent, DialogHeader, DialogBody, DialogFooter, DialogTitle,
} from "@/components/ui/dialog"
import { Icon } from "@/components/SidebarLayout"
import { cn } from "@/lib/utils"
import { issueCredit } from "@/api"

type Props = {
  open: boolean
  onClose: () => void
  token: string
  customer: { id: string; name: string }
  onSuccess: () => void
}

export default function IssueCreditDialog({ open, onClose, token, customer, onSuccess }: Props) {
  const [step, setStep] = useState<0 | 1>(0)
  const [amount, setAmount] = useState("")
  const [reason, setReason] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState("")

  // Stable idempotency key for this dialog session — regenerated only when re-opened.
  const idempotencyKey = useMemo(() => `credit-${customer.id}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, [customer.id, open])

  const parsedAmount = parseFloat(amount)
  const amountMinor = isFinite(parsedAmount) ? Math.round(parsedAmount * 1000) : 0
  const valid = amountMinor > 0 && reason.trim().length >= 6

  async function submit() {
    setSubmitting(true)
    setError("")
    try {
      await issueCredit(token, customer.id, amountMinor, reason.trim(), idempotencyKey)
      // Reset for next time the dialog is opened
      setAmount(""); setReason(""); setStep(0)
      onSuccess()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to issue credit.")
    } finally {
      setSubmitting(false)
    }
  }

  function close() {
    if (submitting) return
    setStep(0); setAmount(""); setReason(""); setError("")
    onClose()
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && close()}>
      <DialogContent className="max-w-[520px]">
        <DialogHeader icon={<Icon name="credit" />}>
          <DialogTitle>Issue credit</DialogTitle>
        </DialogHeader>

        <div className="px-[22px] pt-3">
          <Stepper step={step} steps={["Details", "Confirm"]} />
        </div>

        {step === 0 && (
          <>
            <DialogBody>
              <div className="space-y-1.5">
                <label className="text-[12.5px] font-medium">Amount</label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm pointer-events-none">$</span>
                  <Input
                    value={amount}
                    onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))}
                    className="pl-7 font-mono-numeric"
                    placeholder="0.00"
                    inputMode="decimal"
                    autoFocus
                  />
                </div>
                <p className="text-[11.5px] text-muted-foreground">USD · stored as minor units (×1000)</p>
              </div>

              <div className="space-y-1.5 mt-3.5">
                <label className="text-[12.5px] font-medium">Reason</label>
                <textarea
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 min-h-[76px] resize-y"
                  placeholder="e.g. Goodwill — service incident on May 14"
                />
                <p className="text-[11.5px] text-muted-foreground">{reason.length}/280</p>
              </div>
            </DialogBody>
            <DialogFooter>
              <span className="mr-auto text-[11.5px] text-[hsl(var(--verita-fg-subtle))] font-mono-numeric">
                idem · {idempotencyKey.slice(-12)}
              </span>
              <Button variant="ghost" size="sm" onClick={close}>Cancel</Button>
              <Button size="sm" onClick={() => setStep(1)} disabled={!valid}>
                Review credit →
              </Button>
            </DialogFooter>
          </>
        )}

        {step === 1 && (
          <>
            <DialogBody>
              <div className="rounded-md bg-[hsl(var(--verita-accent-soft))] border border-[hsl(258_55%_88%)] px-4 py-3 mb-3.5 text-[12.5px] leading-snug text-[hsl(var(--verita-accent-soft-fg))]">
                <strong>Issue ${parsedAmount.toFixed(2)} credit to {customer.name}.</strong>{" "}
                Audit-logged. Cannot be reversed without an offsetting debit.
              </div>

              <div className="divide-y divide-[hsl(var(--verita-border))]">
                <ReviewRow label="Customer" value={customer.name} />
                <ReviewRow label="Customer ID" value={customer.id} mono />
                <ReviewRow label="Amount" value={`$${parsedAmount.toFixed(2)}`} mono accent />
                <ReviewRow label="Amount (minor)" value={amountMinor.toLocaleString()} mono />
                <ReviewRow label="Reason" value={reason.length > 38 ? reason.slice(0, 36) + "…" : reason} />
                <ReviewRow label="Idempotency key" value={idempotencyKey} mono />
              </div>

              {error && <p className="text-sm text-destructive mt-3">{error}</p>}
            </DialogBody>
            <DialogFooter>
              <Button variant="ghost" size="sm" onClick={() => setStep(0)} disabled={submitting}>← Back</Button>
              <div className="flex-1" />
              <Button variant="ghost" size="sm" onClick={close} disabled={submitting}>Cancel</Button>
              <Button size="sm" onClick={submit} disabled={submitting}>
                {submitting ? "Issuing…" : `Issue $${parsedAmount.toFixed(2)} credit`}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}

function Stepper({ step, steps }: { step: number; steps: string[] }) {
  return (
    <div className="flex items-center gap-1.5">
      {steps.map((label, i) => (
        <div key={label} className="flex items-center gap-1.5">
          <div className={cn(
            "w-[18px] h-[18px] rounded-full grid place-items-center text-[10px] font-semibold font-mono-numeric",
            i < step && "bg-primary text-white",
            i === step && "bg-white border-[1.5px] border-primary text-primary",
            i > step && "bg-[hsl(60_8%_95%)] border border-[hsl(var(--verita-border))] text-muted-foreground",
          )}>
            {i < step ? "✓" : i + 1}
          </div>
          <span className={cn("text-xs font-medium", i <= step ? "text-foreground" : "text-muted-foreground")}>{label}</span>
          {i < steps.length - 1 && <div className="w-[18px] h-px bg-[hsl(var(--verita-border))] mx-1" />}
        </div>
      ))}
    </div>
  )
}

function ReviewRow({ label, value, mono, accent }: { label: string; value: string; mono?: boolean; accent?: boolean }) {
  return (
    <div className="flex items-baseline justify-between py-2.5">
      <span className="text-[12.5px] text-muted-foreground">{label}</span>
      <span className={cn(
        "text-[13.5px]",
        accent ? "font-semibold text-[hsl(var(--verita-accent-soft-fg))]" : "font-medium",
        mono && "font-mono-numeric tabular",
      )}>{value}</span>
    </div>
  )
}
