/**
 * Receitas Tailwind do composer. Os valores responsivos refletem a cascata
 * visual final do antigo CSS, inclusive safe-area no mobile e o perfil leve
 * do Windows.
 */
export const chatInputStyles = {
  shell:
    'grid flex-none gap-2 border-t border-[var(--liquid-border)] min-[761px]:m-0 min-[761px]:!border-t min-[761px]:!border-[var(--liquid-border)] min-[761px]:!px-3 min-[761px]:!pt-2.5 min-[761px]:!pb-0 min-[761px]:![background:linear-gradient(180deg,transparent,color-mix(in_srgb,var(--liquid-panel),transparent_8%))] max-[760px]:relative max-[760px]:z-20 max-[760px]:!border-t-0 max-[760px]:!bg-transparent max-[760px]:!px-3 max-[760px]:!pt-1.5 max-[760px]:!pb-[calc(70px+env(safe-area-inset-bottom))] max-[760px]:!shadow-none',
  composer:
    'mx-auto flex min-h-[58px] min-w-0 w-full max-w-full items-end gap-2.5 overflow-hidden rounded-[22px] border border-[var(--liquid-border)] px-2 py-2 pl-4 text-buds-text shadow-[var(--liquid-shadow-soft),inset_0_1px_0_rgba(255,255,255,0.16)] [background:linear-gradient(135deg,var(--liquid-highlight),transparent_42%),var(--liquid-panel)] [backdrop-filter:blur(28px)_saturate(1.45)] focus-within:border-[var(--liquid-border-strong)] focus-within:shadow-[0_18px_58px_rgba(var(--accent-hot-rgb)/0.12),inset_0_1px_0_rgba(255,255,255,0.16)] platform-windows:!min-h-[58px] platform-windows:!bg-[var(--liquid-panel-soft)] platform-windows:!shadow-none platform-windows:!filter-none platform-ios:![backdrop-filter:none] max-[760px]:min-h-[54px] max-[760px]:gap-[7px] max-[760px]:!rounded-3xl max-[760px]:!border max-[760px]:!border-[var(--liquid-border)] max-[760px]:px-1.5 max-[760px]:py-1.5 max-[760px]:pl-3 max-[760px]:shadow-[0_10px_28px_rgba(0,0,0,0.14)] max-[760px]:![background:linear-gradient(135deg,rgba(255,255,255,0.12),transparent_42%),color-mix(in_srgb,var(--surface)_90%,transparent)] max-[760px]:[backdrop-filter:blur(22px)_saturate(1.25)] max-[360px]:flex-col max-[360px]:items-stretch',
  recording:
    '!border-[color-mix(in_srgb,var(--rose)_65%,var(--line))]',
  textarea:
    'min-h-[34px] min-w-0 max-w-full flex-1 resize-none overflow-x-hidden border-0 bg-transparent text-[15px] leading-[1.45] text-buds-text outline-0 placeholder:text-buds-faint max-[760px]:max-h-[118px] max-[760px]:px-0.5 max-[760px]:py-[7px] max-[760px]:text-base max-[760px]:leading-[1.35] platform-windows:!h-[42px] platform-windows:!max-h-[42px] platform-windows:overflow-y-auto platform-windows:resize-none',
  actions:
    'flex items-center gap-[7px] max-[760px]:items-end max-[760px]:gap-[5px] max-[360px]:justify-end',
  modelSelect: 'relative max-[900px]:hidden',
  modelButton:
    'inline-flex h-[34px] items-center gap-2 whitespace-nowrap rounded-buds border border-[rgb(var(--accent-rgb)/0.22)] bg-[rgb(12_8_4/0.78)] px-[9px] font-mono text-[11px] text-[var(--jarvis-muted)] transition-[background,border-color,color] duration-160 hover:border-[rgb(var(--accent-hot-rgb)/0.52)] hover:bg-[rgb(var(--accent-rgb)/0.13)] hover:text-[var(--jarvis-hot)] [&>span]:size-[7px] [&>span]:rounded-full [&>span]:bg-buds-accent-hot [&>span]:shadow-[0_0_18px_rgb(var(--accent-hot-rgb)/0.7)]',
  modelMenu:
    'absolute right-0 bottom-[calc(100%+8px)] z-20 min-w-[180px] overflow-hidden rounded-buds border border-[rgba(245,158,11,0.24)] bg-[rgba(8,6,4,0.96)] shadow-buds',
  modelOption:
    'grid w-full gap-0.5 border-0 bg-transparent px-2.5 py-[9px] text-left font-mono text-xs text-buds-muted hover:bg-[rgba(245,158,11,0.1)] hover:[&>span]:text-[var(--jarvis-hot)] [&>span]:font-sans [&>span]:text-xs [&>span]:font-bold [&>span]:text-buds-text [&>small]:text-[10px] [&>small]:text-buds-faint',
  modelOptionActive:
    'bg-[rgba(245,158,11,0.1)] [&>span]:text-[var(--jarvis-hot)]',
  action:
    'inline-flex size-10 cursor-pointer items-center justify-center rounded-full border transition-[background,border-color,color,transform,box-shadow] duration-180 active:scale-95 disabled:cursor-not-allowed disabled:opacity-42 max-[760px]:size-11 max-[760px]:min-h-11 max-[760px]:min-w-11',
  microphone:
    'border-[var(--liquid-border)] bg-[var(--liquid-panel-strong)] text-buds-icon hover:-translate-y-px hover:border-[var(--liquid-border-strong)] hover:bg-[rgba(var(--accent-hot-rgb)/0.11)] hover:text-buds-text hover:shadow-[0_10px_34px_rgba(var(--accent-hot-rgb)/0.12)]',
  microphoneRecording:
    '!border-[color-mix(in_srgb,var(--rose)_55%,var(--line))] !bg-[color-mix(in_srgb,var(--rose)_16%,var(--surface))] !text-buds-rose',
  send:
    'border-transparent bg-buds-action text-buds-action-ink shadow-[0_10px_28px_rgba(var(--accent-hot-rgb)/0.2)] hover:-translate-y-px hover:border-transparent hover:bg-buds-action hover:text-buds-action-ink hover:shadow-[0_14px_34px_rgba(var(--accent-hot-rgb)/0.28)] disabled:shadow-none',
  stopping:
    '!border-[rgba(244,63,94,0.52)] !bg-[rgba(244,63,94,0.16)] !text-rose-400',
  meta:
    'mx-auto flex w-full max-w-[980px] justify-between px-0.5 text-[11px] text-buds-muted',
} as const
