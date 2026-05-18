type Props = {
  title: string
  actions?: React.ReactNode
  children: React.ReactNode
}

export default function PageLayout({ title, actions, children }: Props) {
  return (
    <>
      <div className="h-14 flex-shrink-0 border-b border-[hsl(var(--verita-border))] bg-white flex items-center px-7 gap-3.5">
        <h1 className="text-base font-semibold tracking-tight">{title}</h1>
        {actions && <div className="ml-auto flex items-center gap-2">{actions}</div>}
      </div>
      <div className="p-7 w-full">
        {children}
      </div>
    </>
  )
}
