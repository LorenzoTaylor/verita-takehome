import { useEffect, useRef } from "react"
import { initLiquidGradient, type LiquidGradientOptions } from "@/lib/liquid-gradient"

type Props = LiquidGradientOptions & {
  className?: string
  style?: React.CSSProperties
  children?: React.ReactNode
}

export default function LiquidGradient({ scheme = 1, speedScale, className, style, children }: Props) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!ref.current) return
    const handle = initLiquidGradient(ref.current, { scheme, speedScale })
    return () => handle.destroy()
  }, [scheme, speedScale])

  return (
    <div
      ref={ref}
      className={className}
      style={{ overflow: "hidden", background: "#0a0e27", ...style }}
    >
      {children && (
        <div className="absolute inset-0 z-10 flex flex-col justify-between p-10 text-white pointer-events-none [&>*]:pointer-events-auto">
          {children}
        </div>
      )}
    </div>
  )
}
