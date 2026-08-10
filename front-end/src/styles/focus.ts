export const focusStyles = {
  container: 'focus-page absolute inset-0 z-[1] block h-full min-h-0 w-full max-w-full touch-pan-y overflow-x-hidden overflow-y-scroll overscroll-y-contain [-webkit-overflow-scrolling:touch] [scroll-padding-bottom:calc(var(--mobile-nav-height)+env(safe-area-inset-bottom)+40px)] px-6 pt-[clamp(56px,6vh,86px)] pb-[76px] text-[var(--text)] [background:radial-gradient(circle_at_50%_30%,rgb(var(--accent-rgb)/0.16),transparent_50%),radial-gradient(circle_at_80%_80%,rgb(var(--accent-hot-rgb)/0.12),transparent_45%),var(--liquid-bg)] before:pointer-events-none before:fixed before:inset-0 before:z-0 before:bg-[linear-gradient(90deg,rgb(var(--accent-hot-rgb)/0.045)_1px,transparent_1px),linear-gradient(rgb(var(--accent-hot-rgb)/0.04)_1px,transparent_1px)] before:bg-[length:48px_48px] before:opacity-60 before:content-[""] max-[760px]:pl-[max(14px,env(safe-area-inset-left))] max-[760px]:pr-[max(14px,env(safe-area-inset-right))] max-[760px]:pt-[calc(14px+env(safe-area-inset-top))] max-[760px]:pb-[calc(var(--mobile-nav-height)+44px+env(safe-area-inset-bottom))] platform-ios:before:!opacity-25',
  content: 'relative z-[2] mx-auto flex w-full min-w-0 max-w-[800px] shrink-0 flex-col gap-6 text-left max-[760px]:gap-4 max-[760px]:pb-2',
  
  header: 'mt-8 mb-4 flex min-w-0 flex-col gap-2 max-[760px]:mt-2 max-[760px]:mb-2',
  greeting: 'text-[clamp(28px,3vw,36px)] font-black tracking-[-0.02em] text-[var(--text)]',
  subtitle: 'text-[clamp(15px,1.5vw,17px)] text-[var(--muted)]',
  
  card: 'relative flex min-w-0 max-w-full flex-col gap-4 overflow-hidden rounded-[24px] border border-[var(--liquid-border)] p-[clamp(20px,2.5vw,28px)] text-left shadow-[var(--liquid-shadow-soft)] [background:linear-gradient(135deg,rgba(255,255,255,0.08),rgba(255,255,255,0.02)),var(--liquid-panel-soft)] before:pointer-events-none before:absolute before:inset-0 before:bg-[radial-gradient(circle_at_20%_0%,rgb(var(--accent-rgb)/0.15),transparent_40%)] before:opacity-60 before:content-[""] backdrop-blur-[24px] platform-windows:backdrop-blur-none platform-windows:shadow-none max-[760px]:rounded-[20px] max-[760px]:p-4 platform-ios:backdrop-blur-none platform-ios:shadow-none',
  cardTitle: 'text-[18px] font-bold text-[var(--text)] flex items-center gap-2',
  
  taskInputWrapper: 'flex min-w-0 w-full items-center gap-2 rounded-xl bg-black/10 p-1 ring-1 ring-white/10 focus-within:ring-[var(--accent)] transition-all',
  taskInput: 'min-w-0 flex-1 bg-transparent px-3 py-2.5 text-[15px] outline-none text-[var(--text)] placeholder-[var(--muted)] max-[760px]:text-base',
  taskAddBtn: 'flex size-9 shrink-0 items-center justify-center rounded-lg bg-[var(--accent)] text-white shadow hover:opacity-90 transition-opacity',

  taskList: 'flex flex-col gap-2',
  taskItem: 'group flex flex-col gap-2 rounded-[16px] border border-white/5 bg-white/5 p-3.5 transition-all hover:bg-white/10 hover:border-white/15',
  taskItemCompleted: 'opacity-50 grayscale',
  
  taskContent: 'flex min-w-0 w-full items-start gap-3',
  taskCheckbox: 'flex size-5 shrink-0 items-center justify-center rounded-md border border-[var(--text)] opacity-50 text-[var(--text)] cursor-pointer transition-all hover:opacity-100 mt-0.5',
  taskCheckboxChecked: 'bg-[var(--text)] !opacity-100 text-[var(--bg)] border-transparent',
  taskTitle: 'min-w-0 whitespace-pre-wrap break-words text-[14px] font-medium leading-snug text-[var(--text)] [overflow-wrap:anywhere]',
  taskTitleCompleted: 'line-through text-[var(--muted)]',
  
  taskMeta: 'flex min-w-0 flex-wrap items-center gap-1.5',
  badgeCategory: 'rounded-full px-2 py-0.5 text-[11px] font-bold uppercase tracking-wider bg-white/10 text-[var(--text)] opacity-70',
  badgePriorityHigh: 'rounded-full px-2 py-0.5 text-[11px] font-bold uppercase tracking-wider bg-red-500/20 text-red-400',
  badgePriorityMedium: 'rounded-full px-2 py-0.5 text-[11px] font-bold uppercase tracking-wider bg-amber-500/20 text-amber-400',
  badgePriorityLow: 'rounded-full px-2 py-0.5 text-[11px] font-bold uppercase tracking-wider bg-blue-500/20 text-blue-400',
  
  taskActions: 'flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity max-[760px]:opacity-100',
  actionBtn: 'flex size-7 items-center justify-center rounded-md hover:bg-white/10 text-[var(--muted)] hover:text-red-400 transition-colors',
  
  brainDumpArea: 'w-full min-w-0 min-h-[140px] resize-none rounded-[16px] border border-white/10 bg-black/20 p-4 text-[15px] leading-relaxed text-[var(--text)] outline-none ring-[var(--accent)] focus:ring-1 focus:border-[var(--accent)] placeholder-[var(--muted)] transition-all max-[760px]:text-base',
  brainDumpBtn: 'flex w-full items-center justify-center gap-2 rounded-xl bg-[var(--accent-hot)] px-4 py-3.5 text-[15px] font-bold text-[var(--accent-ink)] shadow-md hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed',
  
  organizeResult: 'mt-4 rounded-xl border border-white/10 bg-black/30 p-4 text-[14px] leading-relaxed text-[color-mix(in_srgb,var(--text)_80%,transparent)]',
  error: 'rounded-[16px] border border-rose-400/25 bg-rose-500/10 px-4 py-3 text-[13px] leading-relaxed text-rose-100',
  retryButton: 'mt-2 inline-flex min-h-10 items-center justify-center rounded-xl border border-rose-300/25 bg-rose-400/12 px-4 text-[13px] font-bold text-rose-100 transition-colors hover:bg-rose-400/20',
} as const
