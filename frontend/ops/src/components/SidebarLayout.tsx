import { NavLink, useNavigate } from "react-router-dom"
import { cn } from "@/lib/utils"

function Icon({ name, className }: { name: string; className?: string }) {
  const c = cn("h-[15px] w-[15px]", className)
  const props = {
    className: c, viewBox: "0 0 24 24", fill: "none",
    stroke: "currentColor", strokeWidth: 1.75,
    strokeLinecap: "round" as const, strokeLinejoin: "round" as const,
  }
  switch (name) {
    case "home":     return <svg {...props}><path d="M3 11.5 12 4l9 7.5"/><path d="M5 10v10h14V10"/></svg>
    case "users":    return <svg {...props}><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
    case "invoice":  return <svg {...props}><path d="M6 3h9l3 3v15H6z"/><path d="M9 9h6M9 13h6M9 17h4"/></svg>
    case "credit":   return <svg {...props}><rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20"/></svg>
    case "alert":    return <svg {...props}><path d="M10.3 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><path d="M12 9v4M12 17h.01"/></svg>
    case "log":      return <svg {...props}><path d="M4 4h16v4H4zM4 12h16v4H4zM4 20h10"/></svg>
    case "settings": return <svg {...props}><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1A1.7 1.7 0 0 0 4.6 9a1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9c.3.6.9 1 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>
    case "search":   return <svg {...props}><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>
    case "chev":     return <svg {...props}><path d="m8 9 4-4 4 4M8 15l4 4 4-4"/></svg>
    case "bell":     return <svg {...props}><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/></svg>
    case "plus":     return <svg {...props}><path d="M12 5v14M5 12h14"/></svg>
    case "filter":   return <svg {...props}><path d="M3 4h18l-7 9v6l-4 2v-8z"/></svg>
    default: return null
  }
}

const PRIMARY = [
  { to: "/overview",  label: "Overview",  icon: "home" },
  { to: "/customers", label: "Customers", icon: "users" },
  { to: "/invoices",  label: "Invoices",  icon: "invoice" },
  { to: "/credits",   label: "Credits",   icon: "credit" },
]
const MONITORING = [
  { to: "/anomalies", label: "Anomalies", icon: "alert" },
]

type Props = { children: React.ReactNode; onSignOut: () => void; userName?: string; userRole?: string }

export default function SidebarLayout({ children, onSignOut, userName = "", userRole = "Ops · admin" }: Props) {
  const navigate = useNavigate()
  function signOut() { onSignOut(); navigate("/") }

  return (
    <div className="flex h-screen bg-[hsl(var(--verita-bg-app))] overflow-hidden">
      <aside className="w-[232px] flex-shrink-0 bg-[hsl(var(--verita-sidebar))] border-r border-[hsl(var(--verita-border))] flex flex-col p-[10px] gap-1">
        <div className="flex items-center gap-[9px] px-2 py-[7px]">
          <span className="flex-1 text-left text-[13.5px] font-medium tracking-tight">verita · ops</span>
        </div>

        <div className="mt-1.5">
          {PRIMARY.map((l) => <NavItem key={l.to} {...l} />)}
        </div>

        <div className="mt-3">
          <div className="px-2.5 py-1.5 text-[10.5px] font-medium uppercase tracking-[0.08em] text-[hsl(var(--verita-fg-subtle))]">Monitoring</div>
          {MONITORING.map((l) => <NavItem key={l.to} {...l} />)}
        </div>

        <div className="flex-1" />

        <button onClick={signOut} className="border-t border-[hsl(var(--verita-border))] -mx-2.5 mt-2 px-2.5 pt-2.5 flex items-center gap-2.5 hover:bg-black/[0.03] transition-colors text-left">
          <div className="w-[26px] h-[26px] rounded-full grid place-items-center text-white text-[11px] font-semibold shadow-[inset_0_0_0_1.5px_white]"
               style={{ background: "linear-gradient(135deg, hsl(220 60% 60%), hsl(258 65% 50%))" }}>
            {userName ? userName.split(" ").map(w => w[0]).slice(0, 2).join("") : "…"}
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-[13px] font-medium truncate">{userName}</div>
            <div className="text-[11.5px] text-[hsl(var(--verita-fg-subtle))] truncate">{userRole}</div>
          </div>
        </button>
      </aside>

      <main className="flex-1 overflow-y-auto verita-scroll flex flex-col">{children}</main>
    </div>
  )
}

function NavItem({ to, label, icon, badge }: { to: string; label: string; icon: string; badge?: string }) {
  return (
    <NavLink to={to} className={({ isActive }) => cn(
      "relative flex items-center gap-2.5 px-2.5 py-1.5 rounded-md text-[13.5px] transition-all select-none",
      isActive ? "bg-white shadow-[0_1px_0_rgba(0,0,0,0.05),0_1px_2px_rgba(0,0,0,0.05)] font-medium" : "text-foreground hover:bg-black/[0.04]"
    )}>
      {({ isActive }) => (
        <>
          <Icon name={icon} className={cn(isActive ? "text-foreground" : "text-[hsl(var(--verita-fg-muted))]")} />
          <span>{label}</span>
          {badge !== undefined && (
            <span className={cn(
              "ml-auto text-[11px] font-medium px-1.5 py-px rounded-full border",
              isActive
                ? "bg-[hsl(var(--verita-accent-soft))] text-[hsl(var(--verita-accent-soft-fg))] border-transparent"
                : "bg-[hsl(60_8%_94%)] text-[hsl(var(--verita-fg-muted))] border-[hsl(var(--verita-border))]"
            )}>{badge}</span>
          )}
        </>
      )}
    </NavLink>
  )
}

export { Icon }
