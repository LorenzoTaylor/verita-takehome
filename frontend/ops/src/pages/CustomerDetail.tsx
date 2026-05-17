// Ops Customer Detail — usage chart + invoices + credits + money-moving dialogs.
// Replaces frontend/ops/src/pages/CustomerDetail.tsx.

import { useEffect, useState } from "react"
import { useParams, Link } from "react-router-dom"
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Icon } from "@/components/SidebarLayout"
import IssueCreditDialog from "@/components/IssueCreditDialog"
import OverrideLineItemDialog from "@/components/OverrideLineItemDialog"
import {
  fetchCustomer, fetchCustomerUsage, formatMoney, formatPeriod,
  type CustomerDetail as Detail, type Invoice, type UsageDay,
} from "@/api"

const ACCENT = "hsl(258 65% 56%)"

export default function CustomerDetail({ token }: { token: string }) {
  const { id } = useParams<{ id: string }>()
  const [detail, setDetail] = useState<Detail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [creditOpen, setCreditOpen] = useState(false)
  const [overrideInvoice, setOverrideInvoice] = useState<Invoice | null>(null)
  const [usageData, setUsageData] = useState<UsageDay[]>([])

  function reload() {
    if (!id) return
    fetchCustomer(token, id).then(setDetail).catch((e) => setError(e.message))
  }

  useEffect(() => {
    if (!id) return
    setLoading(true)
    fetchCustomer(token, id)
      .then(setDetail)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }, [token, id])

  useEffect(() => {
    if (!id) return
    fetchCustomerUsage(token, id).then(setUsageData).catch(() => {})
  }, [token, id])

  const totalUsage = usageData.reduce((s, d) => s + d.units, 0)

  const initials = detail?.name?.split(" ").map((w) => w[0]).slice(0, 2).join("").toUpperCase() ?? "?"
  const totalLifetime = detail?.invoices.reduce((s, i) => s + i.total_minor, 0) ?? 0
  const openBalance = detail?.invoices.filter((i) => i.status !== "paid").reduce((s, i) => s + i.total_minor, 0) ?? 0
  const totalCredits = detail?.credits.length ?? 0

  return (
    <>
      {/* Topbar */}
      <div className="h-14 flex-shrink-0 border-b border-[hsl(var(--verita-border))] bg-white flex items-center px-7 gap-3.5">
        <Link to="/customers" className="inline-flex items-center gap-1 text-[13px] text-muted-foreground hover:text-foreground">
          <svg className="h-3 w-3 -rotate-90" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
            <path d="m8 9 4-4 4 4M8 15l4 4 4-4" />
          </svg>
          Customers
        </Link>
        <span className="text-[13px] text-muted-foreground">/</span>
        <h1 className="text-base font-semibold tracking-tight">{detail?.name ?? "…"}</h1>
        <div className="ml-auto flex items-center gap-2">
          <Button size="sm" className="h-8" disabled={!detail} onClick={() => setCreditOpen(true)}>
            <span className="mr-1">+</span> Issue credit
          </Button>
        </div>
      </div>

      <div className="p-7 w-full max-w-[1280px]">
        {loading && <div className="text-sm text-muted-foreground">Loading…</div>}
        {error && <div className="text-sm text-destructive">{error}</div>}
        {detail && (
          <>
            {/* Customer header */}
            <div className="bg-white rounded-xl border border-[hsl(var(--verita-border))] shadow-sm mb-5 px-6 py-5 flex items-center gap-4">
              <div className="w-[52px] h-[52px] rounded-[10px] bg-[hsl(258_40%_92%)] text-[hsl(258_50%_35%)] grid place-items-center text-lg font-semibold tracking-tight">
                {initials}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-lg font-semibold tracking-tight">{detail.name}</div>
                <div className="text-[13px] text-muted-foreground truncate">
                  <span className="font-mono-numeric">{detail.id.slice(0, 12)}</span>
                  {" · "}{detail.email}
                  {" · joined "}{new Date(detail.created_at).toLocaleDateString()}
                </div>
              </div>
              <div className="grid grid-cols-3 gap-x-9 text-right">
                <div>
                  <div className="text-[11px] uppercase tracking-[0.05em] text-muted-foreground font-medium">Lifetime</div>
                  <div className="text-base font-semibold tabular mt-0.5">{formatMoney(totalLifetime)}</div>
                </div>
                <div>
                  <div className="text-[11px] uppercase tracking-[0.05em] text-muted-foreground font-medium">Open</div>
                  <div className="text-base font-semibold tabular mt-0.5">{formatMoney(openBalance)}</div>
                </div>
                <div>
                  <div className="text-[11px] uppercase tracking-[0.05em] text-muted-foreground font-medium">Credits</div>
                  <div className="text-base font-semibold tabular mt-0.5">{totalCredits}</div>
                </div>
              </div>
            </div>

            {/* Usage chart */}
            <div className="bg-white rounded-xl border border-[hsl(var(--verita-border))] shadow-sm mb-5">
              <div className="flex items-center justify-between px-5 pt-4 pb-3 border-b border-[hsl(var(--verita-border))]">
                <div>
                  <h3 className="text-sm font-semibold">Usage · last 30 days</h3>
                </div>
              </div>
              <div className="px-5 pt-4 pb-5">
                <div className="flex gap-6 mb-4">
                  <div>
                    <div className="text-[11.5px] text-muted-foreground font-medium">Total units</div>
                    <div className="text-[22px] font-semibold tracking-[-0.02em] tabular mt-0.5">{totalUsage.toLocaleString()}</div>
                  </div>
                  <div className="border-l border-[hsl(var(--verita-border))] pl-6">
                    <div className="text-[11.5px] text-muted-foreground font-medium">7-day baseline</div>
                    <div className="text-[22px] font-semibold tracking-[-0.02em] tabular mt-0.5">
                      {Math.round(usageData.slice(-7).reduce((s, d) => s + d.units, 0) / 7).toLocaleString()}
                    </div>
                  </div>
                </div>
                <ResponsiveContainer width="100%" height={200}>
                  <AreaChart data={usageData} margin={{ top: 5, right: 5, left: -10, bottom: 0 }}>
                    <defs>
                      <linearGradient id="vr-cd-units" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor={ACCENT} stopOpacity={0.22} />
                        <stop offset="95%" stopColor={ACCENT} stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 4" stroke="hsl(var(--verita-border))" vertical={false} />
                    <XAxis dataKey="date" tick={{ fontSize: 11, fill: "hsl(var(--verita-fg-subtle))" }} tickLine={false} axisLine={false} />
                    <YAxis tick={{ fontSize: 11, fill: "hsl(var(--verita-fg-subtle))" }} tickLine={false} axisLine={false} width={40} />
                    <Tooltip contentStyle={{ background: "hsl(0 0% 12%)", border: "none", borderRadius: 6, fontSize: 11.5, color: "white" }} />
                    <Area type="monotone" dataKey="units" stroke={ACCENT} strokeWidth={1.75} fill="url(#vr-cd-units)" animationDuration={1100} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Two-column: invoices + credits */}
            <div className="grid grid-cols-1 lg:grid-cols-[1.4fr_1fr] gap-5">
              <div className="bg-white rounded-xl border border-[hsl(var(--verita-border))] shadow-sm">
                <div className="flex items-center justify-between px-5 pt-4 pb-3 border-b border-[hsl(var(--verita-border))]">
                  <div>
                    <h3 className="text-sm font-semibold">Invoices</h3>
                    <p className="text-[12.5px] text-muted-foreground mt-0.5">{detail.invoices.length} total</p>
                  </div>
                </div>
                <table className="w-full text-[13.5px]">
                  <thead>
                    <tr className="bg-[hsl(60_8%_97%)] border-b border-[hsl(var(--verita-border))]">
                      <th className="text-left px-5 py-2.5 text-xs font-medium text-muted-foreground">Period</th>
                      <th className="text-right px-5 py-2.5 text-xs font-medium text-muted-foreground">Total</th>
                      <th className="text-left px-5 py-2.5 text-xs font-medium text-muted-foreground">Status</th>
                      <th className="text-right px-5 py-2.5 text-xs font-medium text-muted-foreground"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.invoices.length === 0 && (
                      <tr><td colSpan={4} className="text-center py-8 text-muted-foreground">No invoices.</td></tr>
                    )}
                    {detail.invoices.map((inv) => (
                      <tr key={inv.id} className="border-b last:border-0 border-[hsl(var(--verita-border))] hover:bg-[hsl(60_8%_97%)]">
                        <td className="px-5 py-3">
                          <div className="font-medium">#{inv.id.slice(0, 8)}</div>
                          <div className="text-xs text-muted-foreground">{formatPeriod(inv.period_start, inv.period_end)}</div>
                        </td>
                        <td className="px-5 py-3 text-right font-mono-numeric tabular font-medium">{formatMoney(inv.total_minor)}</td>
                        <td className="px-5 py-3">
                          <Badge variant={inv.status === "paid" ? "success" : inv.status === "issued" ? "info" : "secondary"}>
                            <span className="w-1 h-1 rounded-full bg-current mr-1" />{inv.status}
                          </Badge>
                        </td>
                        <td className="px-5 py-3 text-right">
                          <button
                            onClick={() => setOverrideInvoice(inv)}
                            className="h-7 px-2 rounded text-[12px] font-medium text-muted-foreground hover:text-foreground hover:bg-[hsl(60_8%_95%)]"
                          >
                            Override
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="bg-white rounded-xl border border-[hsl(var(--verita-border))] shadow-sm">
                <div className="flex items-center justify-between px-5 pt-4 pb-3 border-b border-[hsl(var(--verita-border))]">
                  <div>
                    <h3 className="text-sm font-semibold">Credits</h3>
                    <p className="text-[12.5px] text-muted-foreground mt-0.5">{detail.credits.length} issued</p>
                  </div>
                </div>
                {detail.credits.length === 0 && (
                  <div className="px-5 py-8 text-center text-sm text-muted-foreground">No credits issued.</div>
                )}
                {detail.credits.map((c, i) => (
                  <div key={c.id} className={"px-5 py-3.5 " + (i < detail.credits.length - 1 ? "border-b border-[hsl(var(--verita-border))]" : "")}>
                    <div className="flex items-baseline justify-between mb-1">
                      <span className="font-mono-numeric text-[11.5px] text-[hsl(var(--verita-fg-subtle))]">{c.id.slice(0, 10)}</span>
                      <span className="font-mono-numeric text-sm font-semibold text-green-700">{formatMoney(c.amount_minor)}</span>
                    </div>
                    <div className="text-[13px] mb-1">{c.reason}</div>
                    <div className="text-[11.5px] text-[hsl(var(--verita-fg-subtle))]">
                      {new Date(c.created_at).toLocaleDateString()}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}
      </div>

      {detail && (
        <IssueCreditDialog
          open={creditOpen}
          onClose={() => setCreditOpen(false)}
          token={token}
          customer={detail}
          onSuccess={() => { setCreditOpen(false); reload() }}
        />
      )}
      {overrideInvoice && (
        <OverrideLineItemDialog
          open={!!overrideInvoice}
          onClose={() => setOverrideInvoice(null)}
          token={token}
          invoice={overrideInvoice}
          onSuccess={() => { setOverrideInvoice(null); reload() }}
        />
      )}
    </>
  )
}
