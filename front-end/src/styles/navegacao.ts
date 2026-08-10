export const navigationStyles = {
  experience:
    'min-h-screen bg-[var(--liquid-bg)] max-[760px]:min-h-dvh max-[760px]:w-full max-[760px]:overflow-x-clip supports-[-webkit-touch-callout:none]:max-[760px]:min-h-[-webkit-fill-available]',
  nav:
    'z-40 inline-flex items-center gap-1 rounded-full border border-[var(--liquid-border)] p-[5px] shadow-[var(--liquid-shadow)] [background:linear-gradient(135deg,var(--liquid-highlight),transparent_44%),var(--liquid-panel-strong)] [backdrop-filter:blur(28px)_saturate(1.45)] theme-light:border-[rgb(var(--accent-rgb)/0.22)] theme-light:bg-[rgba(255,255,255,0.9)] theme-light:text-slate-900 theme-light:[background:linear-gradient(135deg,rgb(var(--accent-rgb)/0.07),transparent_48%),rgba(255,255,255,0.9)] platform-windows:shadow-none platform-windows:[backdrop-filter:none] max-[760px]:rounded-[24px] max-[760px]:border-[var(--liquid-border-strong)] max-[760px]:shadow-[0_18px_48px_rgba(0,0,0,0.24),inset_0_1px_0_rgba(255,255,255,0.16)] max-[760px]:[background:linear-gradient(135deg,var(--liquid-highlight),transparent_46%),color-mix(in_srgb,var(--liquid-panel-strong)_94%,var(--bg)_6%)]',
  floating:
    'fixed top-3.5 left-1/2 z-[7000] w-max -translate-x-1/2 max-[900px]:top-2 max-[900px]:mt-2.5 max-[760px]:!top-auto max-[760px]:!right-3 max-[760px]:!bottom-[calc(14px+env(safe-area-inset-bottom))] max-[760px]:!left-3 max-[760px]:z-[7000] max-[760px]:!mx-auto max-[760px]:!grid max-[760px]:!min-h-[58px] max-[760px]:!w-auto max-[760px]:!max-w-[430px] max-[760px]:!translate-x-0 max-[760px]:!grid-cols-5 max-[760px]:!p-1',
  button:
    'inline-flex min-h-[34px] cursor-pointer items-center justify-center gap-1.5 whitespace-nowrap rounded-full border border-transparent bg-transparent px-[13px] text-xs text-buds-icon transition-[background,border-color,color,transform,box-shadow] duration-180 hover:-translate-y-px hover:border-[var(--liquid-border-strong)] hover:bg-[rgba(var(--accent-hot-rgb)/0.11)] hover:text-buds-text hover:shadow-[0_10px_34px_rgba(var(--accent-hot-rgb)/0.12)] platform-windows:transition-none max-[760px]:relative max-[760px]:z-[1] max-[760px]:!min-h-[48px] max-[760px]:min-w-0 max-[760px]:flex-col max-[760px]:gap-[2px] max-[760px]:rounded-[19px] max-[760px]:!p-0 max-[760px]:text-[9px] max-[760px]:font-bold max-[760px]:leading-none max-[760px]:[&>svg]:relative max-[760px]:[&>svg]:z-[2] max-[760px]:[&>svg]:size-[18px] max-[760px]:[&>span]:relative max-[760px]:[&>span]:z-[2] max-[760px]:[&>span]:block',
  active:
    '-translate-y-px border-transparent !bg-buds-action !text-buds-action-ink shadow-[0_10px_30px_rgba(var(--accent-hot-rgb)/0.2)] hover:!bg-buds-action hover:!text-buds-action-ink max-[760px]:translate-y-0 max-[760px]:!bg-transparent max-[760px]:!shadow-none max-[760px]:hover:!bg-transparent',
  mobileIndicator:
    'pointer-events-none absolute inset-0 z-0 hidden rounded-[19px] bg-buds-action shadow-[0_9px_24px_rgba(var(--accent-hot-rgb)/0.22),inset_0_1px_0_rgba(255,255,255,0.22)] max-[760px]:block',
  desktopOnly:
    'max-[760px]:hidden',
  mobileOnly:
    '!hidden max-[760px]:!inline-flex',
  mobileMoreBackdrop:
    'fixed inset-0 z-[6990] hidden cursor-default border-0 bg-black/20 p-0 [backdrop-filter:blur(2px)] max-[760px]:block platform-ios:[backdrop-filter:none]',
  mobileMoreMenu:
    'fixed right-3 bottom-[calc(82px+env(safe-area-inset-bottom))] left-3 z-[7010] mx-auto hidden w-auto max-w-[430px] grid-cols-3 gap-2 rounded-[22px] border border-[var(--liquid-border-strong)] p-2 shadow-[0_24px_70px_rgba(0,0,0,0.34),inset_0_1px_0_rgba(255,255,255,0.15)] [background:linear-gradient(135deg,var(--liquid-highlight),transparent_44%),color-mix(in_srgb,var(--liquid-panel-strong)_96%,var(--bg)_4%)] [backdrop-filter:blur(30px)_saturate(1.45)] max-[760px]:grid platform-ios:[backdrop-filter:none]',
  mobileMoreItem:
    'grid min-h-[68px] min-w-0 place-items-center content-center gap-1 rounded-[16px] border border-transparent px-2 text-center text-[10px] font-bold text-buds-muted transition-colors hover:border-[var(--liquid-border)] hover:bg-[var(--liquid-panel-soft)] hover:text-buds-text [&>svg]:size-[19px]',
  mobileMoreItemActive:
    'border-[var(--liquid-border-strong)] bg-[var(--liquid-panel)] text-buds-text shadow-[inset_0_1px_0_rgba(255,255,255,0.12)]',
} as const
