import { NavLink, useNavigate } from "react-router-dom"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

const links = [
  { to: "/dashboard", label: "Dashboard" },
  { to: "/usage", label: "Usage" },
  { to: "/invoices", label: "Invoices" },
]

export default function Nav({ onSignOut }: { onSignOut: () => void }) {
  const navigate = useNavigate()

  function signOut() {
    onSignOut()
    navigate("/")
  }

  return (
    <header className="border-b bg-background sticky top-0 z-10">
      <div className="max-w-5xl mx-auto px-4 h-14 flex items-center gap-6">
        <span className="font-semibold text-sm">Billing Portal</span>
        <nav className="flex items-center gap-1 flex-1">
          {links.map(({ to, label }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                cn(
                  "px-3 py-1.5 rounded-md text-sm transition-colors",
                  isActive
                    ? "bg-accent text-accent-foreground font-medium"
                    : "text-muted-foreground hover:text-foreground hover:bg-accent/50"
                )
              }
            >
              {label}
            </NavLink>
          ))}
        </nav>
        <Button variant="ghost" size="sm" onClick={signOut}>Sign out</Button>
      </div>
    </header>
  )
}
