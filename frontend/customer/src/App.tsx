import { useState } from "react"
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom"
import Nav from "@/components/Nav"
import Login from "@/pages/Login"
import Dashboard from "@/pages/Dashboard"
import UsagePage from "@/pages/UsagePage"
import InvoicesPage from "@/pages/InvoicesPage"
import InvoiceDetail from "@/pages/InvoiceDetail"

function AuthedLayout({ token, onSignOut }: { token: string; onSignOut: () => void }) {
  return (
    <div className="min-h-screen bg-background">
      <Nav onSignOut={onSignOut} />
      <main className="max-w-5xl mx-auto px-4 py-8">
        <Routes>
          <Route path="/dashboard" element={<Dashboard token={token} />} />
          <Route path="/usage" element={<UsagePage token={token} />} />
          <Route path="/invoices" element={<InvoicesPage token={token} />} />
          <Route path="/invoices/:id" element={<InvoiceDetail token={token} />} />
          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Routes>
      </main>
    </div>
  )
}

export default function App() {
  const [token, setApiKey] = useState<string | null>(null)

  return (
    <BrowserRouter>
      {token ? (
        <AuthedLayout token={token} onSignOut={() => setApiKey(null)} />
      ) : (
        <Routes>
          <Route path="/" element={<Login onLogin={setApiKey} />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      )}
    </BrowserRouter>
  )
}
