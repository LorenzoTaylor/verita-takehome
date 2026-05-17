import { useState } from "react"
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom"
import SidebarLayout from "@/components/SidebarLayout"
import Login from "@/pages/Login"
import OverviewPage from "@/pages/OverviewPage"
import CustomerList from "@/pages/CustomerList"
import CustomerDetail from "@/pages/CustomerDetail"
import InvoicesPage from "@/pages/InvoicesPage"
import CreditsPage from "@/pages/CreditsPage"
import AnomaliesPage from "@/pages/AnomaliesPage"

function jwtEmail(token: string): string {
  try {
    const payload = JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")))
    return payload.email ?? ""
  } catch {
    return ""
  }
}

function AuthedApp({ token, email, onSignOut }: { token: string; email: string; onSignOut: () => void }) {
  return (
    <SidebarLayout onSignOut={onSignOut} userName={email}>
      <Routes>
        <Route path="/overview" element={<OverviewPage token={token} />} />
        <Route path="/customers" element={<CustomerList token={token} />} />
        <Route path="/customers/:id" element={<CustomerDetail token={token} />} />
        <Route path="/invoices" element={<InvoicesPage token={token} />} />
        <Route path="/credits" element={<CreditsPage token={token} />} />
        <Route path="/anomalies" element={<AnomaliesPage token={token} />} />
        <Route path="*" element={<Navigate to="/overview" replace />} />
      </Routes>
    </SidebarLayout>
  )
}

export default function App() {
  const [token, setToken] = useState<string | null>(() => localStorage.getItem("ops_token"))

  function handleLogin(t: string) { localStorage.setItem("ops_token", t); setToken(t) }
  function handleSignOut() { localStorage.removeItem("ops_token"); setToken(null) }

  const email = token ? jwtEmail(token) : ""

  return (
    <BrowserRouter>
      {token ? (
        <AuthedApp token={token} email={email} onSignOut={handleSignOut} />
      ) : (
        <Routes>
          <Route path="/" element={<Login onLogin={handleLogin} />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      )}
    </BrowserRouter>
  )
}
