import { useState } from "react"
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom"
import Nav from "@/components/Nav"
import Login from "@/pages/Login"
import CustomerList from "@/pages/CustomerList"
import CustomerDetail from "@/pages/CustomerDetail"

function AuthedLayout({ token, onSignOut }: { token: string; onSignOut: () => void }) {
  return (
    <div className="min-h-screen bg-background">
      <Nav onSignOut={onSignOut} />
      <main className="max-w-5xl mx-auto px-4 py-8">
        <Routes>
          <Route path="/customers" element={<CustomerList token={token} />} />
          <Route path="/customers/:id" element={<CustomerDetail token={token} />} />
          <Route path="*" element={<Navigate to="/customers" replace />} />
        </Routes>
      </main>
    </div>
  )
}

export default function App() {
  const [token, setToken] = useState<string | null>(null)

  return (
    <BrowserRouter>
      {token ? (
        <AuthedLayout token={token} onSignOut={() => setToken(null)} />
      ) : (
        <Routes>
          <Route path="/" element={<Login onLogin={setToken} />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      )}
    </BrowserRouter>
  )
}
