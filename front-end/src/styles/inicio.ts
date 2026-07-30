export const deferredSurfaceStyles = {
  root:
    'grid min-h-[180px] w-full place-items-center gap-3 rounded-3xl border border-[var(--glass-border,var(--line))] bg-[color-mix(in_srgb,var(--glass-bg,var(--surface))_72%,transparent)] p-6 text-[var(--muted)] [backdrop-filter:blur(22px)_saturate(1.4)] platform-windows:[backdrop-filter:none]',
  pulse:
    'size-7 animate-[deferredPulse_1.2s_ease-in-out_infinite] rounded-full border border-[color-mix(in_srgb,var(--accent)_34%,transparent)] shadow-[0_0_32px_rgb(var(--accent-rgb)/0.28)] platform-windows:animate-none platform-windows:shadow-none',
  copy: 'm-0 text-[0.8rem]',
} as const

export const homeStyles = {
  landing:
    'relative z-[1] flex min-h-[168dvh] w-full flex-col items-center justify-start overflow-x-hidden overflow-y-auto px-6 pt-[clamp(56px,6vh,86px)] pb-[76px] text-[var(--text)] [background:radial-gradient(circle_at_50%_30%,rgb(var(--accent-rgb)/0.16),transparent_50%),radial-gradient(circle_at_80%_80%,rgb(var(--accent-hot-rgb)/0.12),transparent_45%),var(--liquid-bg)] before:pointer-events-none before:absolute before:inset-0 before:z-0 before:bg-[linear-gradient(90deg,rgb(var(--accent-hot-rgb)/0.045)_1px,transparent_1px),linear-gradient(rgb(var(--accent-hot-rgb)/0.04)_1px,transparent_1px)] before:bg-[length:48px_48px] before:opacity-60 before:content-[""] max-[760px]:min-h-[158svh] max-[760px]:px-3 max-[760px]:pt-[calc(54px+env(safe-area-inset-top))] max-[760px]:pb-[calc(92px+env(safe-area-inset-bottom))] platform-windows:scroll-auto',
  content:
    'relative z-[2] mx-auto flex w-full max-w-full flex-col items-center gap-0 text-center',
  hero:
    'sticky top-[clamp(34px,4.8vh,58px)] z-[1] flex min-h-[calc(100dvh-clamp(72px,9vh,112px))] w-full flex-col items-center justify-center opacity-100 max-[760px]:top-[calc(18px+env(safe-area-inset-top))] max-[760px]:min-h-[calc(100svh-128px)]',
  brandCopy:
    'relative z-[2] flex w-full flex-col items-center gap-0 max-[760px]:gap-[7px]',
  eyebrow:
    'text-[clamp(12px,1.2vw,15px)] font-extrabold tracking-[0.16em] text-[color-mix(in_srgb,var(--accent-hot)_78%,var(--text))] uppercase [text-shadow:0_0_20px_rgb(var(--accent-hot-rgb)/0.4)] max-[760px]:text-[11px] max-[760px]:tracking-[0.12em] [@media(min-width:761px)_and_(max-height:850px)]:text-xs platform-windows:[text-shadow:none]',
  title:
    'm-0 max-w-[min(860px,calc(100vw-32px))] bg-[linear-gradient(180deg,var(--text),color-mix(in_srgb,var(--text)_62%,var(--accent-hot))),radial-gradient(circle_at_50%_30%,rgb(var(--accent-hot-rgb)/0.38),transparent_56%)] bg-clip-text text-[clamp(56px,4.4vw,100px)] leading-[0.88] font-black tracking-[0] text-transparent uppercase [filter:drop-shadow(0_0_26px_rgb(var(--accent-hot-rgb)/0.24))] max-[760px]:max-w-[calc(100vw-28px)] max-[760px]:text-[clamp(54px,16vw,82px)] max-[760px]:leading-[0.9] [@media(min-width:761px)_and_(max-height:850px)]:max-w-[min(780px,calc(100vw-32px))] platform-windows:[filter:none]',
  subcopy:
    'relative z-[4] mt-[clamp(10px,1.4vh,16px)] opacity-100',
  subtitle:
    'm-0 max-w-[540px] text-[clamp(15px,1.8vw,19px)] leading-[1.6] font-normal text-[var(--muted)] [@media(min-width:761px)_and_(max-height:850px)]:max-w-[620px] [@media(min-width:761px)_and_(max-height:850px)]:text-[15px] [@media(min-width:761px)_and_(max-height:850px)]:leading-[1.35]',
  brandMark:
    'relative z-[2] mx-auto my-[clamp(-18px,-2vh,-8px)] flex h-[1000px] min-h-[650px] w-full max-w-full items-center justify-center overflow-visible border-0 bg-transparent shadow-none max-[760px]:my-0 max-[760px]:h-[min(56svh,470px)] max-[760px]:min-h-[330px] max-[760px]:w-[min(100%,420px)] max-[760px]:max-h-[470px] max-[760px]:pointer-events-none [@media(min-width:761px)_and_(max-height:850px)]:mt-[clamp(-18px,-2vh,-8px)] [@media(min-width:761px)_and_(max-height:850px)]:h-[600px] [@media(min-width:761px)_and_(max-height:850px)]:min-h-[650px] platform-windows:h-[min(72vh,720px)] platform-windows:min-h-[460px]',
  scrollIndicator:
    'mt-[clamp(-24px,-2vh,-10px)] inline-flex items-center gap-2.5 text-[color-mix(in_srgb,var(--muted)_78%,transparent)] uppercase opacity-90 max-[760px]:mt-[-8px] [@media(min-width:761px)_and_(max-height:850px)]:mt-[clamp(-20px,-1.6vh,-8px)]',
  scrollGlyph:
    'relative inline-flex h-[30px] w-[18px] rounded-full border border-[color-mix(in_srgb,var(--accent-hot)_32%,transparent)] after:absolute after:top-1.5 after:left-1/2 after:size-[5px] after:-translate-x-1/2 after:animate-[homeScrollDot_1.5s_ease-in-out_infinite] after:rounded-full after:bg-[var(--accent-hot)] after:shadow-[0_0_16px_rgb(var(--accent-hot-rgb)/0.45)] after:content-[""] platform-windows:after:animate-none platform-windows:after:shadow-none',
  scrollCopy:
    'text-[10px] font-black tracking-[0.16em]',
  info:
    'relative z-[4] mt-[clamp(22vh,30vh,34vh)] flex w-[min(100%,1020px)] flex-col items-center gap-[18px] opacity-100 max-[760px]:mt-[18svh] max-[760px]:w-[min(100%,390px)] max-[760px]:gap-3',
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
    'row-span-2 size-[34px] self-center rounded-xl border border-[rgb(var(--accent-rgb)/0.22)] bg-[rgb(var(--accent-rgb)/0.16)] p-[7px] text-[var(--accent)]',
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
    'pointer-events-none absolute inset-0 z-[5] grid content-center items-center justify-items-center gap-4 overflow-visible before:absolute before:h-[min(34vw,320px)] before:w-[min(78vw,820px)] before:animate-[homeBrainBuildGrid_3s_linear_infinite] before:rounded-[34px] before:bg-[linear-gradient(90deg,rgb(var(--accent-hot-rgb)/0.1)_1px,transparent_1px),linear-gradient(rgb(var(--accent-rgb)/0.08)_1px,transparent_1px)] before:bg-[length:42px_42px] before:opacity-75 before:[filter:blur(0.2px)] before:[mask-image:radial-gradient(ellipse_at_center,black_0_48%,transparent_78%)] before:content-[""] after:absolute after:h-[min(36vw,340px)] after:w-[min(76vw,780px)] after:rounded-[34px] after:bg-[radial-gradient(ellipse_at_42%_48%,rgb(var(--accent-hot-rgb)/0.2),transparent_54%),radial-gradient(ellipse_at_60%_46%,rgb(var(--accent-rgb)/0.2),transparent_66%)] after:[filter:blur(18px)] after:content-[""] platform-windows:before:animate-none platform-windows:after:[filter:none]',
  buildField:
    'relative z-[1] block h-[min(28vw,260px)] w-[min(76vw,760px)] before:absolute before:inset-0 before:h-full before:w-[24%] before:animate-[homeBrainScan_2.2s_ease-in-out_infinite] before:bg-[linear-gradient(90deg,transparent,rgb(var(--accent-hot-rgb)/0.5),transparent)] before:[filter:blur(5px)] before:content-[""] after:absolute after:inset-0 after:bg-[linear-gradient(90deg,transparent_0_18%,rgb(var(--accent-rgb)/0.16)_18.4%_18.7%,transparent_19%_100%),linear-gradient(180deg,transparent_0_50%,rgb(var(--accent-hot-rgb)/0.14)_50.3%_50.7%,transparent_51%_100%)] after:opacity-70 after:content-[""] platform-windows:before:animate-none platform-windows:before:[filter:none]',
  particle:
    'absolute size-[5px] animate-[homeBrainParticlePulse_1.8s_ease-in-out_infinite] rounded-full bg-[var(--accent)] opacity-70 shadow-[0_0_22px_rgb(var(--accent-rgb)/0.46)] platform-windows:animate-none platform-windows:shadow-none',
  buildCopy:
    'relative z-[1] grid gap-[5px] rounded-[20px] border border-[color-mix(in_srgb,var(--accent-hot)_20%,var(--liquid-border))] bg-[color-mix(in_srgb,var(--glass-bg,var(--surface))_60%,transparent)] px-[18px] py-3.5 text-center shadow-[0_20px_70px_rgba(0,0,0,0.22)] platform-windows:shadow-none',
  buildTitle:
    'text-[13px] font-[850] tracking-[0.08em] text-[var(--text)] uppercase',
  buildCopyText:
    'text-xs text-[var(--muted)]',
  progress:
    'relative z-[1] h-2.5 w-[min(460px,76vw)] overflow-hidden rounded-full border border-[color-mix(in_srgb,var(--accent)_22%,transparent)] shadow-[inset_0_0_18px_rgb(var(--accent-rgb)/0.08),0_0_34px_rgb(var(--accent-hot-rgb)/0.12)] [background:linear-gradient(180deg,rgb(var(--accent-hot-rgb)/0.1),transparent),color-mix(in_srgb,var(--surface-2)_82%,transparent)] platform-windows:shadow-none',
  progressFill:
    'block h-full w-full origin-left animate-[homeBrainBuildProgress_2.4s_cubic-bezier(0.16,1,0.3,1)_infinite] rounded-[inherit] bg-[linear-gradient(90deg,var(--accent),var(--accent-hot),var(--accent))] shadow-[0_0_28px_rgb(var(--accent-hot-rgb)/0.5)] platform-windows:animate-none platform-windows:shadow-none',
  metrics:
    'relative z-[1] grid w-[min(360px,76vw)] grid-cols-3 gap-2',
  metric:
    'relative h-[3px] overflow-hidden rounded-full bg-[color-mix(in_srgb,var(--accent)_18%,transparent)] after:absolute after:inset-0 after:-translate-x-full after:animate-[homeBrainBuildMetric_1.55s_ease-in-out_infinite] after:bg-[linear-gradient(90deg,transparent,var(--accent-hot),transparent)] after:content-[""] platform-windows:after:animate-none',
  metricSecond: 'after:[animation-delay:0.22s]',
  metricThird: 'after:[animation-delay:0.44s]',
} as const

