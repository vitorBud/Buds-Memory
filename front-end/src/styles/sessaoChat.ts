export const chatSessionStyles = {
  bar:
    'flex min-h-[52px] flex-none items-center justify-between gap-3 border-b border-[var(--liquid-border)] px-1 pt-1.5 pb-2.5 text-aether-text [background:linear-gradient(135deg,var(--liquid-highlight),transparent_42%),var(--liquid-panel)] max-[760px]:min-h-[46px] max-[760px]:px-3 max-[760px]:py-1.5 max-[560px]:flex-col max-[560px]:items-start max-[560px]:gap-2',
  title:
    'grid min-w-0 gap-0.5 [&>input]:h-[30px] [&>input]:w-[min(360px,52vw)] [&>input]:min-w-0 [&>input]:rounded-md [&>input]:border [&>input]:border-[var(--line-strong)] [&>input]:bg-aether-surface-2 [&>input]:px-[9px] [&>input]:text-[14px] [&>input]:font-bold [&>input]:text-aether-text [&>input]:outline-0 [&>strong]:min-w-0 [&>strong]:overflow-hidden [&>strong]:text-ellipsis [&>strong]:whitespace-nowrap [&>strong]:text-[15px] [&>strong]:font-bold [&>strong]:text-aether-text [&>strong]:[text-shadow:0_0_28px_rgba(var(--accent-hot-rgb)/0.14)] [&>span]:text-[11px] [&>span]:text-aether-muted max-[760px]:[&>input]:max-w-[calc(100vw-126px)] max-[760px]:[&>input]:overflow-hidden max-[760px]:[&>input]:text-ellipsis max-[760px]:[&>input]:whitespace-nowrap max-[760px]:[&>strong]:max-w-[calc(100vw-126px)] max-[560px]:[&>input]:w-full',
  actions:
    'flex flex-none items-center gap-1.5 max-[560px]:w-full max-[560px]:justify-end',
  action:
    'inline-flex size-[30px] cursor-pointer items-center justify-center rounded-full border border-[var(--liquid-border)] bg-[var(--liquid-panel)] text-aether-text transition-[background,border-color,color,transform,box-shadow] duration-180 hover:-translate-y-px hover:border-[var(--liquid-border-strong)] hover:bg-[rgba(var(--accent-hot-rgb)/0.11)] hover:text-aether-text hover:shadow-[0_10px_34px_rgba(var(--accent-hot-rgb)/0.12)] disabled:cursor-not-allowed disabled:opacity-42',
  destructiveAction:
    'hover:!border-[color-mix(in_srgb,var(--rose)_50%,var(--line))] hover:!text-aether-rose',
} as const
