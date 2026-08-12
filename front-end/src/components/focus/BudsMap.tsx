import { useCallback, useEffect, useState } from 'react'
import { BatteryCharging, ChevronDown, Crosshair, Download, HardDrive, Home, Map, MapPin, Navigation, Plus, Route, Square, Trash2 } from 'lucide-react'
import {
  configureLocationMonitoring,
  deleteKnownPlace,
  deleteLocationRoute,
  getLocationDashboard,
  getLocationRoute,
  getLocationRoutes,
  isNativeIOSRuntime,
  refreshLocationContext,
  saveKnownPlace,
  setLocationContext,
  startLocationRoute,
  stopLocationRoute,
} from '../../services/api'
import {
  clearOfflineMaps,
  deleteOfflineMapRegion,
  downloadOfflineMapRegion,
  getOfflineMapStatus,
} from '../../services/mapaOffline'
import type { OfflineMapStatus } from '../../services/mapaOffline'
import type { LocationDashboard, LocationPlaceContext, LocationRoute, LocationRouteDashboard, LocationSemanticContext } from '../../types'
import { MapaInterativoEscuro } from '../mapa/MapaInterativoEscuro'

const CONTEXTS: Array<{ value: LocationPlaceContext; label: string }> = [
  { value: 'home', label: 'Casa' },
  { value: 'work', label: 'Trabalho' },
  { value: 'gym', label: 'Academia' },
  { value: 'study', label: 'Estudo' },
  { value: 'other', label: 'Outro' },
]

const MANUAL_CONTEXTS: Array<{ value: LocationSemanticContext; label: string }> = [
  ...CONTEXTS,
  { value: 'commuting', label: 'Deslocamento' },
]

const CONTEXT_LABELS: Record<LocationSemanticContext | 'anywhere', string> = {
  home: 'Casa',
  work: 'Trabalho',
  gym: 'Academia',
  study: 'Estudo',
  other: 'Outro lugar',
  commuting: 'Em deslocamento',
  away: 'Fora dos lugares conhecidos',
  unknown: 'Local não verificado',
  anywhere: 'Qualquer lugar',
}

const formatBytes = (bytes: number) => bytes < 1024 * 1024
  ? `${Math.max(0, bytes / 1024).toFixed(0)} KB`
  : `${(bytes / (1024 * 1024)).toFixed(bytes < 100 * 1024 * 1024 ? 1 : 0)} MB`

const formatDistance = (meters: number) => meters < 1000
  ? `${Math.round(meters)} m`
  : `${(meters / 1000).toFixed(2)} km`

const formatDuration = (seconds: number) => {
  const minutes = Math.floor(seconds / 60)
  const hours = Math.floor(minutes / 60)
  return hours ? `${hours}h ${minutes % 60}min` : `${Math.max(1, minutes)} min`
}

const hasCompleteRouteGeometry = (route: LocationRoute) => (
  Array.isArray(route.points)
  && route.points.length > 0
  && route.points.length >= route.point_count
)

interface BudsMapProps {
  onContextChanged?: () => void
  expanded?: boolean
}

