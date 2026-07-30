export const toastStyles = {
  container:
    'pointer-events-none fixed left-1/2 top-4 z-[9999] flex -translate-x-1/2 flex-col gap-2 max-[760px]:inset-x-2.5 max-[760px]:top-[calc(10px+env(safe-area-inset-top))] max-[760px]:z-[250] max-[760px]:w-[calc(100vw-20px)] max-[760px]:translate-x-0',
  base:
    'pointer-events-auto flex min-w-80 items-center gap-3 rounded-xl border border-white/10 bg-[rgba(8,6,4,0.86)] px-4 py-3 text-white shadow-[0_4px_24px_rgba(0,0,0,0.4),inset_0_1px_0_rgba(255,255,255,0.1)] backdrop-blur-xl max-[760px]:w-full',
  offline:
    'border-red-500/30 shadow-[0_4px_24px_rgba(239,68,68,0.15),inset_0_1px_0_rgba(239,68,68,0.2)]',
  online:
    'border-green-500/30 shadow-[0_4px_24px_rgba(34,197,94,0.15),inset_0_1px_0_rgba(34,197,94,0.2)]',
  model:
    'border-violet-500/30 shadow-[0_4px_24px_rgba(139,92,246,0.15),inset_0_1px_0_rgba(139,92,246,0.2)]',
  icon: 'flex size-8 shrink-0 items-center justify-center rounded-lg',
  offlineIcon: 'bg-red-500/15 text-red-500',
  onlineIcon: 'bg-green-500/15 text-green-500',
  modelIcon: 'bg-violet-500/15 text-violet-500',
  text:
    'flex min-w-0 flex-col [&>strong]:text-[13px] [&>strong]:font-semibold [&>strong]:tracking-[0.02em] [&>span]:text-xs [&>span]:leading-[1.4] [&>span]:text-white/60',
} as const
