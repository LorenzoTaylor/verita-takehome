export type UsageEvent = {
  id: string
  request_id: string
  api_key_id: string
  endpoint: string
  units: number
  timestamp: string
  status: "normal" | "late"
}

export type Invoice = {
  id: string
  period_start: string
  period_end: string
  status: "draft" | "issued" | "paid"
  total_minor: number
  created_at: string
}

export type LineItem = {
  id: string
  description: string
  units: number
  unit_price_minor: number
  total_minor: number
  overridden_at: string | null
}

export type InvoiceDetail = Invoice & { line_items: LineItem[] }

export type Me = { name: string; email: string }

export type PagedUsage = { data: UsageEvent[]; next_cursor: string | null }

export type DailyUsage = { date: string; units: number; events: number; late_events: number }

export type UsageStats = {
  total_units: number
  event_count: number
  late_count: number
  endpoints_used: number
  daily: DailyUsage[]
}

export type UsageFilters = {
  cursor?: string
  limit?: number
  from?: string
  to?: string
  api_key_id?: string
}

function authHeaders(token: string) {
  return { Authorization: `Bearer ${token}` }
}

async function apiFetch<T>(url: string, token: string): Promise<T> {
  const res = await fetch(url, { headers: authHeaders(token) })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body.error ?? `HTTP ${res.status}`)
  }
  return res.json()
}

export async function login(email: string, password: string): Promise<string> {
  const res = await fetch("/v1/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  })
  if (!res.ok) throw new Error("Invalid email or password.")
  const data = await res.json()
  return data.token
}

export async function fetchMe(token: string): Promise<Me> {
  return apiFetch("/v1/me", token)
}

export async function fetchUsage(token: string, filters: UsageFilters = {}): Promise<PagedUsage> {
  const params = new URLSearchParams()
  if (filters.cursor) params.set("cursor", filters.cursor)
  if (filters.limit) params.set("limit", String(filters.limit))
  if (filters.from) params.set("from", filters.from)
  if (filters.to) params.set("to", filters.to)
  if (filters.api_key_id) params.set("api_key_id", filters.api_key_id)
  const qs = params.toString()
  return apiFetch(`/v1/usage${qs ? `?${qs}` : ""}`, token)
}

export async function fetchUsageStats(token: string, filters: { from?: string; to?: string } = {}): Promise<UsageStats> {
  const params = new URLSearchParams()
  if (filters.from) params.set("from", filters.from)
  if (filters.to) params.set("to", filters.to)
  const qs = params.toString()
  return apiFetch(`/v1/usage/stats${qs ? `?${qs}` : ""}`, token)
}

export async function fetchInvoices(token: string): Promise<Invoice[]> {
  return apiFetch("/v1/invoices", token)
}

export async function fetchInvoice(token: string, id: string): Promise<InvoiceDetail> {
  return apiFetch(`/v1/invoices/${id}`, token)
}

export function formatMoney(minor: number): string {
  return `$${(minor / 1000).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

export function formatPeriod(start: string, end: string): string {
  return `${new Date(start).toLocaleDateString()} – ${new Date(end).toLocaleDateString()}`
}
