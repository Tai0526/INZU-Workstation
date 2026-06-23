import { Component, type ReactNode } from 'react'
import { AlertTriangle } from 'lucide-react'
import Button from '@/components/ui/Button'
import { clearAllData } from '@/lib/demo/reset'

/**
 * Catches render errors in a page so one broken screen doesn't blank the whole
 * app. Shows the error and offers a recovery path (reload, or reset the data —
 * the usual culprit after a data-format change).
 */
export default class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  componentDidCatch(error: Error, info: unknown) {
    console.error('Page render error:', error, info)
  }

  render() {
    const { error } = this.state
    if (!error) return this.props.children
    return (
      <div className="page">
        <div className="card mx-auto mt-10 max-w-xl p-6">
          <div className="mb-2 flex items-center gap-2 text-status-critical">
            <AlertTriangle size={20} />
            <h2 className="font-display text-base font-bold">This page hit an error</h2>
          </div>
          <p className="text-sm text-status-neutral">
            The page couldn't render. This often happens when stored data is in an old format. Reloading, or resetting the data, usually clears it.
          </p>
          <pre className="mt-3 max-h-40 overflow-auto rounded-lg bg-canvas p-3 text-[11px] text-status-critical">{String(error.message || error)}</pre>
          <div className="mt-4 flex gap-2">
            <Button onClick={() => location.reload()}>Reload page</Button>
            <Button variant="danger" onClick={() => { if (confirm('Clear all data and reload? This wipes every record.')) clearAllData() }}>Clear data &amp; reload</Button>
          </div>
        </div>
      </div>
    )
  }
}