export const homeLoaderStyles = {
  root:
    'relative grid h-full min-h-[clamp(420px,62vh,720px)] w-[min(100%,980px)] items-center justify-items-center gap-[22px] overflow-visible before:pointer-events-none before:absolute before:size-[min(68vw,620px)] before:rounded-full before:bg-[radial-gradient(circle,rgb(var(--accent-hot-rgb)/0.16),transparent_62%),radial-gradient(circle,rgb(var(--accent-rgb)/0.13),transparent_54%)] before:[filter:blur(10px)] before:content-[""] after:pointer-events-none after:absolute after:inset-[8%] after:animate-[homeGridBuild_2.8s_linear_infinite] after:rounded-full after:bg-[linear-gradient(90deg,rgb(var(--accent-hot-rgb)/0.11)_1px,transparent_1px),linear-gradient(rgb(var(--accent-rgb)/0.095)_1px,transparent_1px)] after:bg-[length:38px_38px] after:opacity-70 after:[mask-image:radial-gradient(circle,black_0_42%,transparent_72%)] after:content-[""] max-[760px]:min-h-[260px] max-[760px]:w-full platform-windows:before:[filter:none] platform-windows:after:animate-none',
  orbit:
    'relative z-[1] grid aspect-square w-[min(56vw,430px)] place-items-center max-[760px]:w-[min(72vw,280px)]',
  ring:
    'col-start-1 row-start-1 size-full animate-[homeOrbitBuild_2.6s_linear_infinite] rounded-full border border-[rgb(var(--accent-hot-rgb)/0.34)] shadow-[inset_0_0_28px_rgb(var(--accent-rgb)/0.12),0_0_32px_rgb(var(--accent-hot-rgb)/0.16)] platform-windows:animate-none platform-windows:shadow-none',
  ringSecond:
    'size-[76%] [animation-duration:3.4s] rotate-[38deg]',
  ringThird:
    'size-[54%] [animation-duration:4.1s] -rotate-[22deg]',
  core:
    'col-start-1 row-start-1 size-[26%] animate-[homeCoreBreath_1.7s_ease-in-out_infinite] rounded-full bg-[radial-gradient(circle_at_45%_42%,var(--accent-hot),transparent_28%),radial-gradient(circle,rgb(var(--accent-rgb)/0.46),transparent_66%)] shadow-[0_0_44px_rgb(var(--accent-hot-rgb)/0.42),0_0_110px_rgb(var(--accent-rgb)/0.25)] platform-windows:animate-none platform-windows:shadow-none',
  copy:
    'relative z-[1] grid gap-1 rounded-[18px] border border-[color-mix(in_srgb,var(--accent-hot)_18%,var(--liquid-border))] bg-[color-mix(in_srgb,var(--glass-bg,var(--surface))_58%,transparent)] px-[18px] py-3.5 text-center shadow-[0_18px_60px_rgba(0,0,0,0.18)] max-[760px]:px-3.5 max-[760px]:py-3 platform-windows:shadow-none',
  title: 'text-[13px] font-[850] text-[var(--text)]',
  subtitle: 'text-xs text-[var(--muted)]',
} as const

