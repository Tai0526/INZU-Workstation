/** Lightweight SVG circular progress gauge (0–100). Higher = better. */
export default function RingGauge({
  value,
  label,
  size = 68,
  stroke = 8,
}: {
  value: number
  label: string
  size?: number
  stroke?: number
}) {
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  const pct = Math.max(0, Math.min(100, value))
  const offset = c * (1 - pct / 100)
  const color = pct >= 90 ? '#2E7D4F' : pct >= 75 ? '#C9A227' : '#B3261E'

  return (
    <div className="flex flex-col items-center gap-1">
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size}>
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#ECECEC" strokeWidth={stroke} />
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke={color}
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={c}
            strokeDashoffset={offset}
            transform={`rotate(-90 ${size / 2} ${size / 2})`}
          />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center text-sm font-bold text-navy">{pct}%</div>
      </div>
      <span className="text-[11px] text-status-neutral">{label}</span>
    </div>
  )
}
