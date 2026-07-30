export const sidebarStyles = {
  scrim:
    'fixed inset-0 z-[8000] hidden border-0 bg-[rgba(0,0,0,0.34)] p-0 [backdrop-filter:blur(10px)] max-[760px]:block',
  root:
    'flex min-w-0 flex-col overflow-hidden rounded-[26px] border border-[var(--liquid-border)] bg-[var(--liquid-panel)] shadow-[var(--liquid-shadow-soft),inset_0_1px_0_rgba(255,255,255,0.16)] [backdrop-filter:blur(28px)_saturate(1.45)] max-[1180px]:items-center max-[900px]:hidden max-[760px]:fixed max-[760px]:!top-[calc(12px+env(safe-area-inset-top))] max-[760px]:!bottom-0 max-[760px]:!left-0 max-[760px]:z-[8010] max-[760px]:!flex max-[760px]:!w-[min(88vw,340px)] max-[760px]:!max-w-[340px] max-[760px]:!items-stretch max-[760px]:!rounded-r-[22px] max-[760px]:!rounded-l-none max-[760px]:!border-0 max-[760px]:!bg-[color-mix(in_srgb,var(--bg)_96%,var(--surface)_4%)] max-[760px]:!shadow-[16px_0_44px_rgba(0,0,0,0.24)] max-[760px]:![backdrop-filter:none]',
  head:
    'grid flex-none gap-3 border-b border-[var(--liquid-border)] p-4 max-[1180px]:px-2.5 max-[760px]:!flex max-[760px]:!w-full max-[760px]:!flex-col max-[760px]:!items-stretch max-[760px]:!gap-2.5 max-[760px]:!px-3 max-[760px]:!pt-[calc(14px+env(safe-area-inset-top))] max-[760px]:!pb-3',
  mobileBrand:
    'contents max-[760px]:!flex max-[760px]:!min-h-10 max-[760px]:!w-full max-[760px]:!flex-none max-[760px]:!items-center max-[760px]:!gap-2.5',
  mobileBrandCopy:
    'hidden max-[760px]:!grid max-[760px]:min-w-0 max-[760px]:flex-auto max-[760px]:gap-px [&>strong]:text-[15px] [&>strong]:leading-none [&>strong]:text-aether-text [&>span]:text-xs [&>span]:text-aether-muted',
  glyph:
    'flex size-9 shrink-0 items-center justify-center rounded-aether border border-[var(--line-strong)] text-aether-cyan [background:linear-gradient(135deg,rgba(6,182,212,0.16),rgba(139,92,246,0.14))] max-[760px]:!flex max-[760px]:!basis-9 max-[760px]:!rounded-xl',
  newChat:
    'inline-flex min-h-[38px] w-full items-center justify-center gap-2 rounded-full border border-[var(--liquid-border)] bg-[var(--liquid-panel-soft)] px-3 text-aether-text transition-[background,border-color,color,transform,box-shadow] duration-180 hover:-translate-y-px hover:border-[var(--liquid-border-strong)] hover:bg-[rgba(var(--accent-hot-rgb)/0.11)] hover:shadow-[0_10px_34px_rgba(var(--accent-hot-rgb)/0.12)] max-[1180px]:w-10 max-[1180px]:[&>span]:hidden max-[760px]:!min-h-[42px] max-[760px]:!w-full max-[760px]:!justify-start max-[760px]:!gap-[9px] max-[760px]:!rounded-[13px] max-[760px]:!border max-[760px]:!border-[var(--liquid-border)] max-[760px]:!bg-[color-mix(in_srgb,var(--surface-2)_86%,transparent)] max-[760px]:text-sm max-[760px]:font-bold max-[760px]:[&>span]:!block',
  search:
    'flex min-h-9 items-center gap-2 overflow-hidden rounded-[14px] border border-[var(--liquid-border)] px-2.5 text-aether-muted shadow-[inset_0_1px_0_color-mix(in_srgb,var(--text)_10%,transparent),0_8px_24px_rgba(0,0,0,0.12)] transition-[background,border-color,box-shadow,color] duration-180 [background:linear-gradient(135deg,var(--liquid-highlight),transparent_48%),color-mix(in_srgb,var(--liquid-panel-strong)_72%,transparent)] [backdrop-filter:blur(18px)_saturate(1.32)] hover:border-[var(--liquid-border-strong)] hover:text-aether-text hover:[background:linear-gradient(135deg,var(--liquid-highlight),transparent_54%),color-mix(in_srgb,var(--liquid-panel-strong)_84%,transparent)] focus-within:border-[color-mix(in_srgb,var(--accent-hot)_46%,var(--liquid-border))] focus-within:text-aether-accent-hot focus-within:shadow-[0_0_0_3px_rgba(var(--accent-hot-rgb)/0.1),0_12px_30px_rgba(0,0,0,0.18),inset_0_1px_0_color-mix(in_srgb,var(--text)_14%,transparent)] focus-within:[background:linear-gradient(135deg,var(--liquid-highlight),transparent_56%),color-mix(in_srgb,var(--liquid-panel-strong)_92%,transparent)] focus-within:[&>svg]:text-aether-accent-hot max-[760px]:!flex max-[760px]:!min-h-[42px] max-[760px]:!w-full max-[760px]:!rounded-[13px] max-[760px]:!border max-[760px]:!border-[var(--liquid-border)] max-[760px]:!bg-[color-mix(in_srgb,var(--surface-2)_78%,transparent)] max-[760px]:!px-[11px]',
  searchInput:
    'min-w-0 flex-auto appearance-none rounded-none border-0 bg-transparent p-0 text-sm leading-[1.2] text-aether-text shadow-none outline-0 caret-aether-accent-hot placeholder:text-aether-faint focus-visible:outline-0 max-[760px]:!w-full max-[760px]:text-base',
  section:
    'flex min-h-0 flex-1 flex-col gap-2.5 px-3 py-3.5 max-[760px]:!w-full max-[760px]:!items-stretch max-[760px]:!gap-2 max-[760px]:!px-2 max-[760px]:!py-3',
  title:
    'flex items-center justify-between gap-[7px] text-[11px] font-bold uppercase text-aether-muted max-[1180px]:hidden max-[760px]:!flex max-[760px]:!px-2',
  list:
    'flex min-h-0 flex-1 flex-col gap-[5px] overflow-auto [-webkit-overflow-scrolling:touch] max-[760px]:!w-full max-[760px]:!items-stretch max-[760px]:!gap-0.5',
  session:
    'relative grid min-h-[54px] w-full cursor-pointer gap-0.5 rounded-[18px] border border-transparent bg-[var(--liquid-panel-soft)] py-[9px] pr-[34px] pl-[11px] text-left text-aether-text hover:border-[var(--liquid-border-strong)] hover:bg-[rgba(var(--accent-hot-rgb)/0.08)] max-[1180px]:flex max-[1180px]:size-10 max-[1180px]:min-h-10 max-[1180px]:items-center max-[1180px]:justify-center max-[1180px]:p-0 max-[1180px]:before:size-2 max-[1180px]:before:rounded-full max-[1180px]:before:bg-aether-muted max-[760px]:!grid max-[760px]:!h-auto max-[760px]:!min-h-[52px] max-[760px]:!w-full max-[760px]:!grid-cols-[minmax(0,1fr)] max-[760px]:!items-stretch max-[760px]:!justify-stretch max-[760px]:!rounded-xl max-[760px]:!border-0 max-[760px]:!bg-transparent max-[760px]:!py-2 max-[760px]:!pr-[38px] max-[760px]:!pl-2.5 max-[760px]:before:hidden',
  sessionActive:
    '!border-[var(--liquid-border-strong)] !bg-[rgba(var(--accent-hot-rgb)/0.08)] max-[760px]:!border-0 max-[760px]:!bg-[color-mix(in_srgb,var(--accent-hot)_10%,transparent)]',
  sessionTitle:
    'min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-[13px] font-semibold max-[1180px]:hidden max-[760px]:!block max-[760px]:!w-full max-[760px]:text-sm max-[760px]:font-[650]',
  sessionDate:
    'min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-[11px] text-aether-muted max-[1180px]:hidden max-[760px]:!block max-[760px]:!w-full',
  delete:
    'absolute right-[5px] top-3.5 flex size-6 items-center justify-center rounded-md text-aether-faint opacity-0 hover:bg-[color-mix(in_srgb,var(--rose)_15%,transparent)] hover:text-aether-rose group-hover:opacity-100 max-[1180px]:hidden max-[760px]:!right-[7px] max-[760px]:!top-[13px] max-[760px]:!flex max-[760px]:!text-aether-muted max-[760px]:!opacity-100',
  empty:
    'flex flex-col items-center gap-2 px-2 py-[30px] text-[11px] text-aether-muted max-[1180px]:[&>span]:hidden max-[760px]:[&>span]:!block',
  footer:
    'relative flex flex-none flex-wrap items-center justify-start gap-[7px] border-t border-[var(--liquid-border)] p-2.5 font-mono text-[11px] text-aether-muted [&_.sys-popover]:!top-auto [&_.sys-popover]:right-2.5 [&_.sys-popover]:bottom-[calc(100%+8px)] [&_.sys-popover]:left-2.5 [&_.sys-popover]:box-border [&_.sys-popover]:w-auto [&_.sys-popover]:min-w-0 [&_.sys-popover]:max-w-[calc(100%-20px)] [&_.sys-status-btn]:min-h-[25px] [&_.sys-status-btn]:py-[3px] [&_.sys-status-btn]:pr-2 [&_.sys-status-btn]:pl-1.5 [&_.sys-status-label]:text-[10px] [&_.sys-status-model]:pl-[5px] [&_.sys-status-model]:text-[9px] [&_.sys-status-wrap]:static [&_.sys-status-wrap]:flex-none max-[1180px]:w-full max-[1180px]:justify-center max-[1180px]:[&_span]:hidden max-[760px]:!w-full max-[760px]:!px-3.5 max-[760px]:!pt-2.5 max-[760px]:!pb-[calc(12px+env(safe-area-inset-bottom))] max-[760px]:[&_span]:!block',
  runtime:
    'inline-flex flex-none items-center gap-1.5 font-mono text-[11px] text-aether-muted',
  state:
    'inline-flex min-h-[25px] flex-none items-center gap-[7px] whitespace-nowrap rounded-full border border-[var(--liquid-border)] bg-[var(--liquid-panel-soft)] px-2 font-[inherit] text-[10px] font-bold [&>span]:size-[7px] [&>span]:animate-[blink_1.4s_ease_infinite] [&>span]:rounded-full platform-windows:[&>span]:![animation:none]',
} as const

export const sidebarToneStyles: Record<string, string> = {
  muted: 'text-aether-muted [&>span]:bg-aether-faint',
  cyan: 'text-aether-cyan [&>span]:bg-aether-cyan',
  amber: 'text-aether-amber [&>span]:bg-aether-amber',
  violet: 'text-aether-violet [&>span]:bg-aether-violet',
  emerald: 'text-aether-emerald [&>span]:bg-aether-emerald',
  rose: 'text-aether-rose [&>span]:bg-aether-rose',
}