export const homeParticlePositions = [
  'left-[8%] top-[56%] [animation-delay:0.04s]',
  'left-[12%] top-[46%] [animation-delay:0.08s]',
  'left-[16%] top-[62%] [animation-delay:0.12s]',
  'left-[20%] top-[38%] [animation-delay:0.16s]',
  'left-[24%] top-[50%] [animation-delay:0.20s]',
  'left-[28%] top-[69%] [animation-delay:0.24s]',
  'left-[32%] top-[42%] [animation-delay:0.28s]',
  'left-[36%] top-[58%] [animation-delay:0.32s]',
  'left-[40%] top-[34%] [animation-delay:0.36s]',
  'left-[44%] top-[52%] [animation-delay:0.40s]',
  'left-[48%] top-[72%] [animation-delay:0.44s]',
  'left-[52%] top-[45%] [animation-delay:0.48s]',
  'left-[56%] top-[61%] [animation-delay:0.52s]',
  'left-[60%] top-[37%] [animation-delay:0.56s]',
  'left-[64%] top-[54%] [animation-delay:0.60s]',
  'left-[68%] top-[70%] [animation-delay:0.64s]',
  'left-[72%] top-[43%] [animation-delay:0.68s]',
  'left-[76%] top-[59%] [animation-delay:0.72s]',
  'left-[80%] top-[35%] [animation-delay:0.76s]',
  'left-[84%] top-[51%] [animation-delay:0.80s]',
  'left-[88%] top-[64%] [animation-delay:0.84s]',
  'left-[92%] top-[46%] [animation-delay:0.88s]',
  'left-[18%] top-[76%] [animation-delay:0.92s]',
  'left-[30%] top-[25%] [animation-delay:0.96s]',
  'left-[43%] top-[82%] [animation-delay:1s]',
  'left-[58%] top-[22%] [animation-delay:1.04s]',
  'left-[70%] top-[82%] [animation-delay:1.08s]',
  'left-[86%] top-[26%] [animation-delay:1.12s]',
] as const
