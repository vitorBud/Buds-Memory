import { useEffect, useRef, useState } from 'react'
import { addProtocol, Map as MapLibre, NavigationControl } from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import type { GeoJSONSource, Map as MapLibreMap, RequestParameters, StyleSpecification } from 'maplibre-gl'
import type { KnownPlace, LocationRoutePoint } from '../../types'
import { getMapVectorTile } from '../../services/mapaOffline'

interface MapaInterativoEscuroProps {
  latitude: number
  longitude: number
  places: KnownPlace[]
  routePoints?: LocationRoutePoint[]
}

let protocolReady = false

function ensureOfflineProtocol() {
  if (protocolReady) return
  addProtocol('buds', async (params: RequestParameters) => {
    const match = params.url.match(/^buds:\/\/tiles\/(\d+)\/(\d+)\/(\d+)$/)
    if (!match) throw new Error('Endereço de tile inválido.')
    const data = await getMapVectorTile(Number(match[1]), Number(match[2]), Number(match[3]))
    return { data }
  })
  protocolReady = true
}

function pointCollection(latitude: number, longitude: number) {
  return {
    type: 'FeatureCollection' as const,
    features: [{
      type: 'Feature' as const,
      properties: {},
      geometry: { type: 'Point' as const, coordinates: [longitude, latitude] },
    }],
  }
}

function placesCollection(places: KnownPlace[]) {
  return {
    type: 'FeatureCollection' as const,
    features: places.filter(place => place.enabled).map(place => ({
      type: 'Feature' as const,
      properties: { name: place.name, context: place.context },
      geometry: { type: 'Point' as const, coordinates: [place.longitude, place.latitude] },
    })),
  }
}

function routeCollection(points: LocationRoutePoint[]) {
  return {
    type: 'FeatureCollection' as const,
    features: points.length > 1 ? [{
      type: 'Feature' as const,
      properties: {},
      geometry: {
        type: 'LineString' as const,
        coordinates: points.map(point => [point.longitude, point.latitude]),
      },
    }] : [],
  }
}

function darkVectorStyle(
  latitude: number,
  longitude: number,
  places: KnownPlace[],
  routePoints: LocationRoutePoint[],
): StyleSpecification {
  return {
    version: 8,
    sources: {
      budsmap: {
        type: 'vector',
        tiles: ['buds://tiles/{z}/{x}/{y}'],
        minzoom: 0,
        maxzoom: 14,
        attribution: 'OpenFreeMap © OpenMapTiles · OpenStreetMap',
      },
      current: { type: 'geojson', data: pointCollection(latitude, longitude) },
      places: { type: 'geojson', data: placesCollection(places) },
      route: { type: 'geojson', data: routeCollection(routePoints) },
    },
    layers: [
      { id: 'background', type: 'background', paint: { 'background-color': '#070707' } },
      { id: 'landcover', type: 'fill', source: 'budsmap', 'source-layer': 'landcover', paint: { 'fill-color': '#111111', 'fill-opacity': 0.72 } },
      { id: 'landuse', type: 'fill', source: 'budsmap', 'source-layer': 'landuse', paint: { 'fill-color': '#151515', 'fill-opacity': 0.7 } },
      { id: 'water', type: 'fill', source: 'budsmap', 'source-layer': 'water', paint: { 'fill-color': '#202124' } },
      { id: 'buildings', type: 'fill', source: 'budsmap', 'source-layer': 'building', minzoom: 12, paint: { 'fill-color': '#0c0c0c', 'fill-outline-color': '#282828' } },
      {
        id: 'roads-minor', type: 'line', source: 'budsmap', 'source-layer': 'transportation', minzoom: 10,
        filter: ['match', ['get', 'class'], ['minor', 'service', 'track', 'path'], true, false],
        paint: { 'line-color': '#363636', 'line-width': ['interpolate', ['linear'], ['zoom'], 10, 0.45, 18, 3.4], 'line-opacity': 0.9 },
      },
      {
        id: 'roads-major', type: 'line', source: 'budsmap', 'source-layer': 'transportation', minzoom: 5,
        filter: ['match', ['get', 'class'], ['motorway', 'trunk', 'primary', 'secondary', 'tertiary'], true, false],
        paint: { 'line-color': '#686868', 'line-width': ['interpolate', ['linear'], ['zoom'], 5, 0.6, 18, 5.2], 'line-opacity': 0.94 },
      },
      { id: 'boundaries', type: 'line', source: 'budsmap', 'source-layer': 'boundary', paint: { 'line-color': '#303030', 'line-dasharray': [2, 2], 'line-width': 1 } },
      { id: 'route-halo', type: 'line', source: 'route', paint: { 'line-color': '#000000', 'line-width': 7, 'line-opacity': 0.82 } },
      { id: 'route-line', type: 'line', source: 'route', paint: { 'line-color': '#f5f5f5', 'line-width': 3.2, 'line-opacity': 0.96 } },
      { id: 'known-places-halo', type: 'circle', source: 'places', paint: { 'circle-radius': 10, 'circle-color': '#0a0a0a', 'circle-stroke-color': '#858585', 'circle-stroke-width': 1.5 } },
      { id: 'known-places', type: 'circle', source: 'places', paint: { 'circle-radius': 4, 'circle-color': '#a3a3a3' } },
      { id: 'current-halo', type: 'circle', source: 'current', paint: { 'circle-radius': 10, 'circle-color': '#050505', 'circle-stroke-color': '#f5f5f5', 'circle-stroke-width': 2.5 } },
      { id: 'current-dot', type: 'circle', source: 'current', paint: { 'circle-radius': 4, 'circle-color': '#f5f5f5' } },
    ],
  }
}

