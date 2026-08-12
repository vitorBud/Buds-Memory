import { useEffect, useRef, useState } from 'react'
import * as L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import type { KnownPlace, LocationRoutePoint } from '../../types'

interface MapaRasterIOSProps {
  latitude: number
  longitude: number
  places: KnownPlace[]
  routePoints: LocationRoutePoint[]
}

const CARTO_LIGHT = 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png'
const OSM_FALLBACK = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png'

/**
 * Renderer raster deliberadamente simples para o WKWebView e fallback web.
 * Não precisa criar WebGL workers nem interpretar PBF; recebe imagens HTTPS
 * que o navegador já sabe compor com estabilidade.
 */
export function MapaRasterIOS({ latitude, longitude, places, routePoints }: MapaRasterIOSProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<L.Map | null>(null)
  const overlayRef = useRef<L.LayerGroup | null>(null)
  const [mapError, setMapError] = useState('')

  useEffect(() => {
    const container = containerRef.current
    if (!container || !Number.isFinite(latitude) || !Number.isFinite(longitude)) return

    const map = L.map(container, {
      attributionControl: true,
      doubleClickZoom: false,
      preferCanvas: true,
      scrollWheelZoom: true,
      zoomControl: true,
    }).setView([latitude, longitude], 15)

    let failures = 0
    let fallbackApplied = false
    let tileLayer = L.tileLayer(CARTO_LIGHT, {
      attribution: '&copy; OpenStreetMap &copy; CARTO',
      className: 'buds-map-monochrome-tiles',
      crossOrigin: true,
      maxZoom: 20,
      subdomains: 'abcd',
    })

    const useFallback = () => {
      failures += 1
      if (failures < 3 || fallbackApplied) return
      fallbackApplied = true
      tileLayer.removeFrom(map)
      tileLayer = L.tileLayer(OSM_FALLBACK, {
        attribution: '&copy; OpenStreetMap',
        className: 'buds-map-monochrome-tiles',
        crossOrigin: true,
        maxZoom: 19,
      }).addTo(map)
      tileLayer.once('load', () => setMapError(''))
      tileLayer.on('tileerror', () => setMapError('Não foi possível carregar o mapa. Verifique a conexão com a internet.'))
    }

    tileLayer.on('tileerror', useFallback)
    tileLayer.once('load', () => setMapError(''))
    tileLayer.addTo(map)

    const overlays = L.layerGroup().addTo(map)
    mapRef.current = map
    overlayRef.current = overlays

    const observer = new ResizeObserver(() => map.invalidateSize({ pan: false }))
    observer.observe(container)
    window.setTimeout(() => map.invalidateSize({ pan: false }), 80)

    return () => {
      observer.disconnect()
      overlayRef.current = null
      mapRef.current = null
      map.remove()
    }
    // As camadas móveis são atualizadas pelo efeito abaixo.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const map = mapRef.current
    const overlays = overlayRef.current
    if (!map || !overlays) return
    overlays.clearLayers()

    L.circleMarker([latitude, longitude], {
      color: '#ffffff',
      fillColor: '#111111',
      fillOpacity: 1,
      radius: 8,
      weight: 3,
    }).addTo(overlays).bindTooltip('Você está aqui', { direction: 'top' })

    for (const place of places.filter(item => item.enabled)) {
      L.circleMarker([place.latitude, place.longitude], {
        color: '#686868',
        fillColor: '#171717',
        fillOpacity: 0.92,
        radius: 7,
        weight: 2,
      }).addTo(overlays).bindTooltip(place.name, { direction: 'top' })
    }

    if (routePoints.length > 1) {
      const routeCoordinates = routePoints.map(point => [point.latitude, point.longitude] as L.LatLngTuple)
      L.polyline(routeCoordinates, {
        color: '#ffffff',
        opacity: 0.96,
        weight: 4,
      }).addTo(overlays)
      L.circleMarker(routeCoordinates[0], {
        color: '#ffffff', fillColor: '#ffffff', fillOpacity: 1, radius: 6, weight: 2,
      }).addTo(overlays).bindTooltip('Início', { direction: 'top' })
      L.circleMarker(routeCoordinates[routeCoordinates.length - 1], {
        color: '#ffffff', fillColor: '#303030', fillOpacity: 1, radius: 6, weight: 2,
      }).addTo(overlays).bindTooltip('Fim', { direction: 'top' })
      map.fitBounds(L.latLngBounds(routeCoordinates), { animate: false, padding: [28, 28], maxZoom: 17 })
    } else if (routePoints.length === 1) {
      const point = routePoints[0]
      L.circleMarker([point.latitude, point.longitude], {
        color: '#ffffff', fillColor: '#ffffff', fillOpacity: 1, radius: 6, weight: 2,
      }).addTo(overlays).bindTooltip('Início', { direction: 'top' })
      map.setView([point.latitude, point.longitude], 16, { animate: false })
    } else {
      map.panTo([latitude, longitude], { animate: false })
    }
  }, [latitude, longitude, places, routePoints])

  return (
    <>
      <div ref={containerRef} className="buds-leaflet-map absolute inset-0 size-full" aria-label="Mapa interativo do contexto atual" />
      {mapError && (
        <div className="pointer-events-none absolute inset-x-3 bottom-3 z-[500] rounded-xl border border-white/12 bg-black/85 px-3 py-2 text-center text-[11px] text-white/80" role="status">
          {mapError}
        </div>
      )}
    </>
  )
}
