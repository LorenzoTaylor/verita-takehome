import { useEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import {
  Dialog, DialogContent, DialogHeader, DialogBody, DialogFooter, DialogTitle, DialogClose,
} from "@/components/ui/dialog"
import { cn } from "@/lib/utils"
import { Icon } from "@/components/SidebarLayout"
import { API_BASE } from "@/api"

type ApiKey = {
  id: string
  name: string
  prefix: string
  created_at: string
  revoked_at: string | null
}

async function apiFetch<T>(url: string, token: string, init?: RequestInit): Promise<T> {
  const res = await fetch(API_BASE + url, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...init?.headers },
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body.error ?? `HTTP ${res.status}`)
  }
  return res.json()
}

export default function ApiKeysPage({ token }: { token: string }) {
  const [keys, setKeys] = useState<ApiKey[]>([])
  const [createOpen, setCreateOpen] = useState(false)
  const [revealOpen, setRevealOpen] = useState(false)
  const [revealedSecret, setRevealedSecret] = useState("")
  const [revealedName, setRevealedName] = useState("")

  async function reload() {
    const data = await apiFetch<ApiKey[]>("/v1/api-keys", token).catch(() => [])
    setKeys(data.filter((k) => !k.revoked_at))
  }

  useEffect(() => { reload() }, [token])

  function handleCreated(name: string, secret: string) {
    setCreateOpen(false)
    setRevealedName(name)
    setRevealedSecret(secret)
    setRevealOpen(true)
    reload()
  }

  async function handleRevoke(id: string) {
    await fetch(`${API_BASE}/v1/api-keys/${id}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    })
    reload()
  }

  return (
    <>
      <div className="h-14 flex-shrink-0 border-b border-[hsl(var(--verita-border))] bg-white flex items-center px-7 gap-3.5">
        <h1 className="text-base font-semibold tracking-tight">API keys</h1>
        <div className="ml-auto flex items-center gap-2">
          <Button size="sm" className="h-8" onClick={() => setCreateOpen(true)}>
            <span className="mr-1">+</span> New API key
          </Button>
        </div>
      </div>

      <div className="p-7 w-full">
        <div className="bg-white rounded-xl border border-[hsl(var(--verita-border))] shadow-sm overflow-hidden">
          {keys.length === 0 ? (
            <div className="px-5 py-10 text-center text-sm text-muted-foreground">No active API keys.</div>
          ) : (
            <table className="w-full text-[13.5px]">
              <thead>
                <tr className="bg-[hsl(60_8%_97%)] border-b border-[hsl(var(--verita-border))]">
                  <th className="text-left px-5 py-2.5 text-xs font-medium text-muted-foreground">Name</th>
                  <th className="text-left px-5 py-2.5 text-xs font-medium text-muted-foreground">Token</th>
                  <th className="text-left px-5 py-2.5 text-xs font-medium text-muted-foreground">Created</th>
                  <th className="text-right px-5 py-2.5 text-xs font-medium text-muted-foreground w-12"></th>
                </tr>
              </thead>
              <tbody>
                {keys.map((k) => (
                  <tr key={k.id} className="border-b last:border-0 border-[hsl(var(--verita-border))]">
                    <td className="px-5 py-3 font-medium">{k.name}</td>
                    <td className="px-5 py-3 font-mono-numeric text-xs text-muted-foreground">{k.prefix}••••••••••••••••••••</td>
                    <td className="px-5 py-3 text-[12.5px] text-muted-foreground">
                      {new Date(k.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                    </td>
                    <td className="px-5 py-3 text-right">
                      <RowMenu onRevoke={() => handleRevoke(k.id)} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <CreateKeyDialog token={token} open={createOpen} onClose={() => setCreateOpen(false)} onCreated={handleCreated} />
      <RevealKeyDialog open={revealOpen} onClose={() => setRevealOpen(false)} name={revealedName} secret={revealedSecret} />
    </>
  )
}

function RowMenu({ onRevoke }: { onRevoke: () => void }) {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState({ top: 0, right: 0 })
  const btnRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  function toggle() {
    if (!open && btnRef.current) {
      const r = btnRef.current.getBoundingClientRect()
      setPos({ top: r.bottom + 4, right: window.innerWidth - r.right })
    }
    setOpen((v) => !v)
  }

  useEffect(() => {
    if (!open) return
    function onDown(e: MouseEvent) {
      if (
        menuRef.current && !menuRef.current.contains(e.target as Node) &&
        btnRef.current && !btnRef.current.contains(e.target as Node)
      ) setOpen(false)
    }
    document.addEventListener("mousedown", onDown)
    return () => document.removeEventListener("mousedown", onDown)
  }, [open])

  return (
    <div className="inline-block">
      <button
        ref={btnRef}
        onClick={toggle}
        className="h-7 w-7 grid place-items-center rounded-md hover:bg-black/[0.04] text-muted-foreground"
        aria-label="More actions"
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor">
          <circle cx="5" cy="12" r="1.6" /><circle cx="12" cy="12" r="1.6" /><circle cx="19" cy="12" r="1.6" />
        </svg>
      </button>
      {open && createPortal(
        <div
          ref={menuRef}
          style={{ top: pos.top, right: pos.right }}
          className="fixed z-50 min-w-[160px] bg-white border border-[hsl(var(--verita-border))] rounded-lg shadow-[0_10px_28px_-6px_rgba(15,10,50,0.18),0_4px_10px_-2px_rgba(15,10,50,0.10)] p-1 text-left animate-in fade-in-0 duration-150"
        >
          <MenuItem icon={<TrashIcon />} label="Revoke key" danger onClick={() => { setOpen(false); onRevoke() }} />
        </div>,
        document.body
      )}
    </div>
  )
}

function MenuItem({ icon, label, danger, onClick }: { icon: React.ReactNode; label: string; danger?: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex items-center gap-2.5 w-full px-2.5 py-1.5 rounded text-[13px] transition-colors",
        danger ? "text-destructive hover:bg-destructive/10" : "text-foreground hover:bg-[hsl(60_8%_95%)]"
      )}
    >
      <span className={cn("w-3.5 h-3.5 inline-grid place-items-center", danger ? "text-destructive" : "text-muted-foreground")}>{icon}</span>
      {label}
    </button>
  )
}

function CreateKeyDialog({
  token,
  open,
  onClose,
  onCreated,
}: {
  token: string
  open: boolean
  onClose: () => void
  onCreated: (name: string, secret: string) => void
}) {
  const [name, setName] = useState("Production · web")
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState("")

  async function submit() {
    setSubmitting(true)
    setError("")
    try {
      const data = await apiFetch<{ id: string; name: string; prefix: string; secret: string; created_at: string }>(
        "/v1/api-keys",
        token,
        { method: "POST", body: JSON.stringify({ name }) },
      )
      onCreated(data.name, data.secret)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create key.")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-[460px]">
        <DialogHeader icon={<Icon name="key" />}>
          <DialogTitle>Create API key</DialogTitle>
        </DialogHeader>
        <DialogBody>
          <div className="space-y-1.5">
            <label className="text-[12.5px] font-medium">Key name</label>
            <Input value={name} onChange={(e) => setName(e.target.value)} autoFocus />
          </div>
          {error && <p className="text-sm text-destructive mt-3">{error}</p>}
        </DialogBody>
        <DialogFooter>
          <DialogClose asChild><Button variant="ghost" size="sm">Cancel</Button></DialogClose>
          <Button size="sm" onClick={submit} disabled={!name.trim() || submitting}>
            {submitting ? "Creating…" : "Create key"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function RevealKeyDialog({ open, onClose, name, secret }: { open: boolean; onClose: () => void; name: string; secret: string }) {
  const [copied, setCopied] = useState(false)

  async function copy() {
    try { await navigator.clipboard.writeText(secret) } catch {}
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-[520px]">
        <DialogHeader icon={<Icon name="alert" />} danger>
          <DialogTitle>Copy your key now</DialogTitle>
          <p className="text-[12.5px] text-muted-foreground mt-1">This is the only time the secret is shown.</p>
        </DialogHeader>
        <DialogBody>
          <div className="space-y-1.5">
            <label className="text-[12.5px] font-medium">{name}</label>
            <div className="flex items-center gap-2 p-3 border border-[hsl(var(--verita-border))] rounded-md bg-[hsl(60_8%_95%)] font-mono-numeric text-xs break-all">
              <span className="flex-1">{secret}</span>
              <button
                onClick={copy}
                className="flex-shrink-0 h-7 w-7 grid place-items-center rounded-md border border-[hsl(var(--verita-border))] bg-white hover:bg-[hsl(60_8%_97%)]"
                title={copied ? "Copied" : "Copy"}
              >
                {copied ? <CheckIcon /> : <CopyIcon />}
              </button>
            </div>
          </div>
        </DialogBody>
        <DialogFooter className="bg-white">
          <Button className="w-full" onClick={onClose}>I've saved this key</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function CopyIcon()  { return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg> }
function CheckIcon() { return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><path d="m5 12 5 5L20 7"/></svg> }
function TrashIcon() { return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/></svg> }