export function MapaInterativoEscuro({
  latitude, longitude, places, routePoints = [],
}: MapaInterativoEscuroProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<MapLibreMap | null>(null)
  const [mapError, setMapError] = useState('')

  useEffect(() => {
    if (!containerRef.current || !Number.isFinite(latitude) || !Number.isFinite(longitude)) return
    ensureOfflineProtocol()
    setMapError('')
    let map: MapLibreMap | null = null
    try {
      const createdMap = new MapLibre({
        container: containerRef.current,
        center: [longitude, latitude],
        zoom: 15,
        minZoom: 3,
        maxZoom: 19,
        style: darkVectorStyle(latitude, longitude, places, routePoints),
        attributionControl: { compact: true },
        localIdeographFontFamily: 'system-ui, sans-serif',
      })
      map = createdMap
      createdMap.addControl(new NavigationControl({ showCompass: false }), 'top-right')
      createdMap.on('error', event => {
        const message = event.error?.message ?? ''
        if (message && !message.includes('AbortError')) setMapError('Algumas partes do mapa não estão disponíveis offline.')
      })
      mapRef.current = createdMap
    } catch (reason) {
      setMapError(reason instanceof Error ? reason.message : 'Não foi possível montar o mapa vetorial.')
    }
    return () => {
      mapRef.current = null
      map?.remove()
    }
    // O mapa é criado uma vez; fontes são atualizadas no efeito abaixo.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    const updateSources = () => {
      ;(map.getSource('current') as GeoJSONSource | undefined)?.setData(pointCollection(latitude, longitude))
      ;(map.getSource('places') as GeoJSONSource | undefined)?.setData(placesCollection(places))
      ;(map.getSource('route') as GeoJSONSource | undefined)?.setData(routeCollection(routePoints))
    }
    if (map.isStyleLoaded()) updateSources()
    else map.once('load', updateSources)
  }, [latitude, longitude, places, routePoints])

  return (
    <>
      <div ref={containerRef} className="buds-maplibre absolute inset-0 size-full touch-none" aria-label="Mapa vetorial interativo do contexto atual" />
      {mapError && (
        <div className="pointer-events-none absolute inset-x-3 bottom-3 z-[3] rounded-xl border border-white/10 bg-black/80 px-3 py-2 text-center text-[10px] text-white/70" role="status">
          {mapError}
        </div>
      )}
    </>
  )
}
