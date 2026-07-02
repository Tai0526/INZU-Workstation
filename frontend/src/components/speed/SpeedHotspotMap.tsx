import { useEffect, useRef } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import 'leaflet.heat'

export interface HeatPoint { lat: number; lng: number; weight: number; label: string }

/**
 * Real (OpenStreetMap) map with a heat layer + per-event markers, so the team
 * can see WHERE speeding clusters on the ground. Rendered imperatively — Leaflet
 * manages its own DOM, so we just feed it the current point set.
 */
export default function SpeedHotspotMap({ points }: { points: HeatPoint[] }) {
  const el = useRef<HTMLDivElement>(null)
  const map = useRef<L.Map | null>(null)
  const overlays = useRef<L.Layer[]>([])

  useEffect(() => {
    if (!el.current || map.current) return
    try {
      const m = L.map(el.current, { scrollWheelZoom: false }).setView([-12.25, 25.4], 10)
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' }).addTo(m)
      map.current = m
      // Leaflet mis-sizes if the container animates/lays out after mount.
      setTimeout(() => { try { m.invalidateSize() } catch { /* ignore */ } }, 120)
    } catch (e) {
      console.error('[speed-map] init failed:', e)
    }
    return () => { try { map.current?.remove() } catch { /* ignore */ } map.current = null }
  }, [])

  useEffect(() => {
    const m = map.current
    if (!m) return
    try {
      overlays.current.forEach((l) => m.removeLayer(l))
      overlays.current = []
      if (points.length === 0) return

      // Heat layer (leaflet.heat) — guard in case the plugin didn't attach.
      const heatFn = (L as unknown as { heatLayer?: (pts: [number, number, number][], opts?: object) => L.Layer }).heatLayer
      if (typeof heatFn === 'function') {
        const heat = heatFn(
          points.map((p) => [p.lat, p.lng, Math.max(0.25, Math.min(1, p.weight))] as [number, number, number]),
          { radius: 24, blur: 18, maxZoom: 16, minOpacity: 0.35, gradient: { 0.2: '#0F1B33', 0.5: '#C9A227', 1: '#B3261E' } },
        )
        heat.addTo(m)
        overlays.current.push(heat)
      }

      for (const p of points) {
        const marker = L.circleMarker([p.lat, p.lng], { radius: 4, color: '#B3261E', weight: 1, fillColor: '#B3261E', fillOpacity: 0.4 }).bindPopup(p.label)
        marker.addTo(m)
        overlays.current.push(marker)
      }

      const bounds = L.latLngBounds(points.map((p) => [p.lat, p.lng] as [number, number]))
      m.fitBounds(bounds, { padding: [26, 26], maxZoom: 15 })
    } catch (e) {
      console.error('[speed-map] render failed:', e)
    }
  }, [points])

  return <div ref={el} className="h-72 w-full overflow-hidden rounded-lg border border-black/10" />
}