export function BudsMap({ onContextChanged, expanded = false }: BudsMapProps) {
  const [dashboard, setDashboard] = useState<LocationDashboard | null>(null)
  const [routes, setRoutes] = useState<LocationRouteDashboard>({ active: null, routes: [] })
  const [visibleRoute, setVisibleRoute] = useState<LocationRoute | null>(null)
  const [offline, setOffline] = useState<OfflineMapStatus | null>(null)
  const [offlineProgress, setOfflineProgress] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [mapOpen, setMapOpen] = useState(expanded)
  const [formOpen, setFormOpen] = useState(false)
  const [placeName, setPlaceName] = useState('Casa')
  const [placeContext, setPlaceContext] = useState<LocationPlaceContext>('home')
  const [radius, setRadius] = useState(180)
  const nativeIOS = isNativeIOSRuntime()

  const load = useCallback(async () => {
    try {
      const [location, routeDashboard] = await Promise.all([getLocationDashboard(), getLocationRoutes()])
      setDashboard(location)
      setRoutes(routeDashboard)
      setVisibleRoute(current => {
        if (routeDashboard.active) return routeDashboard.active
        if (!current) return null
        const summary = routeDashboard.routes.find(route => route.id === current.id)
        if (!summary) return null
        // A listagem traz apenas o resumo. Preserve os pontos já carregados
        // para o percurso não desaparecer ao finalizar ou atualizar a tela.
        return { ...summary, ...(current.points?.length ? { points: current.points } : {}) }
      })
      setError('')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Não foi possível carregar o Buds Map.')
    }
  }, [])

  useEffect(() => {
    void load()
    void getOfflineMapStatus().then(setOffline).catch(() => undefined)
  }, [load])

  useEffect(() => {
    if (!routes.active) return
    const timer = window.setInterval(() => { void load() }, 5_000)
    return () => window.clearInterval(timer)
  }, [load, routes.active])

  const locate = async () => {
    setBusy(true)
    setError('')
    try {
      await refreshLocationContext()
      await load()
      onContextChanged?.()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Não foi possível obter sua localização.')
    } finally {
      setBusy(false)
    }
  }

  const openMap = async () => {
    setMapOpen(true)
    if (dashboard?.state.latitude == null || dashboard.state.longitude == null) {
      await locate()
    }
  }

  const chooseContext = async (context: LocationSemanticContext) => {
    setBusy(true)
    try {
      await setLocationContext(context)
      await load()
      onContextChanged?.()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Não foi possível trocar o contexto.')
    } finally {
      setBusy(false)
    }
  }

  const addCurrentPlace = async () => {
    const state = dashboard?.state
    if (state?.latitude == null || state.longitude == null) {
      setError('Atualize sua posição antes de salvar um lugar.')
      return
    }
    setBusy(true)
    try {
      await saveKnownPlace({
        name: placeName.trim() || CONTEXT_LABELS[placeContext],
        context: placeContext,
        latitude: state.latitude,
        longitude: state.longitude,
        radius_m: radius,
        enabled: true,
      })
      setFormOpen(false)
      await locate()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Não foi possível salvar este lugar.')
      setBusy(false)
    }
  }

  const removePlace = async (id: number) => {
    if (!window.confirm('Apagar este lugar conhecido?')) return
    setBusy(true)
    try {
      await deleteKnownPlace(id)
      await load()
      onContextChanged?.()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Não foi possível apagar este lugar.')
    } finally {
      setBusy(false)
    }
  }

  const toggleMonitoring = async () => {
    setBusy(true)
    try {
      await configureLocationMonitoring(!dashboard?.monitoring?.enabled)
      await load()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Não foi possível configurar a localização econômica.')
    } finally {
      setBusy(false)
    }
  }

  const toggleRouteRecording = async () => {
    setBusy(true)
    setError('')
    try {
      if (routes.active) {
        const completedRoute = await stopLocationRoute()
        if (completedRoute) {
          setVisibleRoute(completedRoute)
          setMapOpen(true)
        }
      } else {
        await startLocationRoute()
        setMapOpen(true)
      }
      await load()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Não foi possível alterar a gravação do trajeto.')
    } finally {
      setBusy(false)
    }
  }

  const showRoute = async (route: LocationRoute) => {
    setBusy(true)
    setError('')
    try {
      const detailedRoute = hasCompleteRouteGeometry(route)
        ? route
        : await getLocationRoute(route.id)
      setVisibleRoute(detailedRoute)
      setMapOpen(true)
      if (!detailedRoute.points?.length) {
        setError('Este trajeto foi salvo, mas não possui pontos de localização para desenhar.')
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Não foi possível abrir este trajeto.')
    } finally {
      setBusy(false)
    }
  }

  const removeRoute = async (route: LocationRoute) => {
    if (!window.confirm(`Apagar o trajeto “${route.name}”?`)) return
    setBusy(true)
    try {
      await deleteLocationRoute(route.id)
      if (visibleRoute?.id === route.id) setVisibleRoute(null)
      await load()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Não foi possível apagar este trajeto.')
    } finally {
      setBusy(false)
    }
  }

  const downloadCurrentArea = async () => {
    const state = dashboard?.state
    if (state?.latitude == null || state.longitude == null) {
      setError('Atualize sua posição antes de baixar uma área offline.')
      return
    }
    setBusy(true)
    setOfflineProgress(0)
    setError('')
    try {
      await downloadOfflineMapRegion({
        name: state.place_name ? `Região de ${state.place_name}` : `Área de ${new Date().toLocaleDateString('pt-BR')}`,
        latitude: state.latitude,
        longitude: state.longitude,
        radiusKm: 15,
        onProgress: (completed, total) => setOfflineProgress(total ? completed / total : 0),
      })
      setOffline(await getOfflineMapStatus())
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Não foi possível baixar o mapa offline.')
    } finally {
      setOfflineProgress(null)
      setBusy(false)
    }
  }

  const removeOfflineRegion = async (id: string) => {
    setBusy(true)
    try {
      await deleteOfflineMapRegion(id)
      setOffline(await getOfflineMapStatus())
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Não foi possível apagar esta área offline.')
    } finally {
      setBusy(false)
    }
  }

  const clearOfflineStorage = async () => {
    if (!window.confirm('Apagar todas as áreas e partes baixadas do mapa?')) return
    setBusy(true)
    try {
      await clearOfflineMaps()
      setOffline(await getOfflineMapStatus())
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Não foi possível limpar os mapas offline.')
    } finally {
      setBusy(false)
    }
  }

  const state = dashboard?.state
  const routeOnMap = routes.active ?? visibleRoute
  const routePointsOnMap = routeOnMap?.points ?? []
  const mapLatitude = routePointsOnMap[0]?.latitude ?? state?.latitude
  const mapLongitude = routePointsOnMap[0]?.longitude ?? state?.longitude
  const hasSavedRoutes = Boolean(routes.active || routes.routes.length)
  const hasOfflineStorage = (offline?.used_bytes ?? 0) > 0
  const showOfflinePanel = !nativeIOS || hasOfflineStorage
  return (
    <section className={`buds-map grid min-w-0 gap-3 overflow-hidden border border-[var(--liquid-border)] bg-[var(--liquid-panel-soft)] shadow-[var(--liquid-shadow-soft)] platform-windows:shadow-none ${expanded ? 'buds-map-expanded rounded-[28px] p-3 sm:p-4' : 'rounded-[24px] p-4'}`}>
      <header className="flex min-w-0 items-start justify-between gap-3">
        <div className="grid min-w-0 gap-1">
          <span className="flex items-center gap-2 text-[11px] font-extrabold uppercase tracking-[0.08em] text-[var(--muted)]">
            <Map size={14} /> Contexto atual
          </span>
          <strong className="truncate text-[18px] text-[var(--text)]">
            {CONTEXT_LABELS[state?.context ?? 'unknown']}
          </strong>
          <small className="text-[11px] leading-[1.35] text-[var(--muted)]">
            O sistema detecta o contexto; o 4B nunca recebe suas coordenadas.
          </small>
        </div>
        <button type="button" onClick={() => void locate()} disabled={busy} className="grid size-10 shrink-0 place-items-center rounded-full border border-[var(--liquid-border)] bg-[var(--liquid-panel)] text-[var(--text)] disabled:opacity-50" title="Atualizar localização agora">
          <Crosshair size={17} className={busy ? 'animate-pulse' : ''} />
        </button>
      </header>

      <div className="flex snap-x snap-mandatory gap-1.5 overflow-x-auto pb-1 sm:grid sm:grid-cols-6 sm:overflow-visible sm:pb-0" aria-label="Contexto manual">
        {MANUAL_CONTEXTS.map(item => (
          <button
            key={item.value}
            type="button"
            onClick={() => void chooseContext(item.value)}
            className={`min-h-11 min-w-[92px] snap-start rounded-xl border px-2 text-[11px] font-bold transition-colors sm:min-h-9 sm:min-w-0 ${state?.context === item.value ? 'border-transparent bg-buds-action text-buds-action-ink' : 'border-[var(--liquid-border)] bg-[var(--liquid-panel-soft)] text-[var(--muted)] hover:text-[var(--text)]'}`}
          >
            {item.label}
          </button>
        ))}
      </div>

      <button
        type="button"
        onClick={() => void toggleRouteRecording()}
        disabled={busy}
        className={`flex min-h-12 items-center justify-center gap-2 rounded-2xl border px-4 text-sm font-extrabold transition-colors disabled:opacity-50 ${routes.active ? 'border-rose-400/40 bg-rose-500/14 text-rose-200' : 'border-[var(--liquid-border-strong)] bg-[var(--liquid-panel)] text-[var(--text)] hover:border-[var(--accent-hot)]'}`}
      >
        {routes.active ? <Square size={15} fill="currentColor" /> : <Route size={17} />}
        {routes.active ? 'Encerrar e salvar trajeto' : 'Gravar meu trajeto'}
      </button>
      {routes.active && (
        <p className="m-0 rounded-xl border border-amber-400/20 bg-amber-400/8 px-3 py-2 text-[10px] leading-relaxed text-amber-100/80">
          GPS preciso ativo enquanto este trajeto é gravado. Você pode bloquear a tela; encerre a gravação quando chegar.
        </p>
      )}

      <div className={`buds-map-canvas relative grid place-items-center overflow-hidden rounded-[19px] border border-[var(--liquid-border)] bg-black ${expanded ? 'min-h-[clamp(310px,58dvh,720px)]' : 'min-h-[180px]'}`}>
        {mapOpen && mapLatitude != null && mapLongitude != null ? (
          <>
            <MapaInterativoEscuro latitude={mapLatitude} longitude={mapLongitude} places={dashboard?.places ?? []} routePoints={routePointsOnMap} />
            <span className="pointer-events-none absolute inset-0 z-[1] bg-[radial-gradient(circle_at_50%_44%,transparent_35%,rgba(0,0,0,0.22)_100%)]" aria-hidden="true" />
            {routeOnMap && (routeOnMap.points?.length ?? 0) > 0 && (
              <span className="pointer-events-none absolute top-3 left-3 z-[2] grid max-w-[calc(100%-24px)] gap-0.5 rounded-xl border border-white/15 bg-black/78 px-3 py-2 text-left shadow-lg backdrop-blur-md platform-windows:backdrop-blur-none">
                <strong className="truncate text-[11px] text-white">{routeOnMap.name}</strong>
                <small className="text-[9px] text-white/60">{formatDistance(routeOnMap.distance_m)} · {formatDuration(routeOnMap.duration_s)} · percurso no mapa</small>
              </span>
            )}
          </>
        ) : (
          <div className="grid max-w-[290px] justify-items-center gap-2 p-5 text-center">
            <span className="grid size-14 place-items-center rounded-full border border-[var(--liquid-border-strong)] bg-[var(--liquid-panel)] text-[var(--accent-hot)]"><Navigation size={23} /></span>
            <strong className="text-sm text-[var(--text)]">Mapa sob demanda</strong>
            <small className="text-[11px] leading-[1.45] text-[var(--muted)]">O mapa e a precisão alta só são ativados quando você solicitar.</small>
            <button type="button" onClick={() => void openMap()} disabled={busy} className="min-h-11 rounded-full bg-buds-action px-4 text-xs font-bold text-buds-action-ink disabled:opacity-40">{busy ? 'Localizando…' : 'Ativar e abrir mapa'}</button>
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => setFormOpen(value => !value)} className="inline-flex min-h-11 items-center gap-2 rounded-full border border-[var(--liquid-border)] bg-[var(--liquid-panel)] px-3 text-xs font-bold text-[var(--text)]">
          <Plus size={14} /> Salvar lugar atual
        </button>
        <button type="button" onClick={() => void toggleMonitoring()} disabled={busy} className={`inline-flex min-h-11 items-center gap-2 rounded-full border px-3 text-xs font-bold ${dashboard?.monitoring?.enabled ? 'border-emerald-400/30 bg-emerald-400/12 text-emerald-300' : 'border-[var(--liquid-border)] bg-[var(--liquid-panel)] text-[var(--muted)]'}`} title={nativeIOS ? 'Geofences e mudanças significativas em segundo plano' : 'Localização aproximada e econômica enquanto o Buds estiver aberto'}>
          <BatteryCharging size={14} /> Econômico {dashboard?.monitoring?.enabled ? 'ativo' : 'desativado'}
        </button>
      </div>

      {formOpen && (
        <div className="grid gap-2 rounded-[18px] border border-[var(--liquid-border)] bg-[var(--surface)] p-3 sm:grid-cols-[1fr_140px_110px_auto]">
          <input value={placeName} onChange={event => setPlaceName(event.target.value)} placeholder="Nome do lugar" className="min-h-11 min-w-0 rounded-xl border border-[var(--liquid-border)] bg-[var(--liquid-panel-soft)] px-3 text-sm outline-none" />
          <select value={placeContext} onChange={event => setPlaceContext(event.target.value as LocationPlaceContext)} className="min-h-11 rounded-xl border border-[var(--liquid-border)] bg-[var(--liquid-panel-soft)] px-2 text-xs outline-none">
            {CONTEXTS.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}
          </select>
          <select value={radius} onChange={event => setRadius(Number(event.target.value))} className="min-h-11 rounded-xl border border-[var(--liquid-border)] bg-[var(--liquid-panel-soft)] px-2 text-xs outline-none">
            <option value={100}>100 m</option><option value={180}>180 m</option><option value={300}>300 m</option><option value={500}>500 m</option>
          </select>
          <button type="button" onClick={() => void addCurrentPlace()} disabled={busy} className="min-h-11 rounded-xl bg-buds-action px-4 text-xs font-bold text-buds-action-ink disabled:opacity-50">Salvar</button>
        </div>
      )}

      {(hasSavedRoutes || showOfflinePanel) && (
      <div className={`grid min-w-0 gap-2 ${hasSavedRoutes && showOfflinePanel ? 'lg:grid-cols-2' : ''}`}>
        {hasSavedRoutes && (
        <div className="grid min-w-0 content-start gap-2 rounded-[18px] border border-[var(--liquid-border)] bg-[var(--surface)] p-3">
          <header className="flex items-center justify-between gap-2">
            <span className="inline-flex items-center gap-2 text-xs font-extrabold text-[var(--text)]"><Route size={14} /> Trajetos salvos</span>
            <small className="text-[10px] text-[var(--muted)]">Só o resumo chega ao Buds</small>
          </header>
          {routes.active && (
            <button type="button" onClick={() => void showRoute(routes.active!)} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 rounded-xl border border-rose-400/25 bg-rose-500/8 px-3 py-2 text-left">
              <span className="grid min-w-0"><strong className="truncate text-xs text-rose-100">{routes.active.name}</strong><small className="text-[10px] text-rose-100/60">gravando · {formatDistance(routes.active.distance_m)}</small></span>
              <span className="size-2 animate-pulse rounded-full bg-rose-400" />
            </button>
          )}
          <div className="grid max-h-[min(42dvh,360px)] gap-2 overflow-y-auto overscroll-contain pr-0.5">
          {routes.routes.map(route => {
            const selected = visibleRoute?.id === route.id
            return (
            <div key={route.id} className={`grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 rounded-xl border px-3 py-2 transition-colors ${selected ? 'border-white/28 bg-white/10' : 'border-[var(--liquid-border)] bg-[var(--liquid-panel-soft)]'}`}>
              <button type="button" onClick={() => void showRoute(route)} disabled={busy} className="grid min-w-0 gap-0.5 text-left disabled:opacity-55" aria-pressed={selected}>
                <strong className="truncate text-xs text-[var(--text)]">{route.name}</strong>
                <small className="text-[10px] text-[var(--muted)]">{formatDistance(route.distance_m)} · {formatDuration(route.duration_s)} · {route.point_count} pontos</small>
                <span className={`mt-1 inline-flex items-center gap-1 text-[9px] font-extrabold uppercase tracking-[0.06em] ${selected ? 'text-white' : 'text-[var(--accent-hot)]'}`}>
                  <MapPin size={10} /> {selected ? 'Exibindo no mapa' : 'Ver percurso'}
                </span>
              </button>
              <button type="button" onClick={() => void removeRoute(route)} className="grid size-10 place-items-center rounded-full text-[var(--muted)] hover:bg-rose-500/12 hover:text-rose-300" aria-label={`Apagar ${route.name}`}><Trash2 size={13} /></button>
            </div>
          )})}
          </div>
        </div>
        )}

        {showOfflinePanel && (
        <div className="grid min-w-0 content-start gap-2 rounded-[18px] border border-[var(--liquid-border)] bg-[var(--surface)] p-3">
          <header className="flex flex-wrap items-center justify-between gap-2">
            <span className="inline-flex items-center gap-2 text-xs font-extrabold text-[var(--text)]"><HardDrive size={14} /> Mapa offline</span>
            <div className="flex items-center gap-2">
              <small className="text-[10px] text-[var(--muted)]">{formatBytes(offline?.used_bytes ?? 0)} / 750 MB</small>
              <button
                type="button"
                onClick={() => void clearOfflineStorage()}
                disabled={busy || (offline?.used_bytes ?? 0) === 0}
                className="inline-flex min-h-10 items-center gap-1.5 rounded-xl border border-rose-400/20 bg-rose-500/8 px-3 text-[11px] font-extrabold text-rose-200 transition-colors hover:bg-rose-500/14 disabled:cursor-not-allowed disabled:opacity-35"
                aria-label="Apagar todos os mapas baixados"
              >
                <Trash2 size={13} /> Apagar downloads
              </button>
            </div>
          </header>
          <div className="h-1.5 overflow-hidden rounded-full bg-white/8">
            <span className="block h-full rounded-full bg-[var(--accent-hot)] transition-[width]" style={{ width: `${Math.min(100, ((offline?.used_bytes ?? 0) / (offline?.limit_bytes || 1)) * 100)}%` }} />
          </div>
          <button type="button" onClick={() => void downloadCurrentArea()} disabled={busy || offline?.supported === false || nativeIOS} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-[var(--liquid-border-strong)] bg-[var(--liquid-panel)] px-3 text-xs font-bold text-[var(--text)] disabled:opacity-40">
            <Download size={14} /> {nativeIOS ? 'Mapa online no iPhone' : offlineProgress == null ? 'Baixar 15 km ao redor' : `Baixando ${Math.round(offlineProgress * 100)}%`}
          </button>
          <small className="text-[10px] leading-relaxed text-[var(--muted)]">
            {nativeIOS
              ? 'Fallback HTTPS temporário para garantir que o mapa abra no app. O cache offline continua disponível no desktop e na web.'
              : 'Ruas vetoriais em preto e branco. A área continua disponível sem internet e o limite nunca passa de 750 MB.'}
          </small>
          {offline?.regions.map(region => (
            <div key={region.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 rounded-xl border border-[var(--liquid-border)] bg-[var(--liquid-panel-soft)] px-3 py-2">
              <span className="grid min-w-0"><strong className="truncate text-xs text-[var(--text)]">{region.name}</strong><small className="text-[10px] text-[var(--muted)]">{region.radius_km} km · {formatBytes(region.bytes)}</small></span>
              <button type="button" onClick={() => void removeOfflineRegion(region.id)} aria-label={`Apagar ${region.name}`} className="inline-flex min-h-10 items-center gap-1.5 rounded-xl px-2.5 text-[11px] font-bold text-[var(--muted)] hover:bg-rose-500/12 hover:text-rose-300"><Trash2 size={13} /> Apagar</button>
            </div>
          ))}
        </div>
        )}
      </div>
      )}

      {dashboard?.places.length ? (
        <details className="group grid gap-1.5 rounded-[18px] border border-[var(--liquid-border)] bg-[var(--surface)] p-3">
          <summary className="flex min-h-10 cursor-pointer list-none items-center justify-between gap-3 text-xs font-extrabold text-[var(--text)] [&::-webkit-details-marker]:hidden">
            <span className="inline-flex items-center gap-2"><MapPin size={14} /> Lugares conhecidos <small className="font-normal text-[var(--muted)]">({dashboard.places.length})</small></span>
            <ChevronDown size={15} className="text-[var(--muted)] transition-transform group-open:rotate-180" />
          </summary>
          <div className="grid gap-1.5 pt-1">
            {dashboard.places.map(place => (
            <div key={place.id} className="grid min-w-0 grid-cols-[34px_minmax(0,1fr)_auto] items-center gap-2 rounded-[15px] border border-[var(--liquid-border)] bg-[var(--liquid-panel-soft)] p-2">
              <span className="grid size-[34px] place-items-center rounded-xl bg-[rgb(var(--accent-hot-rgb)/0.1)] text-[var(--accent-hot)]">{place.context === 'home' ? <Home size={15} /> : <MapPin size={15} />}</span>
              <span className="grid min-w-0"><strong className="truncate text-xs text-[var(--text)]">{place.name}</strong><small className="text-[10px] text-[var(--muted)]">{CONTEXT_LABELS[place.context]} · raio de {Math.round(place.radius_m)} m</small></span>
              <button type="button" onClick={() => void removePlace(place.id)} className="grid size-10 place-items-center rounded-full text-[var(--muted)] hover:bg-rose-500/12 hover:text-rose-300" aria-label={`Apagar ${place.name}`}><Trash2 size={14} /></button>
            </div>
            ))}
          </div>
        </details>
      ) : null}

      {dashboard?.events.length ? (
        <div className="flex min-w-0 items-center gap-2 overflow-hidden rounded-xl border border-[var(--liquid-border)] bg-[var(--liquid-panel-soft)] px-3 py-2 text-[10px] text-[var(--muted)]">
          <MapPin size={12} className="shrink-0 text-[var(--accent-hot)]" />
          <span className="truncate">
            Última mudança: {dashboard.events[0].event_type === 'enter' ? 'chegada' : dashboard.events[0].event_type === 'exit' ? 'saída' : 'contexto alterado'} · {CONTEXT_LABELS[dashboard.events[0].context]}
          </span>
        </div>
      ) : null}

      {error && <p className="m-0 rounded-xl border border-rose-400/25 bg-rose-500/10 px-3 py-2 text-[11px] text-rose-200">{error}</p>}
    </section>
  )
}
