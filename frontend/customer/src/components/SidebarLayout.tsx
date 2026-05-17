import { NavLink, useNavigate } from "react-router-dom"
import { cn } from "@/lib/utils"

function Icon({ name, className }: { name: string; className?: string }) {
  const c = cn("h-[15px] w-[15px]", className)
  const props = {
    className: c,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.75,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  }
  switch (name) {
    case "home":     return <svg {...props}><path d="M3 11.5 12 4l9 7.5"/><path d="M5 10v10h14V10"/></svg>
    case "activity": return <svg {...props}><path d="M3 12h4l3-8 4 16 3-8h4"/></svg>
    case "invoice":  return <svg {...props}><path d="M6 3h9l3 3v15H6z"/><path d="M9 9h6M9 13h6M9 17h4"/></svg>
    case "key":      return <svg {...props}><circle cx="8" cy="14" r="4"/><path d="m11 12 9-9M16 7l2 2M19 4l2 2"/></svg>
    case "bell":     return <svg {...props}><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/></svg>
    case "alert":    return <svg {...props}><path d="M10.3 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><path d="M12 9v4M12 17h.01"/></svg>
    default: return null
  }
}

const LINKS = [
  { to: "/dashboard", label: "Dashboard", icon: "home" },
  { to: "/usage",     label: "Usage",     icon: "activity" },
  { to: "/invoices",  label: "Invoices",  icon: "invoice" },
]

const DEV_LINKS = [
  { to: "/api-keys", label: "API keys", icon: "key" },
]

type Props = { children: React.ReactNode; onSignOut: () => void; userEmail?: string; userName?: string }

export default function SidebarLayout({ children, onSignOut, userName = "", userEmail = "" }: Props) {
  const navigate = useNavigate()
  function signOut() { onSignOut(); navigate("/") }

  return (
    <div className="flex h-screen bg-[hsl(var(--verita-bg-app))] overflow-hidden">
      {/* Sidebar */}
      <aside className="w-[232px] flex-shrink-0 bg-[hsl(var(--verita-sidebar))] border-r border-[hsl(var(--verita-border))] flex flex-col p-[10px] gap-1">
        {/* Workspace identity — non-interactive */}
        <div className="flex items-center gap-[9px] px-2 py-[7px]">
          <span className="flex-1 text-left text-[13.5px] font-medium tracking-tight">Lattice Cloud</span>
        </div>

        <div className="mt-1.5">
          {LINKS.map((l) => (
            <NavItem key={l.to} {...l} />
          ))}
        </div>

        <div className="mt-3">
          <div className="px-2.5 py-1.5 text-[10.5px] font-medium uppercase tracking-[0.08em] text-[hsl(var(--verita-fg-subtle))]">Developers</div>
          {DEV_LINKS.map((l) => <NavItem key={l.to} {...l} />)}
        </div>

        <div className="flex-1" />

        {/* Profile footer */}
        <button onClick={signOut} className="border-t border-[hsl(var(--verita-border))] -mx-2.5 mt-2 px-2.5 pt-2.5 flex items-center gap-2.5 hover:bg-black/[0.03] transition-colors text-left">
          <div className="w-[26px] h-[26px] rounded-full grid place-items-center text-white text-[11px] font-semibold shadow-[inset_0_0_0_1.5px_white]"
               style={{ background: "linear-gradient(135deg, hsl(35 60% 65%), hsl(15 75% 50%))" }}>
            {userName ? userName.split(" ").map((w) => w[0]).slice(0, 2).join("") : "…"}
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-[13px] font-medium truncate">{userName}</div>
            <div className="text-[11.5px] text-[hsl(var(--verita-fg-subtle))] truncate">{userEmail}</div>
          </div>
        </button>
      </aside>

      {/* Main */}
      <main className="flex-1 overflow-y-auto verita-scroll flex flex-col">
        {children}
      </main>
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
          <Icon name={icon} className={cn("h-[15px] w-[15px]", isActive ? "text-foreground" : "text-[hsl(var(--verita-fg-muted))]")} />
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
