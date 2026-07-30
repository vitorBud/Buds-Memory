export const settingsLayoutStyles = {
  shell:
    'fixed inset-0 z-[6200] overflow-y-auto [padding:max(24px,env(safe-area-inset-top))_clamp(16px,3vw,38px)_calc(96px+env(safe-area-inset-bottom))] [background:radial-gradient(circle_at_18%_12%,color-mix(in_srgb,var(--accent-hot),transparent_86%),transparent_34%),radial-gradient(circle_at_82%_4%,color-mix(in_srgb,var(--accent),transparent_88%),transparent_30%),color-mix(in_srgb,var(--bg),black_2%)] platform-windows:[&_*]:![backdrop-filter:none] platform-windows:[&_*]:![transition-duration:0ms] platform-windows:[&_*]:!shadow-none max-[760px]:[padding:max(12px,env(safe-area-inset-top))_10px_calc(96px+env(safe-area-inset-bottom))]',
  pagePanel:
    'static inset-auto mx-auto grid h-auto max-h-none w-full max-w-[1280px] grid-cols-[minmax(230px,280px)_minmax(0,1fr)] items-start gap-4 overflow-visible border-0 bg-transparent p-0 shadow-none [backdrop-filter:none] transform-none platform-windows:animate-none max-[860px]:grid-cols-1 max-[760px]:pb-[calc(92px+env(safe-area-inset-bottom))]',
  header:
    'sticky top-[max(12px,env(safe-area-inset-top))] z-[4] col-span-full row-start-1 flex min-h-[78px] items-center justify-between rounded-[22px] border border-[var(--liquid-border)] px-[18px] py-4 shadow-[0_24px_70px_color-mix(in_srgb,var(--shadow),transparent_70%)] [background:linear-gradient(135deg,color-mix(in_srgb,var(--liquid-highlight),transparent_8%),transparent_62%),color-mix(in_srgb,var(--liquid-panel),transparent_8%)] [backdrop-filter:blur(28px)_saturate(155%)] platform-windows:shadow-none platform-windows:[backdrop-filter:none]',
  headerCopy:
    'grid gap-0.5',
  eyebrow:
    'text-[11px] tracking-normal text-aether-muted',
  title:
    'text-[clamp(22px,3vw,34px)] tracking-normal',
  close:
    'grid size-[42px] min-h-[42px] cursor-pointer place-items-center rounded-full border border-[var(--liquid-border)] bg-[var(--liquid-panel-soft)] text-aether-muted transition-[background,border-color,color,transform] duration-160 hover:-translate-y-px hover:border-[color-mix(in_srgb,var(--liquid-border),var(--accent)_36%)] hover:bg-[color-mix(in_srgb,var(--liquid-panel),var(--accent)_10%)] hover:text-aether-text platform-windows:transition-none platform-windows:hover:translate-y-0',
  nav:
    'sticky top-[calc(106px+env(safe-area-inset-top))] col-start-1 row-start-2 grid gap-[9px] rounded-[22px] border border-[var(--liquid-border)] p-2.5 shadow-[0_22px_64px_color-mix(in_srgb,var(--shadow),transparent_82%)] [background:linear-gradient(135deg,var(--liquid-highlight),transparent_56%),color-mix(in_srgb,var(--liquid-panel-soft),transparent_5%)] [backdrop-filter:blur(28px)_saturate(150%)] platform-windows:shadow-none platform-windows:[backdrop-filter:none] max-[860px]:static max-[860px]:col-start-1 max-[860px]:row-start-2 max-[860px]:flex max-[860px]:gap-2 max-[860px]:overflow-x-auto max-[860px]:[scroll-snap-type:x_mandatory]',
  navButton:
    'group grid min-h-16 cursor-pointer grid-cols-[34px_minmax(0,1fr)] items-center gap-2.5 rounded-[15px] border border-transparent bg-transparent px-2.5 py-2 text-left text-aether-muted transition-[background,border-color,color,transform] duration-160 hover:-translate-y-px hover:border-[color-mix(in_srgb,var(--liquid-border),var(--accent)_36%)] hover:bg-[color-mix(in_srgb,var(--liquid-panel),var(--accent)_10%)] hover:text-aether-text platform-windows:transition-none platform-windows:hover:translate-y-0 max-[860px]:min-w-[178px] max-[860px]:grid-cols-[28px_minmax(112px,1fr)] max-[860px]:[scroll-snap-align:start]',
  navButtonActive:
    '-translate-y-px border-[color-mix(in_srgb,var(--liquid-border),var(--accent)_36%)] bg-[color-mix(in_srgb,var(--liquid-panel),var(--accent)_10%)] text-aether-text platform-windows:translate-y-0',
  navIcon:
    'size-[34px] rounded-[11px] border border-[var(--liquid-border)] bg-[color-mix(in_srgb,var(--surface),transparent_12%)] p-2 text-aether-icon group-hover:border-[var(--liquid-border-strong)] group-hover:text-aether-text max-[860px]:size-7 max-[860px]:p-1.5',
  navIconActive:
    'border-transparent !bg-aether-action !text-aether-action-ink group-hover:!bg-aether-action group-hover:!text-aether-action-ink',
  navCopy:
    'grid min-w-0 gap-0.5',
  navLabel:
    'text-[13px] text-aether-text',
  navHint:
    'text-[11px] leading-[1.2] text-aether-muted',
  content:
    'col-start-2 row-start-2 grid min-w-0 w-full max-w-[920px] content-start gap-4 [&>.settings-section]:hidden [&>.settings-section]:flex-col [&>.settings-section]:gap-[18px] [&>.settings-section]:overflow-hidden [&>.settings-section]:rounded-[22px] [&>.settings-section]:border [&>.settings-section]:border-[var(--liquid-border)] [&>.settings-section]:p-[clamp(18px,2.3vw,26px)] [&>.settings-section]:[background:linear-gradient(135deg,var(--liquid-highlight),transparent_52%),color-mix(in_srgb,var(--liquid-panel-soft),transparent_4%)] [&>.settings-section]:shadow-[0_22px_64px_color-mix(in_srgb,var(--shadow),transparent_78%)] [&>.settings-section]:m-0 [&>.settings-section]:min-h-[520px] [&>.settings-section]:w-full [&>.settings-section]:max-w-none max-[860px]:col-start-1 max-[860px]:row-start-3 max-[860px]:max-w-none max-[860px]:[&>.settings-section]:min-h-0',
} as const

export const settingsSectionStyles = {
  account: '[&>.settings-account-block]:!flex',
  appearance: '[&>.settings-interface-block]:!flex',
  ai: '[&>.settings-model-block]:!flex',
  backup: '[&>.settings-backup-block]:!flex',
  codebase: '[&>.settings-codebase-block]:!flex',
  memory: '[&>.settings-insights-block]:!flex [&>.settings-insights-block]:!max-w-none',
  system:
    '[&>.settings-session-block]:!flex [&>.settings-session-block]:!min-h-[196px] [&>.settings-pipeline-block]:!flex [&>.settings-pipeline-block]:!min-h-[292px] max-[860px]:[&>.settings-session-block]:!min-h-0 max-[860px]:[&>.settings-pipeline-block]:!min-h-0',
} as const
