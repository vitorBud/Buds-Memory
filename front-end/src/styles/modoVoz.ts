export const voiceModeStyles = {
  root:
    'relative isolate flex h-dvh min-h-[640px] items-center justify-center overflow-hidden px-6 pt-[clamp(80px,9vh,112px)] pb-10 [background:radial-gradient(circle_at_50%_42%,color-mix(in_srgb,var(--voice-a)_20%,transparent),transparent_30%),radial-gradient(circle_at_50%_50%,color-mix(in_srgb,var(--voice-b)_12%,transparent),transparent_48%),linear-gradient(180deg,var(--bg),color-mix(in_srgb,var(--bg)_88%,#000_12%))] platform-windows:[&_*]:![animation:none] platform-windows:[&_*]:![backdrop-filter:none] platform-windows:[&_*]:![transition-duration:0ms] max-[760px]:!h-dvh max-[760px]:!min-h-0 max-[760px]:!overflow-y-auto max-[760px]:!px-3.5 max-[760px]:!pt-[calc(12px+env(safe-area-inset-top))] max-[760px]:!pb-[calc(var(--mobile-nav-height)+18px+env(safe-area-inset-bottom))] platform-ios:!h-dvh platform-ios:!min-h-0',
  ambient:
    'pointer-events-none absolute top-1/2 left-1/2 -z-[1] size-[min(72vw,680px)] -translate-x-1/2 -translate-y-1/2 animate-[voice-ambient-drift_14s_linear_infinite] rounded-full opacity-18 blur-[18px] [background:radial-gradient(circle_at_50%_50%,color-mix(in_srgb,var(--voice-a)_18%,transparent),transparent_28%),repeating-conic-gradient(from_0deg,color-mix(in_srgb,var(--voice-a)_18%,transparent)_0_8deg,transparent_8deg_22deg)] platform-windows:animate-none platform-windows:blur-none max-[760px]:size-[min(118vw,460px)]',
  stage:
    'relative z-[2] flex max-h-full w-[min(92vw,780px)] flex-col items-center justify-center [--core-size:clamp(238px,min(32vw,36dvh),400px)] max-[760px]:w-full max-[760px]:![--core-size:min(58vw,28dvh,230px)] platform-ios:![--core-size:min(56vw,27dvh,224px)]',
  core:
    'grid size-[var(--core-size)] shrink-0 cursor-pointer appearance-none place-items-center border-0 bg-transparent p-0 [-webkit-tap-highlight-color:transparent] transition-[opacity,transform] duration-250 hover:scale-[1.018] disabled:cursor-default disabled:opacity-90 disabled:hover:scale-100 platform-windows:transition-none platform-windows:hover:scale-100 max-[760px]:mx-auto platform-ios:transition-[opacity,transform] platform-ios:duration-150',
  coreLayer:
    'pointer-events-none [grid-area:1/1]',
  halo:
    'size-[calc(var(--core-size)*1.18)] animate-[voice-halo_5.8s_ease-in-out_infinite] rounded-full opacity-70 blur-px [background:radial-gradient(circle,color-mix(in_srgb,var(--voice-a)_calc(20%+(var(--voice-volume)*32%)),transparent),transparent_62%),conic-gradient(from_90deg,transparent,color-mix(in_srgb,var(--voice-a)_42%,transparent),transparent,color-mix(in_srgb,var(--voice-b)_30%,transparent),transparent)] platform-windows:animate-none platform-windows:blur-none',
  orb:
    'relative grid size-[var(--core-size)] animate-[voice-breathe_4.8s_ease-in-out_infinite] justify-items-center overflow-hidden rounded-full border border-[color-mix(in_srgb,var(--voice-c)_34%,transparent)] shadow-[inset_0_1px_26px_color-mix(in_srgb,var(--voice-c)_16%,transparent),inset_0_-34px_58px_rgba(0,0,0,0.24),0_0_calc(52px+(var(--voice-volume)*72px))_color-mix(in_srgb,var(--voice-a)_32%,transparent),0_26px_90px_rgba(0,0,0,0.34)] [background:radial-gradient(circle_at_35%_28%,color-mix(in_srgb,var(--voice-c)_76%,transparent),transparent_0_12%,transparent_30%),radial-gradient(circle_at_58%_60%,color-mix(in_srgb,var(--voice-a)_56%,transparent),transparent_42%),radial-gradient(circle_at_42%_48%,color-mix(in_srgb,var(--voice-b)_50%,transparent),transparent_58%),linear-gradient(135deg,color-mix(in_srgb,var(--voice-a)_24%,rgba(255,255,255,0.08)),rgba(255,255,255,0.03))] [transform:scale(calc(1+(var(--voice-volume)*0.08)))] transition-transform duration-75 platform-windows:animate-none platform-windows:shadow-none',
  orbLayer:
    'relative block rounded-full [grid-area:1/1]',
  ringOne:
    'size-[72%] animate-[voice-ring-spin_12s_linear_infinite] border border-[color-mix(in_srgb,var(--voice-a)_45%,transparent)] opacity-80',
  ringTwo:
    'h-[52%] w-[82%] animate-[voice-ring-spin_8s_linear_reverse_infinite] border border-[color-mix(in_srgb,var(--voice-b)_38%,transparent)] opacity-72 [transform:rotateX(72deg)]',
  flow:
    'size-[48%] animate-[voice-core-flow_5.4s_ease-in-out_infinite] opacity-62 blur-[0.2px] [background:radial-gradient(circle,color-mix(in_srgb,var(--voice-c)_68%,transparent),transparent_8%),conic-gradient(from_30deg,transparent,color-mix(in_srgb,var(--voice-a)_44%,transparent),transparent_52%)]',
  glow:
    'size-[34%] bg-[radial-gradient(circle,color-mix(in_srgb,var(--voice-c)_72%,transparent),transparent_58%)] opacity-[calc(0.32+(var(--voice-volume)*0.42))] blur-2xl platform-windows:blur-none',
  grid:
    'size-[calc(var(--core-size)*0.92)] rounded-full opacity-20 [background:linear-gradient(90deg,transparent_49%,color-mix(in_srgb,var(--voice-c)_10%,transparent)_50%,transparent_51%),linear-gradient(0deg,transparent_49%,color-mix(in_srgb,var(--voice-c)_10%,transparent)_50%,transparent_51%)] [background-size:34px_34px] [mask-image:radial-gradient(circle,#000_42%,transparent_72%)]',
  particles:
    'relative size-[calc(var(--core-size)*1.24)]',
  particle:
    'absolute top-1/2 left-1/2 size-[calc(3px+(var(--voice-volume)*5px))] animate-[voice-particle_2.8s_ease-in-out_infinite] rounded-full bg-[var(--voice-c)] opacity-[calc(0.18+(var(--voice-volume)*0.58))] shadow-[0_0_18px_color-mix(in_srgb,var(--voice-a)_70%,transparent)] [--angle:calc(var(--p)*20deg)] [animation-delay:calc(var(--p)*-0.08s)] [transform:rotate(var(--angle))_translateY(calc((var(--core-size)*-0.47)-(var(--voice-volume)*24px)))] platform-windows:shadow-none',
  status:
    'mt-7 grid min-h-14 items-center justify-items-center gap-1.5 text-center max-[760px]:mt-[18px] max-[760px]:min-h-[52px] max-[760px]:max-w-[min(330px,calc(100vw-28px))] [&>strong]:text-[clamp(24px,3vw,34px)] [&>strong]:font-semibold [&>strong]:tracking-normal [&>strong]:text-buds-text max-[760px]:[&>strong]:text-[clamp(22px,7vw,30px)] [&>span]:text-xs [&>span]:font-bold [&>span]:uppercase [&>span]:tracking-[0.12em] [&>span]:text-buds-muted max-[760px]:[&>span]:max-w-[280px] max-[760px]:[&>span]:text-[11px] max-[760px]:[&>span]:leading-[1.35] max-[760px]:[&>span]:tracking-[0.08em]',
  controls:
    'mt-[18px] flex max-w-[min(92vw,760px)] items-center gap-2.5 rounded-3xl border border-[color-mix(in_srgb,var(--voice-c)_16%,transparent)] p-2 shadow-[0_18px_50px_rgba(0,0,0,0.18),inset_0_1px_0_rgba(255,255,255,0.12)] [background:linear-gradient(135deg,rgba(255,255,255,0.15),rgba(255,255,255,0.035)),color-mix(in_srgb,var(--glass)_72%,transparent)] [backdrop-filter:blur(20px)_saturate(1.28)] platform-windows:shadow-none platform-windows:[backdrop-filter:none] max-[760px]:mt-3 max-[760px]:w-full max-[760px]:max-w-[min(360px,calc(100vw-28px))] max-[760px]:flex-col max-[760px]:items-stretch max-[760px]:gap-2 max-[760px]:rounded-[20px]',
  selectWrap:
    'inline-flex min-h-[38px] min-w-[min(48vw,260px)] items-center gap-2 rounded-[18px] border border-white/10 bg-white/8 px-2.5 text-[var(--voice-c)] max-[760px]:w-full max-[760px]:min-w-0',
  select:
    'w-full min-w-0 appearance-none border-0 bg-transparent text-xs font-bold text-buds-text outline-none [&>option]:text-slate-900',
  sensitivity:
    'inline-flex min-h-[38px] items-center gap-1 rounded-[18px] border border-white/8 bg-white/6 p-[3px] max-[760px]:grid max-[760px]:w-full max-[760px]:grid-cols-3',
  sensitivityButton:
    'inline-flex min-h-[30px] cursor-pointer appearance-none items-center gap-[7px] rounded-[14px] border-0 bg-transparent px-[11px] text-[11px] font-extrabold text-buds-muted transition-[background,color,transform] duration-180 hover:-translate-y-px hover:text-buds-text platform-windows:transition-none platform-windows:hover:translate-y-0 max-[760px]:w-full max-[760px]:min-w-0 max-[760px]:justify-center max-[760px]:px-2',
  sensitivityActive:
    'bg-[color-mix(in_srgb,var(--voice-a)_22%,rgba(255,255,255,0.1))] text-buds-text shadow-[inset_0_1px_0_rgba(255,255,255,0.12)]',
  interrupt:
    'inline-flex min-h-[30px] cursor-pointer appearance-none items-center gap-[7px] rounded-[14px] border border-rose-500/24 bg-rose-500/15 px-[11px] text-[11px] font-extrabold text-rose-200 transition-[background,color,transform] duration-180 hover:-translate-y-px hover:text-buds-text platform-windows:transition-none platform-windows:hover:translate-y-0 max-[760px]:w-full max-[760px]:min-w-0 max-[760px]:justify-center max-[760px]:px-2',
  end:
    'relative z-20 mt-3 inline-flex min-h-11 items-center gap-[9px] rounded-full border border-white/14 px-[18px] text-buds-text shadow-[0_18px_48px_rgba(0,0,0,0.28)] transition-[transform,background] duration-200 [background:linear-gradient(135deg,rgba(255,255,255,0.14),transparent_48%),rgba(255,255,255,0.07)] [backdrop-filter:blur(18px)_saturate(1.35)] hover:-translate-y-px hover:bg-rose-500/18 platform-windows:shadow-none platform-windows:transition-none platform-windows:[backdrop-filter:none] max-[760px]:min-h-[42px] max-[760px]:max-w-[calc(100vw-32px)] max-[760px]:whitespace-nowrap max-[760px]:px-3.5 max-[760px]:[&>span]:overflow-hidden max-[760px]:[&>span]:text-ellipsis max-[760px]:[&>span]:text-[13px] platform-ios:!shadow-none',
  micIndicator:
    'fixed top-[88px] right-7 grid size-[42px] place-items-center rounded-full border border-[color-mix(in_srgb,var(--voice-a)_28%,transparent)] text-[var(--voice-c)] [backdrop-filter:blur(16px)_saturate(1.3)] platform-windows:[backdrop-filter:none] max-[760px]:top-[calc(14px+env(safe-area-inset-top))] max-[760px]:right-3.5 max-[760px]:size-[38px]',
} as const

export const voiceHaloStateStyles: Partial<Record<string, string>> = {
  listening: '![animation-duration:2.2s] !opacity-95',
  speaking: '![animation-duration:1.9s]',
}

export const voiceRingStateStyles: Partial<Record<string, string>> = {
  thinking: '![animation-duration:3.2s]',
}
