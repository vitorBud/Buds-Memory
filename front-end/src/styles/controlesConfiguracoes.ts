export const settingsControlStyles = {
  panelHeading:
    'mb-0.5 flex min-w-0 items-center justify-between gap-2 text-[11px] font-bold uppercase text-buds-faint [&>svg]:text-buds-accent-hot',
  sectionCopy:
    '-mt-[3px] mb-1 max-w-[680px] text-[13px] leading-[1.55] text-buds-muted',

  toggleStack:
    'grid grid-cols-2 gap-3 max-[760px]:grid-cols-1',
  toggleRow:
    'relative grid min-h-[68px] cursor-pointer grid-cols-[minmax(0,1fr)_auto] items-center gap-2.5 rounded-2xl border border-[color-mix(in_srgb,var(--liquid-border),transparent_8%)] px-3.5 py-3 text-[13px] text-buds-muted [background:linear-gradient(135deg,color-mix(in_srgb,var(--liquid-highlight),transparent_16%),transparent_55%),color-mix(in_srgb,var(--surface),transparent_24%)] max-[760px]:min-h-16',
  toggleCopy:
    'grid min-w-0 gap-[3px]',
  toggleLabel:
    'text-[13px] tracking-normal text-buds-text',
  toggleDescription:
    'text-[11px] leading-[1.35] text-buds-muted',
  toggleInput:
    'peer pointer-events-none absolute opacity-0',
  toggleSwitch:
    'relative h-6 w-11 min-w-11 rounded-full border border-[var(--liquid-border)] bg-[var(--liquid-panel-soft)] transition-[background,border-color] duration-160 after:absolute after:top-0.5 after:left-0.5 after:size-4 after:rounded-full after:bg-buds-muted after:content-[\'\'] after:transition-[transform,background] after:duration-160 peer-checked:border-[var(--liquid-border-strong)] peer-checked:bg-[rgba(var(--accent-hot-rgb)/0.18)] peer-checked:after:translate-x-[18px] peer-checked:after:bg-buds-accent-hot platform-windows:transition-none platform-windows:after:transition-none',

  themeGrid:
    'mt-1 grid grid-cols-3 gap-3 max-[760px]:grid-cols-1',
  themeButton:
    'grid min-h-[72px] cursor-pointer grid-cols-[16px_18px_minmax(0,1fr)] items-center gap-x-2.5 gap-y-[3px] rounded-2xl border border-[var(--liquid-border)] px-[13px] py-3 text-left text-buds-muted transition-[background,border-color,color,transform,box-shadow] duration-180 hover:-translate-y-px hover:border-[var(--liquid-border-strong)] hover:bg-[rgba(var(--accent-hot-rgb)/0.11)] hover:text-buds-text hover:shadow-[0_10px_34px_rgba(var(--accent-hot-rgb)/0.12)] platform-windows:transition-none platform-windows:hover:translate-y-0 platform-windows:hover:shadow-none max-[760px]:min-h-16',
  themeButtonActive:
    '-translate-y-px border-[var(--liquid-border-strong)] bg-[rgba(var(--accent-hot-rgb)/0.11)] text-buds-text shadow-[0_10px_34px_rgba(var(--accent-hot-rgb)/0.12)] platform-windows:translate-y-0 platform-windows:shadow-none',
  themeIcon:
    'row-span-2 opacity-55',
  themeDot:
    'row-span-2 size-4 rounded-full border border-white/40 shadow-[inset_0_0_0_1px_rgba(0,0,0,0.08)]',
  themeDotBlack:
    'bg-[#17181d]',
  themeDotGold:
    'bg-[#c8a96b]',
  themeDotSilver:
    'bg-[#cbd0d7]',
  themeLabel:
    'overflow-hidden text-ellipsis whitespace-nowrap text-[13px] text-buds-text',
  themeHint:
    'overflow-hidden text-ellipsis whitespace-nowrap text-[11px] text-buds-muted',

  optionGrid:
    'grid grid-cols-2 gap-2 max-[760px]:grid-cols-1',
  optionButton:
    'flex min-w-0 cursor-pointer items-center gap-2.5 rounded-2xl border border-[var(--liquid-border)] px-3 py-[11px] text-left text-buds-text transition-[border-color,box-shadow,transform] duration-160 [background:linear-gradient(135deg,var(--liquid-highlight),transparent_48%),var(--liquid-panel-soft)] hover:-translate-y-px hover:border-[var(--liquid-border-strong)] platform-windows:transition-none platform-windows:hover:translate-y-0',
  optionButtonActive:
    'border-[color-mix(in_srgb,var(--accent-hot),transparent_18%)] shadow-[0_12px_36px_color-mix(in_srgb,var(--accent-hot),transparent_84%)] platform-windows:shadow-none',
  optionIcon:
    'shrink-0 text-buds-text',
  optionCopy:
    'grid min-w-0 gap-[3px]',
  optionLabel:
    'text-[13px] tracking-normal',
  optionHint:
    'text-[11px] leading-[1.35] text-[var(--muted-strong)]',

  modelGrid:
    'mt-1 grid h-full grid-cols-3 content-stretch gap-3 max-[760px]:grid-cols-1',
  modelButton:
    'grid min-h-[124px] cursor-pointer content-center gap-[7px] rounded-2xl border border-[var(--liquid-border)] p-4 text-left text-buds-text transition-[border-color,box-shadow,transform] duration-160 [background:linear-gradient(135deg,var(--liquid-highlight),transparent_48%),var(--liquid-panel-soft)] hover:-translate-y-px hover:border-[var(--liquid-border-strong)] platform-windows:transition-none platform-windows:hover:translate-y-0',
  modelButtonActive:
    'border-[color-mix(in_srgb,var(--accent-hot),transparent_18%)] shadow-[0_12px_36px_color-mix(in_srgb,var(--accent-hot),transparent_84%)] platform-windows:shadow-none',
  modelLabel:
    'text-[13px] tracking-normal',
  modelRuntime:
    'overflow-hidden text-ellipsis whitespace-nowrap text-xs text-buds-muted',
  modelHint:
    'text-[11px] leading-[1.35] text-[var(--muted-strong)]',

  statusCard:
    'grid grid-cols-[auto_minmax(0,1fr)] items-center gap-2.5 rounded-[18px] border border-[var(--liquid-border)] p-[11px] shadow-[inset_0_1px_0_color-mix(in_srgb,white,transparent_72%)] [background:linear-gradient(135deg,var(--liquid-highlight),transparent_52%),var(--liquid-panel-soft)] platform-windows:shadow-none',
  statusCardCopy:
    'min-w-0',
  statusCardLabel:
    'block min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-[13px] tracking-normal text-buds-text',
  statusCardHint:
    'mt-0.5 block min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-[11px] text-buds-muted',
  statusOrb:
    'grid size-[34px] place-items-center rounded-full border',
  statusOrbOnline:
    'border-[color-mix(in_srgb,#34d399,transparent_44%)] bg-[color-mix(in_srgb,#34d399,transparent_78%)] text-[#34d399] shadow-[0_0_28px_color-mix(in_srgb,#34d399,transparent_78%)] platform-windows:shadow-none',
  statusOrbOffline:
    'border-[color-mix(in_srgb,var(--accent-hot),transparent_58%)] bg-[color-mix(in_srgb,var(--accent-hot),transparent_82%)] text-buds-accent-hot',

  discoveryCard:
    'grid gap-2.5 rounded-[18px] border border-[var(--liquid-border)] p-3.5 [background:linear-gradient(135deg,color-mix(in_srgb,var(--accent-hot),transparent_89%),transparent_62%),var(--liquid-panel-soft)] [&>strong]:text-sm [&>strong]:text-buds-text [&>span]:text-[11px] [&>span]:text-buds-muted',
  discoveryGrid:
    'grid grid-cols-4 gap-2 max-[620px]:grid-cols-2 [&>button]:inline-flex [&>button]:min-h-11 [&>button]:cursor-pointer [&>button]:items-center [&>button]:justify-center [&>button]:gap-1.5 [&>button]:rounded-[13px] [&>button]:border [&>button]:border-[var(--liquid-border)] [&>button]:bg-[var(--liquid-panel)] [&>button]:px-2 [&>button]:text-xs [&>button]:font-bold [&>button]:text-buds-text [&>button]:transition-colors [&>button:hover]:border-[var(--liquid-border-strong)] [&>button:hover]:bg-[rgba(var(--accent-hot-rgb)/0.1)] platform-windows:[&>button]:transition-none',

  codebaseCard:
    'grid gap-[13px] rounded-[18px] border border-[var(--liquid-border)] p-3.5 [background:linear-gradient(135deg,var(--liquid-highlight),transparent_50%),var(--liquid-panel-soft)]',
  codebaseTitle:
    'text-sm font-bold text-buds-text',
  codebaseInputRow:
    'grid grid-cols-[minmax(0,1fr)_auto] gap-[7px]',
  codebaseInput:
    'min-h-11 min-w-0 rounded-[13px] border border-[var(--liquid-border)] bg-[color-mix(in_srgb,var(--surface),transparent_18%)] px-2.5 py-[9px] text-buds-text outline-none transition-[border-color,box-shadow] duration-160 focus:border-[var(--liquid-border-strong)] focus:shadow-[0_0_0_3px_rgba(var(--accent-hot-rgb)/0.1)] platform-windows:transition-none',
  codebaseButton:
    'inline-flex min-h-11 cursor-pointer items-center justify-center gap-[7px] rounded-[13px] border border-[var(--liquid-border)] bg-[var(--liquid-panel)] px-2.5 py-2 text-buds-text transition-[background,border-color] duration-160 hover:border-[var(--liquid-border-strong)] hover:bg-[rgba(var(--accent-hot-rgb)/0.11)] platform-windows:transition-none disabled:cursor-progress disabled:opacity-65',
  codebaseStatus:
    'text-[11px] leading-[1.35] text-buds-muted',

  metricsGrid:
    'grid grid-cols-2 gap-2 max-[760px]:grid-cols-1',
  metric:
    'grid min-w-0 gap-1 rounded-[18px] border border-[var(--liquid-border)] p-2.5 [background:linear-gradient(135deg,color-mix(in_srgb,white,transparent_90%),transparent),color-mix(in_srgb,var(--liquid-panel-soft),transparent_14%)] [&>svg]:text-buds-accent-hot',
  metricLabel:
    'min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-[10px] uppercase text-buds-muted',
  metricValue:
    'min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-xs text-buds-text',
  error:
    'm-0 max-h-[58px] overflow-auto rounded-[14px] border border-[color-mix(in_srgb,#fb7185,transparent_58%)] bg-[color-mix(in_srgb,#fb7185,transparent_88%)] px-2.5 py-[9px] text-[11px] leading-[1.45] text-[color-mix(in_srgb,#fb7185,var(--text)_18%)]',
  primaryButton:
    'inline-flex min-h-11 w-full cursor-pointer items-center justify-center gap-2 rounded-full border border-[color-mix(in_srgb,var(--accent-hot),transparent_40%)] px-3.5 text-xs font-bold tracking-normal text-[var(--accent-ink)] shadow-[0_16px_44px_color-mix(in_srgb,var(--accent-hot),transparent_80%)] transition-[opacity,transform,box-shadow] duration-160 [background:linear-gradient(135deg,color-mix(in_srgb,var(--accent-hot),white_20%),color-mix(in_srgb,var(--accent),black_10%))] hover:-translate-y-px hover:shadow-[0_20px_54px_color-mix(in_srgb,var(--accent-hot),transparent_74%)] platform-windows:shadow-none platform-windows:transition-none platform-windows:hover:translate-y-0 disabled:cursor-not-allowed disabled:opacity-48',
  secondaryButton:
    'mt-2.5 !border-[color-mix(in_srgb,var(--accent-hot),transparent_62%)] !bg-[color-mix(in_srgb,var(--accent-hot),transparent_88%)] !text-buds-accent-hot !shadow-none hover:!shadow-[0_14px_36px_color-mix(in_srgb,var(--accent-hot),transparent_82%)] platform-windows:hover:!shadow-none',
  storageNotice:
    'grid gap-2 rounded-[18px] border border-[color-mix(in_srgb,#fb7185,transparent_55%)] bg-[color-mix(in_srgb,#fb7185,transparent_90%)] p-3.5 text-[12px] leading-[1.5] text-buds-muted [&>strong]:text-[13px] [&>strong]:text-[color-mix(in_srgb,#fb7185,var(--text)_24%)]',
  storageInfoNotice:
    'grid gap-2 rounded-[18px] border border-[color-mix(in_srgb,var(--accent-hot),transparent_62%)] bg-[color-mix(in_srgb,var(--accent-hot),transparent_91%)] p-3.5 text-[12px] leading-[1.5] text-buds-muted [&>strong]:text-[13px] [&>strong]:text-buds-text',
  conversationStorageList:
    'grid gap-2.5 overflow-visible',
  conversationStorageCard:
    'grid gap-3 rounded-[18px] border border-[var(--liquid-border)] p-3.5 [background:linear-gradient(135deg,var(--liquid-highlight),transparent_56%),var(--liquid-panel-soft)]',
  conversationStorageHeader:
    'grid min-w-0 grid-cols-[32px_minmax(0,1fr)_auto] items-center gap-2.5 max-[520px]:grid-cols-[32px_minmax(0,1fr)]',
  conversationStorageIcon:
    'grid size-8 place-items-center rounded-[10px] border border-[var(--liquid-border)] bg-[var(--liquid-panel)] text-buds-accent-hot',
  conversationStorageCopy:
    'grid min-w-0 gap-0.5 [&>strong]:overflow-hidden [&>strong]:text-ellipsis [&>strong]:whitespace-nowrap [&>strong]:text-[13px] [&>strong]:text-buds-text [&>small]:text-[10px] [&>small]:text-buds-muted',
  conversationStorageBadge:
    'rounded-full border border-[var(--liquid-border)] bg-[var(--liquid-panel)] px-2 py-1 text-[9px] font-extrabold uppercase text-buds-muted data-[state=removed]:border-[color-mix(in_srgb,#fb7185,transparent_60%)] data-[state=removed]:text-[color-mix(in_srgb,#fb7185,var(--text)_18%)] data-[state=active]:border-[color-mix(in_srgb,#34d399,transparent_60%)] data-[state=active]:text-[#34d399] max-[520px]:col-start-2 max-[520px]:w-fit',
  conversationStorageStats:
    'flex flex-wrap gap-1.5 [&>span]:rounded-full [&>span]:border [&>span]:border-[var(--liquid-border)] [&>span]:bg-[color-mix(in_srgb,var(--surface),transparent_20%)] [&>span]:px-2 [&>span]:py-1 [&>span]:text-[10px] [&>span]:text-buds-muted',
  conversationDangerButton:
    'inline-flex min-h-10 w-fit cursor-pointer items-center justify-center gap-1.5 justify-self-end rounded-full border border-[color-mix(in_srgb,#fb7185,transparent_56%)] bg-[color-mix(in_srgb,#fb7185,transparent_90%)] px-3 text-[11px] font-bold text-[color-mix(in_srgb,#fb7185,var(--text)_20%)] transition-colors hover:bg-[color-mix(in_srgb,#fb7185,transparent_82%)] disabled:cursor-not-allowed disabled:opacity-45 platform-windows:transition-none max-[520px]:w-full max-[520px]:justify-self-stretch',
  storageEmpty:
    'grid place-items-center gap-1.5 rounded-[18px] border border-dashed border-[var(--liquid-border)] p-6 text-center text-buds-muted [&>svg]:text-buds-faint [&>strong]:text-[13px] [&>strong]:text-buds-text [&>span]:max-w-[360px] [&>span]:text-[11px]',
  storageTotalDivider:
    'relative my-1 flex items-center justify-center before:absolute before:inset-x-0 before:h-px before:bg-[var(--liquid-border)] [&>span]:relative [&>span]:bg-[var(--liquid-panel)] [&>span]:px-3 [&>span]:text-[10px] [&>span]:font-bold [&>span]:uppercase [&>span]:text-buds-faint',
  storageInput:
    'min-h-12 w-full rounded-[14px] border border-[var(--liquid-border)] bg-[color-mix(in_srgb,var(--surface),transparent_10%)] px-3 text-base text-buds-text outline-none transition-[border-color,box-shadow] duration-160 placeholder:text-buds-faint focus:border-[color-mix(in_srgb,#fb7185,transparent_28%)] focus:shadow-[0_0_0_3px_color-mix(in_srgb,#fb7185,transparent_84%)] platform-windows:transition-none',
  dangerButton:
    'inline-flex min-h-12 w-full cursor-pointer items-center justify-center gap-2 rounded-full border border-[color-mix(in_srgb,#fb7185,transparent_38%)] bg-[color-mix(in_srgb,#fb7185,transparent_82%)] px-4 text-xs font-extrabold text-[color-mix(in_srgb,#fb7185,var(--text)_18%)] transition-[background,transform] duration-160 hover:-translate-y-px hover:bg-[color-mix(in_srgb,#fb7185,transparent_74%)] platform-windows:transition-none platform-windows:hover:translate-y-0 disabled:cursor-not-allowed disabled:opacity-45',

  technicalGrid:
    'grid flex-1 grid-cols-2 gap-2 max-[760px]:grid-cols-1',
  technicalLine:
    'grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-2 rounded-[18px] border border-[var(--liquid-border)] bg-[var(--liquid-panel-soft)] p-2',
  technicalLabel:
    'text-[11px] text-buds-faint',
  technicalValue:
    'min-w-0 overflow-hidden text-ellipsis whitespace-nowrap font-mono text-[11px] text-buds-text',
  pipelineLine:
    'grid min-w-0 grid-cols-[auto_42px_minmax(0,1fr)] items-center gap-2 rounded-[18px] border border-[var(--liquid-border)] bg-[var(--liquid-panel-soft)] p-2 [&>svg]:text-buds-cyan',

  memoryPanel:
    'gap-2.5 [&_.rail-panel]:max-h-[360px] [&_.rail-panel]:min-h-0 [&_.rail-panel]:overflow-auto [&_.rail-panel]:rounded-2xl [&_.rail-panel]:border-[color-mix(in_srgb,var(--liquid-border),transparent_18%)] [&_.rail-panel]:bg-[color-mix(in_srgb,var(--surface),transparent_42%)] [&_.memory-stack]:max-h-[142px] [&_.memory-stack]:overflow-auto [&_.rail-list]:max-h-[142px] [&_.rail-list]:overflow-auto max-[760px]:[&_.rail-panel]:max-h-none max-[760px]:[&_.memory-stack]:max-h-none max-[760px]:[&_.rail-list]:max-h-none',
  memoryTabs:
    'grid grid-cols-3 gap-1 rounded-buds border border-[var(--line)] bg-[color-mix(in_srgb,var(--surface)_84%,transparent)] p-[5px]',
  memoryTab:
    'inline-flex min-h-[34px] min-w-0 cursor-pointer items-center justify-center gap-[5px] rounded-md border-0 bg-transparent px-[5px] text-[11px] text-buds-muted transition-[background,color] duration-160 hover:text-buds-cyan platform-windows:transition-none [&>span]:overflow-hidden [&>span]:text-ellipsis [&>span]:whitespace-nowrap',
  memoryTabActive:
    'bg-buds-surface-2 text-buds-text shadow-[inset_0_0_0_1px_var(--line)] platform-windows:shadow-none',
} as const

export const themeDotStyles = {
  black: settingsControlStyles.themeDotBlack,
  gold: settingsControlStyles.themeDotGold,
  silver: settingsControlStyles.themeDotSilver,
} as const
