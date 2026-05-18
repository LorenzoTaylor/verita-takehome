import { useEffect, useState } from "react"
import { Link } from "react-router-dom"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Icon } from "@/components/SidebarLayout"
import { fetchCustomers, fetchOverview, type Customer } from "@/api"

export default function CustomerList({ token }: { token: string }) {
  const [customers, setCustomers] = useState<Customer[]>([])
  const [search, setSearch] = useState("")
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [activeAnomalies, setActiveAnomalies] = useState(0)

  useEffect(() => {
    fetchCustomers(token)
      .then(setCustomers)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
    fetchOverview(token).then((s) => setActiveAnomalies(s.active_anomalies)).catch(() => {})
  }, [token])

  const filtered = customers.filter(
    (c) =>
      c.name.toLowerCase().includes(search.toLowerCase()) ||
      c.email.toLowerCase().includes(search.toLowerCase())
  )

  const newThisMonth = customers.filter((c) => {
    const d = new Date(c.created_at)
    const now = new Date()
    return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear()
  }).length

  return (
    <>
      {/* Topbar */}
      <div className="h-14 flex-shrink-0 border-b border-[hsl(var(--verita-border))] bg-white flex items-center px-7 gap-3.5">
        <h1 className="text-base font-semibold tracking-tight">Customers</h1>
        <div className="ml-auto flex items-center gap-2">
          <Badge variant={activeAnomalies > 0 ? "warning" : "success"} className="mr-1">
                        {activeAnomalies > 0 ? `${activeAnomalies} anomalies` : "all systems normal"}
          </Badge>
        </div>
      </div>

      <div className="p-7 w-full">
        {/* Page head */}
        <div className="flex items-end justify-between mb-5">
          <div>
            <h2 className="text-[22px] font-semibold tracking-[-0.018em]">All customers</h2>
            <p className="text-[13.5px] text-muted-foreground mt-1">
              {customers.length} total · {newThisMonth} new this month
            </p>
          </div>
        </div>

        {/* Search & filter row */}
        <div className="flex items-center gap-2 mb-4">
          <div className="relative flex-1 max-w-[420px]">
            <Icon name="users" className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground h-3.5 w-3.5" />
            <Input
              placeholder="Search by name or email…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9 h-9"
            />
          </div>
        </div>

        {/* Table */}
        <div className="bg-white rounded-xl border border-[hsl(var(--verita-border))] shadow-sm overflow-hidden">
          {loading && <div className="p-8 text-center text-sm text-muted-foreground">Loading…</div>}
          {error && <div className="p-8 text-center text-sm text-destructive">{error}</div>}

          {!loading && !error && (
            <table className="w-full text-[13.5px]">
              <thead>
                <tr className="bg-[hsl(60_8%_97%)] border-b border-[hsl(var(--verita-border))]">
                  <th className="text-left px-5 py-2.5 text-xs font-medium text-muted-foreground">Customer</th>
                  <th className="text-left px-5 py-2.5 text-xs font-medium text-muted-foreground">ID</th>
                  <th className="text-left px-5 py-2.5 text-xs font-medium text-muted-foreground">Email</th>
                  <th className="text-left px-5 py-2.5 text-xs font-medium text-muted-foreground">Created</th>
                  <th className="text-right px-5 py-2.5 text-xs font-medium text-muted-foreground"></th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 && (
                  <tr><td colSpan={5} className="text-center py-12 text-muted-foreground">
                    {search ? "No customers match your search." : "No customers yet."}
                  </td></tr>
                )}
                {filtered.map((c) => {
                  const initials = c.name.split(" ").map((w) => w[0]).slice(0, 2).join("").toUpperCase()
                  const AVATAR_COLORS = ["#4285F4","#EA4335","#34A853","#9C27B0","#FF5722","#00ACC1","#3F51B5","#E91E63","#00897B","#F4511E"]
                  const colorIdx = parseInt(c.id.replace(/-/g, "").slice(0, 4), 16) % AVATAR_COLORS.length
                  return (
                    <tr key={c.id} className="border-b last:border-0 border-[hsl(var(--verita-border))] hover:bg-[hsl(60_8%_97%)] transition-colors group">
                      <td className="px-5 py-3">
                        <div className="flex items-center gap-2.5">
                          <div className="w-[34px] h-[34px] rounded-full grid place-items-center text-[12px] font-semibold text-white flex-shrink-0"
                            style={{ background: AVATAR_COLORS[colorIdx] }}>
                            {initials || "?"}
                          </div>
                          <div className="font-medium">{c.name}</div>
                        </div>
                      </td>
                      <td className="px-5 py-3 font-mono-numeric text-muted-foreground text-[12.5px]">
                        {c.id.slice(0, 8)}
                      </td>
                      <td className="px-5 py-3 text-muted-foreground">{c.email}</td>
                      <td className="px-5 py-3 text-muted-foreground text-[12.5px]">
                        {new Date(c.created_at).toLocaleDateString()}
                      </td>
                      <td className="px-5 py-3 text-right">
                        <Link to={`/customers/${c.id}`}
                          className="text-primary text-[12.5px] font-medium hover:underline opacity-70 group-hover:opacity-100">
                          View →
                        </Link>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}

          {!loading && !error && filtered.length > 0 && (
            <div className="px-5 py-3 flex items-center justify-between border-t border-[hsl(var(--verita-border))] bg-[hsl(60_8%_97%)] text-[12.5px] text-muted-foreground">
              <span>Showing {filtered.length} of {customers.length}</span>
            </div>
          )}
        </div>
      </div>
    </>
  )
}
