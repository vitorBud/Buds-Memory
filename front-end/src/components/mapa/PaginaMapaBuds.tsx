import { MapPinned, ShieldCheck } from 'lucide-react'
import { BudsMap } from '../focus/BudsMap'

interface PaginaMapaBudsProps {
  visible: boolean
}

export function PaginaMapaBuds({ visible }: PaginaMapaBudsProps) {
  if (!visible) return null

  return (
    <section
      id="map"
      className="buds-map-page h-dvh min-h-0 w-full overflow-x-hidden overflow-y-auto bg-[var(--liquid-bg)] px-3 pb-[calc(var(--mobile-nav-height,72px)+24px+env(safe-area-inset-bottom))] pt-[76px] sm:px-5 lg:px-7 lg:pb-8 lg:pt-[78px]"
      aria-label="Buds Map"
    >
      <div className="mx-auto grid w-full max-w-[1240px] min-w-0 gap-4">
        <header className="flex min-w-0 flex-col gap-3 rounded-[26px] border border-[var(--liquid-border)] bg-[var(--liquid-panel-soft)] px-4 py-4 shadow-[var(--liquid-shadow-soft)] sm:flex-row sm:items-center sm:justify-between sm:px-5 platform-windows:shadow-none">
          <div className="grid min-w-0 gap-1">
            <span className="flex items-center gap-2 text-[11px] font-extrabold uppercase tracking-[0.1em] text-[var(--muted)]">
              <MapPinned size={15} /> Lugares e contexto
            </span>
            <h1 className="m-0 text-[clamp(24px,4vw,38px)] font-black tracking-[-0.04em] text-[var(--text)]">Buds Map</h1>
            <p className="m-0 max-w-[660px] text-xs leading-relaxed text-[var(--muted)] sm:text-sm">
              Veja sua região, salve lugares conhecidos e deixe o Focus destacar o que importa onde você está.
            </p>
          </div>
          <span className="inline-flex w-fit shrink-0 items-center gap-2 rounded-full border border-emerald-400/20 bg-emerald-400/10 px-3 py-2 text-[11px] font-bold text-emerald-300">
            <ShieldCheck size={14} /> Coordenadas fora do 4B
          </span>
        </header>

        <BudsMap expanded />
      </div>
    </section>
  )
}
