export const deferredSurfaceStyles = {
  root:
    'grid min-h-[180px] w-full place-items-center gap-3 rounded-3xl border border-[var(--glass-border,var(--line))] bg-[color-mix(in_srgb,var(--glass-bg,var(--surface))_72%,transparent)] p-6 text-[var(--muted)] [backdrop-filter:blur(22px)_saturate(1.4)] platform-windows:[backdrop-filter:none]',
  pulse:
    'size-7 animate-[deferredPulse_1.2s_ease-in-out_infinite] rounded-full border border-[color-mix(in_srgb,var(--accent)_34%,transparent)] shadow-[0_0_32px_rgb(var(--accent-rgb)/0.28)] platform-windows:animate-none platform-windows:shadow-none',
  copy: 'm-0 text-[0.8rem]',
} as const

export const homeStyles = {
  landing:
    'relative z-[1] flex min-h-[168dvh] w-full flex-col items-center justify-start overflow-x-hidden overflow-y-auto px-6 pt-[clamp(56px,6vh,86px)] pb-[76px] text-[var(--text)] [background:radial-gradient(circle_at_50%_30%,rgb(var(--accent-rgb)/0.16),transparent_50%),radial-gradient(circle_at_80%_80%,rgb(var(--accent-hot-rgb)/0.12),transparent_45%),var(--liquid-bg)] before:pointer-events-none before:absolute before:inset-0 before:z-0 before:bg-[linear-gradient(90deg,rgb(var(--accent-hot-rgb)/0.045)_1px,transparent_1px),linear-gradient(rgb(var(--accent-hot-rgb)/0.04)_1px,transparent_1px)] before:bg-[length:48px_48px] before:opacity-60 before:content-[""] max-[760px]:min-h-[158svh] max-[760px]:px-3 max-[760px]:pt-[calc(54px+env(safe-area-inset-top))] max-[760px]:pb-[calc(92px+env(safe-area-inset-bottom))] platform-windows:scroll-auto platform-ios:!min-h-dvh platform-ios:!overflow-y-auto platform-ios:before:!opacity-25',
  content:
    'relative z-[2] mx-auto flex w-full max-w-full flex-col items-center gap-0 text-center',
  hero:
    'sticky top-[clamp(34px,4.8vh,58px)] z-[1] flex min-h-[calc(100dvh-clamp(72px,9vh,112px))] w-full flex-col items-center justify-center opacity-100 max-[760px]:top-[calc(18px+env(safe-area-inset-top))] max-[760px]:min-h-[calc(100svh-128px)] platform-ios:!relative platform-ios:!top-auto platform-ios:!min-h-[calc(100dvh-var(--mobile-nav-height)-env(safe-area-inset-top)-env(safe-area-inset-bottom)-34px)]',
  brandCopy:
    'relative z-[2] flex w-full flex-col items-center gap-0 max-[760px]:gap-[7px]',
  eyebrow:
    'text-[clamp(12px,1.2vw,15px)] font-extrabold tracking-[0.16em] text-[color-mix(in_srgb,var(--accent-hot)_78%,var(--text))] uppercase [text-shadow:0_0_20px_rgb(var(--accent-hot-rgb)/0.4)] max-[760px]:text-[11px] max-[760px]:tracking-[0.12em] [@media(min-width:761px)_and_(max-height:850px)]:text-xs platform-windows:[text-shadow:none]',
  title:
    'm-0 max-w-[min(860px,calc(100vw-32px))] bg-[linear-gradient(180deg,var(--text),color-mix(in_srgb,var(--text)_62%,var(--accent-hot))),radial-gradient(circle_at_50%_30%,rgb(var(--accent-hot-rgb)/0.38),transparent_56%)] bg-clip-text text-[clamp(56px,4.4vw,100px)] leading-[0.88] font-black tracking-[0] text-transparent uppercase [filter:drop-shadow(0_0_26px_rgb(var(--accent-hot-rgb)/0.24))] max-[760px]:max-w-[calc(100vw-28px)] max-[760px]:text-[clamp(54px,16vw,82px)] max-[760px]:leading-[0.9] [@media(min-width:761px)_and_(max-height:850px)]:max-w-[min(780px,calc(100vw-32px))] platform-windows:[filter:none] platform-ios:!text-[clamp(42px,13.5vw,60px)] platform-ios:![filter:none]',
  subcopy:
    'relative z-[4] mt-[clamp(10px,1.4vh,16px)] opacity-100',
  subtitle:
    'm-0 max-w-[540px] text-[clamp(15px,1.8vw,19px)] leading-[1.6] font-normal text-[var(--muted)] [@media(min-width:761px)_and_(max-height:850px)]:max-w-[620px] [@media(min-width:761px)_and_(max-height:850px)]:text-[15px] [@media(min-width:761px)_and_(max-height:850px)]:leading-[1.35]',
  brandMark:
    'relative z-[2] mx-auto my-[clamp(-18px,-2vh,-8px)] flex h-[1000px] min-h-[650px] w-full max-w-full items-center justify-center overflow-visible border-0 bg-transparent shadow-none max-[760px]:my-0 max-[760px]:h-[min(56svh,470px)] max-[760px]:min-h-[330px] max-[760px]:w-[min(100%,420px)] max-[760px]:max-h-[470px] max-[760px]:pointer-events-none [@media(min-width:761px)_and_(max-height:850px)]:mt-[clamp(-18px,-2vh,-8px)] [@media(min-width:761px)_and_(max-height:850px)]:h-[600px] [@media(min-width:761px)_and_(max-height:850px)]:min-h-[650px] platform-windows:h-[min(72vh,720px)] platform-windows:min-h-[460px] platform-ios:!h-[min(38dvh,320px)] platform-ios:!min-h-[230px] platform-ios:!max-h-[320px]',
  scrollIndicator:
    'mt-[clamp(-24px,-2vh,-10px)] inline-flex items-center gap-2.5 text-[color-mix(in_srgb,var(--muted)_78%,transparent)] uppercase opacity-90 max-[760px]:mt-[-8px] [@media(min-width:761px)_and_(max-height:850px)]:mt-[clamp(-20px,-1.6vh,-8px)]',
  scrollGlyph:
    'relative inline-flex h-[30px] w-[18px] rounded-full border border-[color-mix(in_srgb,var(--accent-hot)_32%,transparent)] after:absolute after:top-1.5 after:left-1/2 after:size-[5px] after:-translate-x-1/2 after:animate-[homeScrollDot_1.5s_ease-in-out_infinite] after:rounded-full after:bg-[var(--accent-hot)] after:shadow-[0_0_16px_rgb(var(--accent-hot-rgb)/0.45)] after:content-[""] platform-windows:after:animate-none platform-windows:after:shadow-none platform-ios:after:!animate-none platform-ios:after:!shadow-none',
  scrollCopy:
    'text-[10px] font-black tracking-[0.16em]',
  info:
    'relative z-[4] mt-[clamp(22vh,30vh,34vh)] flex w-[min(100%,1020px)] flex-col items-center gap-[18px] opacity-100 max-[760px]:mt-[20svh] max-[760px]:w-[min(100%,390px)] max-[760px]:gap-3 platform-ios:!mt-20',
  projectCard:
    'relative grid w-[min(100%,980px)] max-w-[980px] grid-cols-[minmax(0,1.1fr)_minmax(300px,0.9fr)] items-stretch gap-[22px] overflow-hidden rounded-[28px] border border-[var(--liquid-border)] p-[clamp(20px,2.6vw,30px)] text-left shadow-[var(--liquid-shadow-soft)] [background:linear-gradient(135deg,rgba(255,255,255,0.11),rgba(255,255,255,0.035)),var(--liquid-panel-soft)] before:pointer-events-none before:absolute before:inset-0 before:bg-[radial-gradient(circle_at_14%_0%,rgb(var(--accent-rgb)/0.28),transparent_34%),radial-gradient(circle_at_92%_20%,rgb(var(--accent-hot-rgb)/0.18),transparent_38%)] before:opacity-70 before:content-[""] max-[760px]:w-full max-[760px]:max-w-[390px] max-[760px]:grid-cols-1 max-[760px]:gap-3.5 max-[760px]:rounded-[22px] max-[760px]:p-4 platform-windows:shadow-none',
  projectCopy:
    'relative z-[1] grid gap-2.5 max-[760px]:gap-[7px]',
  projectEyebrow:
    'text-[11px] font-black tracking-[0.14em] text-[color-mix(in_srgb,var(--accent-hot)_76%,var(--text))] uppercase',
  projectTitle:
    'm-0 max-w-[620px] text-[clamp(22px,2.7vw,34px)] leading-[1.05] font-[850] tracking-0 text-[var(--text)] max-[760px]:text-[clamp(18px,5.5vw,22px)] max-[760px]:leading-[1.08]',
  projectDescription:
    'm-0 max-w-[660px] text-[clamp(14px,1.35vw,16px)] leading-[1.65] text-[var(--muted)] max-[760px]:text-[13px] max-[760px]:leading-[1.48]',
  projectPoints:
    'relative z-[1] grid gap-2.5 max-[760px]:gap-2',
  projectPoint:
    'grid grid-cols-[34px_minmax(0,1fr)] items-center gap-x-3 gap-y-[3px] rounded-[18px] border border-white/9 bg-white/[0.055] p-3 max-[760px]:rounded-[15px] max-[760px]:p-2.5',
  projectPointIcon:
    'row-span-2 size-[34px] self-center rounded-xl border border-[rgba(var(--accent-hot-rgb)/0.22)] bg-[rgba(var(--accent-hot-rgb)/0.1)] p-[7px] text-[var(--accent-hot)]',
  projectPointTitle:
    'text-[13px] font-extrabold text-[var(--text)]',
  projectPointCopy:
    'text-xs leading-[1.35] text-[var(--muted)]',
  statusGrid:
    'relative z-[2] grid w-full max-w-[640px] grid-cols-3 gap-4 max-[760px]:max-w-[390px] max-[390px]:grid-cols-1',
  statusCard:
    'grid min-w-0 gap-2 rounded-[20px] border border-[var(--liquid-border)] bg-[var(--liquid-panel-soft)] px-5 py-[18px] shadow-[var(--liquid-shadow-soft)] transition-[transform,border-color] duration-200 hover:-translate-y-0.5 hover:border-[rgb(var(--accent-rgb)/0.3)] max-[680px]:px-4 max-[680px]:py-3.5 max-[390px]:min-h-12 platform-windows:shadow-none platform-windows:transition-none platform-windows:hover:translate-y-0',
  statusLabel:
    'overflow-hidden text-ellipsis whitespace-nowrap text-[11px] font-extrabold tracking-[0.08em] text-[var(--muted)] uppercase',
  statusValue:
    'overflow-hidden text-ellipsis whitespace-nowrap text-sm font-semibold text-[var(--text)]',
} as const

