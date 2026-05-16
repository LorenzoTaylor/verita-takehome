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

async function apiFetch<T>(url: string, token: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
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
  const res = await fetch("/ops/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  })
  if (!res.ok) throw new Error("Invalid credentials")
  const data = await res.json()
  return data.token as string
}

export async function fetchCustomers(token: string): Promise<Customer[]> {
  return apiFetch("/ops/customers", token)
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
  return `$${(minor / 1000).toFixed(2)}`
}

export function formatPeriod(start: string, end: string): string {
  return `${new Date(start).toLocaleDateString()} – ${new Date(end).toLocaleDateString()}`
}
