export const mobileAccessStyles = {
  page:
    'relative isolate min-h-screen overflow-x-hidden px-5 pt-[92px] pb-20 text-aether-text [background:radial-gradient(circle_at_18%_10%,rgba(var(--accent-hot-rgb)/0.16),transparent_30%),radial-gradient(circle_at_84%_78%,rgba(var(--accent-rgb)/0.2),transparent_34%),var(--liquid-bg)] before:pointer-events-none before:absolute before:inset-0 before:-z-[1] before:bg-[linear-gradient(90deg,rgba(var(--accent-hot-rgb)/0.035)_1px,transparent_1px),linear-gradient(rgba(var(--accent-hot-rgb)/0.03)_1px,transparent_1px)] before:bg-[length:44px_44px] before:content-[""] max-[760px]:px-3 max-[760px]:pt-[calc(70px+env(safe-area-inset-top))] max-[760px]:pb-[calc(92px+env(safe-area-inset-bottom))]',
  shell:
    'mx-auto grid w-full max-w-[1080px] gap-4',
  hero:
    'relative grid gap-5 overflow-hidden rounded-[30px] border border-[var(--liquid-border-strong)] p-[clamp(22px,4vw,42px)] shadow-[var(--liquid-shadow)] [background:linear-gradient(135deg,var(--liquid-highlight),transparent_52%),var(--liquid-panel)] [backdrop-filter:blur(28px)_saturate(1.4)] platform-windows:shadow-none platform-windows:[backdrop-filter:none] max-[760px]:rounded-[24px] max-[760px]:p-5',
  heroHead:
    'flex items-start justify-between gap-4 max-[680px]:grid',
  eyebrow:
    'mb-2 inline-flex items-center gap-2 text-[11px] font-black tracking-[0.14em] text-aether-accent-hot uppercase',
  title:
    'm-0 max-w-[720px] text-[clamp(34px,5vw,64px)] leading-[0.98] font-black tracking-[-0.035em] text-aether-text',
  description:
    'mt-3 mb-0 max-w-[720px] text-[15px] leading-[1.65] text-aether-muted',
  state:
    'inline-flex min-h-9 shrink-0 items-center gap-2 rounded-full border border-[var(--liquid-border)] bg-[var(--liquid-panel-soft)] px-3 text-xs font-extrabold text-aether-text [&>span]:size-2 [&>span]:rounded-full',
  stateOnline:
    '[&>span]:bg-aether-emerald [&>span]:shadow-[0_0_18px_color-mix(in_srgb,var(--emerald),transparent_34%)]',
  stateOffline:
    '[&>span]:bg-aether-rose',
  accessGrid:
    'grid grid-cols-3 gap-3 max-[980px]:grid-cols-1',
  field:
    'grid min-w-0 gap-2.5 rounded-[20px] border border-[var(--liquid-border)] bg-[color-mix(in_srgb,var(--surface),transparent_32%)] p-4',
  fieldHead:
    'flex items-center justify-between gap-3',
  fieldLabel:
    'inline-flex items-center gap-2 text-[11px] font-black tracking-[0.09em] text-aether-muted uppercase [&>svg]:text-aether-accent-hot',
  code:
    'block min-h-12 break-all rounded-[14px] border border-[var(--liquid-border)] bg-[color-mix(in_srgb,var(--bg),transparent_12%)] px-3 py-3 font-mono text-[13px] leading-[1.45] text-aether-text',
  actionRow:
    'flex flex-wrap gap-2',
  action:
    'inline-flex min-h-9 cursor-pointer items-center justify-center gap-2 rounded-full border border-[var(--liquid-border)] bg-[var(--liquid-panel-soft)] px-3 text-xs font-extrabold text-aether-icon no-underline transition-[background,border-color,color,transform] duration-160 hover:-translate-y-px hover:border-[var(--liquid-border-strong)] hover:bg-[rgba(var(--accent-hot-rgb)/0.11)] hover:text-aether-text platform-windows:transition-none platform-windows:hover:translate-y-0',
  primaryAction:
    '!border-transparent !bg-aether-action !text-aether-action-ink hover:!bg-aether-action hover:!text-aether-action-ink',
  feedback:
    'text-[11px] font-bold text-aether-accent-hot',
  infoGrid:
    'grid grid-cols-[1.15fr_0.85fr] gap-4 max-[820px]:grid-cols-1',
  panel:
    'grid content-start gap-4 rounded-[26px] border border-[var(--liquid-border)] p-[clamp(18px,2.6vw,28px)] shadow-[var(--liquid-shadow-soft)] [background:linear-gradient(135deg,var(--liquid-highlight),transparent_56%),var(--liquid-panel-soft)] platform-windows:shadow-none',
  panelTitle:
    'm-0 flex items-center gap-2.5 text-xl font-black text-aether-text [&>svg]:text-aether-accent-hot',
  panelCopy:
    'm-0 text-[13px] leading-[1.6] text-aether-muted',
  steps:
    'grid gap-2.5',
  step:
    'grid grid-cols-[34px_minmax(0,1fr)] gap-x-3 gap-y-1 rounded-[17px] border border-[var(--liquid-border)] bg-[var(--liquid-panel-soft)] p-3',
  stepNumber:
    'row-span-2 grid size-[34px] place-items-center rounded-xl bg-aether-action font-mono text-xs font-black text-aether-action-ink',
  stepTitle:
    'text-[13px] font-extrabold text-aether-text',
  stepCopy:
    'text-xs leading-[1.45] text-aether-muted',
  securityList:
    'grid gap-2',
  securityItem:
    'grid grid-cols-[22px_minmax(0,1fr)] items-start gap-2.5 text-[13px] leading-[1.5] text-aether-muted [&>svg]:mt-0.5 [&>svg]:text-aether-accent-hot',
  command:
    'rounded-[16px] border border-[var(--liquid-border)] bg-[color-mix(in_srgb,var(--bg),transparent_8%)] p-3 font-mono text-xs leading-[1.7] text-aether-text',
  warning:
    'rounded-[16px] border border-[color-mix(in_srgb,var(--rose),transparent_62%)] bg-[color-mix(in_srgb,var(--rose),transparent_90%)] p-3 text-xs leading-[1.5] text-aether-rose',
} as const