export const homeBrainStyles = {
  stage:
    'relative h-full w-full overflow-visible',
  canvas:
    'block h-full! w-full! overflow-visible opacity-100 transition-opacity duration-550 [&_canvas]:block [&_canvas]:h-full! [&_canvas]:w-full! [&_canvas]:overflow-visible max-[760px]:pointer-events-none max-[760px]:[&_canvas]:pointer-events-none platform-windows:transition-none',
  canvasLoading: 'opacity-0',
  canvasReady: 'opacity-100',
  build:
    'pointer-events-none absolute inset-0 z-[5] grid place-items-center',
  indicator:
    'grid min-w-[210px] justify-items-center gap-2.5 rounded-2xl border border-[var(--liquid-border)] bg-[color-mix(in_srgb,var(--liquid-panel)_78%,transparent)] px-5 py-4 text-center shadow-[0_12px_32px_rgba(0,0,0,0.1)] [backdrop-filter:blur(12px)] platform-windows:shadow-none platform-windows:[backdrop-filter:none]',
  pulse:
    'relative size-5 rounded-full border border-[color-mix(in_srgb,var(--accent-hot)_28%,transparent)] after:absolute after:inset-[5px] after:animate-pulse after:rounded-full after:bg-[var(--accent-hot)] after:content-[""] platform-windows:after:animate-none',
  buildTitle:
    'text-xs font-bold tracking-[0.03em] text-[var(--text)]',
  buildCopyText:
    'text-[11px] text-[var(--muted)]',
} as const

export const homeLoaderStyles = {
  root:
    'grid h-full min-h-[clamp(420px,62vh,720px)] w-full place-items-center max-[760px]:min-h-[260px]',
  indicator:
    'grid min-w-[210px] justify-items-center gap-2.5 rounded-2xl border border-[var(--liquid-border)] bg-[color-mix(in_srgb,var(--liquid-panel)_78%,transparent)] px-5 py-4 text-center shadow-[0_12px_32px_rgba(0,0,0,0.1)] [backdrop-filter:blur(12px)] platform-windows:shadow-none platform-windows:[backdrop-filter:none]',
  pulse:
    'relative size-5 rounded-full border border-[color-mix(in_srgb,var(--accent-hot)_28%,transparent)] after:absolute after:inset-[5px] after:animate-pulse after:rounded-full after:bg-[var(--accent-hot)] after:content-[""] platform-windows:after:animate-none',
  title:
    'text-xs font-bold tracking-[0.03em] text-[var(--text)]',
  subtitle:
    'text-[11px] text-[var(--muted)]',
} as const
