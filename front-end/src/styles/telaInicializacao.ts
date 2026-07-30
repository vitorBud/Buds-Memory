export const bootScreenStyles = {
  overlay:
    'fixed inset-0 z-[9999] flex items-center justify-center bg-[rgba(4,5,6,0.82)] transition-opacity duration-400 [backdrop-filter:blur(14px)_saturate(1.3)] [will-change:opacity,filter,transform] platform-windows:[backdrop-filter:none]',
  closing:
    'pointer-events-none animate-[boot-out_0.4s_cubic-bezier(0.4,0,0.2,1)_both] platform-windows:animate-none platform-windows:opacity-0',
  modal:
    'grid w-[calc(100vw-32px)] max-w-[440px] animate-[boot-in_0.38s_cubic-bezier(0.2,0.8,0.2,1)_both] gap-6 rounded-[28px] border border-white/10 p-7 shadow-[0_0_0_1px_rgba(99,102,241,0.15),0_32px_64px_rgba(0,0,0,0.55),0_0_80px_rgba(99,102,241,0.08)] [background:linear-gradient(135deg,rgba(255,255,255,0.045)_0%,transparent_60%),rgba(12,14,18,0.97)] platform-windows:animate-none platform-windows:shadow-none max-[480px]:gap-[18px] max-[480px]:p-5',
  brand:
    'flex items-center gap-4',
  logo:
    'flex size-[52px] shrink-0 animate-[pulse-glow_2.4s_ease-in-out_infinite] items-center justify-center rounded-2xl bg-[linear-gradient(135deg,#6366f1_0%,#8b5cf6_50%,#06b6d4_100%)] text-white shadow-[0_0_28px_rgba(99,102,241,0.4)] platform-windows:animate-none platform-windows:shadow-none',
  title:
    'm-0 text-[22px] font-bold leading-none tracking-[-0.02em] text-slate-200',
  subtitle:
    'mt-[5px] mb-0 text-[12.5px] text-white/40',

  authPanel:
    'grid gap-2 rounded-2xl border border-white/10 bg-white/[0.055] p-2.5',
  authForm:
    'grid grid-cols-1 gap-2',
  authLabel:
    'text-xs font-bold text-white/60',
  authCopy:
    'm-0 text-xs leading-[1.45] text-white/60',
  authInput:
    'min-h-[42px] min-w-0 rounded-lg border border-white/12 bg-white/7 px-3 text-white outline-none transition-[border-color,box-shadow] duration-160 placeholder:text-white/30 focus:border-indigo-400/60 focus:shadow-[0_0_0_3px_rgba(99,102,241,0.16)] platform-windows:transition-none',
  authButton:
    'inline-flex min-h-[42px] cursor-pointer items-center justify-center gap-[7px] rounded-lg border-0 bg-slate-200 px-3.5 font-extrabold text-slate-900 transition-[background,opacity] duration-160 hover:bg-white platform-windows:transition-none disabled:cursor-not-allowed disabled:opacity-45',
  authError:
    'm-0 text-xs text-red-300',

  steps:
    'grid gap-2.5',
  step:
    'flex items-start gap-3 rounded-2xl border border-white/6 bg-white/[0.025] px-3.5 py-[13px] transition-[border-color,background] duration-300 platform-windows:transition-none',
  stepIcon:
    'mt-px flex size-7 shrink-0 items-center justify-center rounded-lg text-white/45',
  stepBody:
    'grid min-w-0 flex-1 gap-1',
  stepHead:
    'flex items-center justify-between gap-2',
  stepLabel:
    'text-[13px] font-semibold text-slate-200',
  stepDetail:
    'm-0 overflow-hidden text-ellipsis whitespace-nowrap text-[11.5px] text-white/40',
  stepError:
    'm-0 text-[11px] text-red-400',

  bar:
    'mt-1.5 h-[3px] w-full overflow-hidden rounded-full bg-white/7',
  barFill:
    'h-full w-full rounded-full',

  badge:
    'inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[10.5px] font-semibold tracking-[0.02em]',

  actions:
    'flex justify-end gap-2.5',
  button:
    'cursor-pointer rounded-xl px-5 py-[9px] text-[13px] font-semibold transition-[background,box-shadow,color,transform] duration-180 platform-windows:transition-none',
  primaryButton:
    'border border-transparent bg-[linear-gradient(135deg,#6366f1,#8b5cf6)] text-white shadow-[0_4px_16px_rgba(99,102,241,0.35)] hover:-translate-y-px hover:shadow-[0_6px_24px_rgba(99,102,241,0.55)] platform-windows:shadow-none platform-windows:hover:translate-y-0',
  secondaryButton:
    'border border-white/10 bg-white/6 text-white/65 hover:bg-white/10 hover:text-white',
} as const

export const bootStepStyles = {
  pending: {
    row: '',
    icon: '',
    bar: 'w-0 bg-transparent',
  },
  loading: {
    row: 'border-indigo-500/20 bg-indigo-500/6',
    icon: 'text-indigo-400',
    bar: '-translate-x-full animate-[bar-slide_1.4s_ease-in-out_infinite] bg-[linear-gradient(90deg,#6366f1,#06b6d4)]',
  },
  ok: {
    row: 'border-green-500/20 bg-green-500/6',
    icon: 'text-green-500',
    bar: 'w-full bg-[linear-gradient(90deg,#22c55e,#10b981)] transition-[width] duration-500 platform-windows:transition-none',
  },
  error: {
    row: 'border-red-500/20 bg-red-500/6',
    icon: 'text-red-500',
    bar: 'w-full bg-red-500',
  },
} as const

export const bootBadgeStyles = {
  pending:
    'bg-white/6 text-white/35',
  loading:
    'bg-indigo-500/15 text-indigo-400',
  ok:
    'bg-green-500/15 text-green-500',
  error:
    'bg-red-500/15 text-red-400',
} as const
