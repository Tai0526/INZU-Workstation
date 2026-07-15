import { useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'

/**
 * One-shot deep-link handler for the dashboard / notifications "needs your
 * attention" links. When any of `keys` is present in the URL, `apply(params)` runs
 * once to pre-filter the page to the relevant rows, then the params are stripped so
 * they don't stick on refresh or back-navigation. Mirrors the incidents
 * ?stage=/?case= pattern, factored out so every action page lands the same way.
 */
export function useDeepLink(keys: string[], apply: (params: URLSearchParams) => void) {
  const [params, setParams] = useSearchParams()
  useEffect(() => {
    if (!keys.some((k) => params.has(k))) return
    apply(params)
    setParams({}, { replace: true }) // consume so it doesn't persist
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params])
}
