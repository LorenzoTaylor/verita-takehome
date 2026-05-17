import { useState, useEffect } from "react"
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom"
import SidebarLayout from "@/components/SidebarLayout"
import Login from "@/pages/Login"
import Dashboard from "@/pages/Dashboard"
import UsagePage from "@/pages/UsagePage"
import InvoicesPage from "@/pages/InvoicesPage"
import InvoiceDetail from "@/pages/InvoiceDetail"
import ApiKeysPage from "@/pages/ApiKeysPage"
import { fetchMe, type Me } from "@/api"

function AuthedApp({ token, user, onSignOut }: { token: string; user: Me | null; onSignOut: () => void }) {
  return (
    <SidebarLayout onSignOut={onSignOut} userName={user?.name} userEmail={user?.email}>
      <Routes>
        <Route path="/dashboard" element={<Dashboard token={token} />} />
        <Route path="/usage" element={<UsagePage token={token} />} />
        <Route path="/invoices" element={<InvoicesPage token={token} />} />
        <Route path="/invoices/:id" element={<InvoiceDetail token={token} />} />
        <Route path="/api-keys" element={<ApiKeysPage token={token} />} />
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Routes>
    </SidebarLayout>
  )
}

export default function App() {
  const [token, setToken] = useState<string | null>(() => localStorage.getItem("customer_token"))
  const [user, setUser] = useState<Me | null>(null)

  // Hydrate user on mount when a stored token exists (handles page refresh)
  useEffect(() => {
    const stored = localStorage.getItem("customer_token")
    if (stored) {
      fetchMe(stored).then(setUser).catch(() => {
        localStorage.removeItem("customer_token")
        setToken(null)
      })
    }
  }, [])

  async function handleLogin(t: string) {
    localStorage.setItem("customer_token", t)
    setToken(t)
    const me = await fetchMe(t).catch(() => null)
    setUser(me)
  }

  function handleSignOut() {
    localStorage.removeItem("customer_token")
    setToken(null)
    setUser(null)
  }

  return (
    <BrowserRouter>
      {token ? (
        <AuthedApp token={token} user={user} onSignOut={handleSignOut} />
      ) : (
        <Routes>
          <Route path="/" element={<Login onLogin={handleLogin} />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      )}
    </BrowserRouter>
  )
}
