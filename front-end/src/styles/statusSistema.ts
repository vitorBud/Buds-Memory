export const systemStatusStyles = {
  wrap: 'relative',
  button:
    'inline-flex cursor-pointer items-center gap-[5px] rounded-full border border-white/7 bg-white/4 py-1 pr-2.5 pl-[7px] transition-[background,border-color] duration-200 hover:border-white/14 hover:bg-white/8 platform-windows:transition-none',
  buttonOpen: 'border-white/14 bg-white/8',
  dot:
    'block size-[7px] shrink-0 rounded-full transition-[background] duration-400 platform-windows:animate-none platform-windows:transition-none',
  label:
    'ml-0.5 text-[11px] font-semibold tracking-[0.02em] text-white/45',
  model:
    'ml-0.5 border-l border-white/12 pl-1.5 text-[10px] font-bold leading-none text-white/58 uppercase',
  popover:
    'absolute top-[calc(100%+8px)] left-0 z-[1000] grid min-w-[220px] animate-[boot-in_0.18s_cubic-bezier(0.2,0.8,0.2,1)_both] gap-2 rounded-2xl border border-white/10 p-3 shadow-[0_16px_40px_rgba(0,0,0,0.5),0_0_0_1px_rgba(99,102,241,0.1)] [background:linear-gradient(135deg,rgba(255,255,255,0.05)_0%,transparent_55%),rgba(10,12,16,0.97)] [backdrop-filter:blur(20px)_saturate(1.4)] platform-windows:animate-none platform-windows:shadow-none platform-windows:[backdrop-filter:none]',
  popoverTitle:
    'mb-1 text-[10px] font-extrabold tracking-[0.1em] text-white/35 uppercase',
  popoverRow:
    'grid grid-cols-[16px_1fr_auto] items-center gap-1.5 [&_svg]:text-white/30',
  popoverName:
    'text-xs font-medium text-white/70',
  popoverBadge:
    'rounded-full px-[7px] py-0.5 text-[10px] font-bold tracking-[0.03em]',
  popoverDetail:
    'col-span-full pl-[22px] text-[10px] text-white/30',
} as const

export const systemDotStyles = {
  unknown: 'bg-white/22',
  ok: 'animate-[dot-pulse-ok_2.8s_ease-in-out_infinite] bg-green-500',
  error: 'animate-[dot-pulse-err_1.5s_ease-in-out_infinite] bg-red-500',
} as const

export const systemLabelStyles = {
  neutral: '',
  ok: 'text-green-400',
  error: 'text-red-400',
} as const

export const systemBadgeStyles = {
  unknown: 'bg-white/6 text-white/35',
  ok: 'bg-green-500/15 text-green-500',
  error: 'bg-red-500/15 text-red-400',
} as const
