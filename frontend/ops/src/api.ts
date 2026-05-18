export type Customer = { id: string; name: string; email: string; created_at: string }

export type Invoice = {
  id: string; period_start: string; period_end: string
  status: "draft" | "issued" | "paid"; total_minor: number; created_at: string
}

export type LineItem = {
  id: string; description: string; units: number
  unit_price_minor: number; total_minor: number; overridden_at: string | null
}

export type Credit = { id: string; amount_minor: number; reason: string; created_at: string }

export type AnomalyFlag = {
  id: string; signal_type: string; value: number
  threshold: number; flagged_at: string; resolved_at: string | null
}

export type CustomerDetail = Customer & { invoices: Invoice[]; credits: Credit[] }

export const API_BASE = import.meta.env.VITE_API_URL ?? ""

async function apiFetch<T>(url: string, token: string, init?: RequestInit): Promise<T> {
  const res = await fetch(API_BASE + url, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...init?.headers },
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body.error ?? `HTTP ${res.status}`)
  }
  return res.json()
}

export async function login(email: string, password: string): Promise<string> {
  const res = await fetch(API_BASE + "/ops/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  })
  if (!res.ok) throw new Error("Invalid credentials")
  const data = await res.json()
  return data.token as string
}

export async function fetchCustomersPage(token: string, cursor?: string): Promise<{ data: Customer[]; next_cursor: string | null; total: number }> {
  const qs = cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""
  return apiFetch(`/ops/customers${qs}`, token)
}

export async function fetchCustomer(token: string, id: string): Promise<CustomerDetail> {
  return apiFetch(`/ops/customers/${id}`, token)
}

export async function issueCredit(
  token: string,
  customerId: string,
  amount_minor: number,
  reason: string,
  idempotency_key: string
): Promise<Credit> {
  return apiFetch(`/ops/customers/${customerId}/credits`, token, {
    method: "POST",
    body: JSON.stringify({ amount_minor, reason, idempotency_key }),
  })
}

export async function patchLineItem(
  token: string,
  invoiceId: string,
  itemId: string,
  total_minor: number,
  reason: string
): Promise<LineItem> {
  return apiFetch(`/ops/invoices/${invoiceId}/line-items/${itemId}`, token, {
    method: "PATCH",
    body: JSON.stringify({ total_minor, reason }),
  })
}

export function formatMoney(minor: number): string {
  return `$${(minor / 1000).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

export function formatPeriod(start: string, end: string): string {
  return `${new Date(start).toLocaleDateString()} – ${new Date(end).toLocaleDateString()}`
}

export type UsageDay = { date: string; units: number }

export async function fetchCustomerUsage(token: string, id: string): Promise<UsageDay[]> {
  return apiFetch(`/ops/customers/${id}/usage`, token)
}

export type OverviewStats = {
  total_customers: number
  prev_customers: number
  total_revenue_minor: number
  prev_revenue_minor: number
  open_invoices: number
  active_anomalies: number
  prev_active_anomalies: number
  total_open_anomalies: number
}

export type RevenueDay = { date: string; revenue_minor: number }

export async function fetchRevenueChart(token: string, days = 90): Promise<RevenueDay[]> {
  return apiFetch(`/ops/revenue-chart?days=${days}`, token)
}

export type InvoiceListItem = {
  id: string
  customer_id: string
  customer_name: string
  period_start: string
  period_end: string
  status: "draft" | "issued" | "paid"
  total_minor: number
  created_at: string
}

export type CreditListItem = {
  id: string
  customer_id: string
  customer_name: string
  amount_minor: number
  reason: string
  created_at: string
}

export type AnomalyListItem = {
  id: string
  customer_id: string
  customer_name: string
  signal_type: string
  value: number | null
  threshold: number | null
  flagged_at: string
  resolved_at: string | null
}

export async function fetchOverview(token: string, days?: number): Promise<OverviewStats> {
  const qs = days ? `?days=${days}` : ""
  return apiFetch(`/ops/overview${qs}`, token)
}

export async function fetchInvoicesPage(token: string, cursor?: string): Promise<{ data: InvoiceListItem[]; next_cursor: string | null; total: number }> {
  const qs = cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""
  return apiFetch(`/ops/invoices${qs}`, token)
}

export async function fetchCreditsPage(token: string, cursor?: string): Promise<{ data: CreditListItem[]; next_cursor: string | null; total: number }> {
  const qs = cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""
  return apiFetch(`/ops/credits${qs}`, token)
}

export async function fetchAnomaliesPage(token: string, cursor?: string): Promise<{ data: AnomalyListItem[]; next_cursor: string | null; total: number }> {
  const qs = cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""
  return apiFetch(`/ops/anomalies${qs}`, token)
}

export type EventsHour = { h: string; events: number }

export async function fetchEventsByHour(token: string): Promise<EventsHour[]> {
  return apiFetch("/ops/events-by-hour", token)
}
