import clsx from 'clsx'

type Variant = 'primary' | 'secondary' | 'danger' | 'ghost'

const VARIANTS: Record<Variant, string> = {
  primary: 'bg-navy text-white hover:bg-navy-secondary',
  secondary: 'border border-navy/20 bg-white text-navy hover:bg-canvas',
  danger: 'border border-status-critical/30 bg-white text-status-critical hover:bg-status-critical/5',
  ghost: 'text-navy hover:bg-canvas',
}

export default function Button({
  variant = 'primary',
  className,
  children,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return (
    <button
      {...props}
      className={clsx(
        'inline-flex items-center justify-center gap-1.5 rounded-lg px-3.5 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50',
        VARIANTS[variant],
        className,
      )}
    >
      {children}
    </button>
  )
}
