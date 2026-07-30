/**
 * Receitas Tailwind compartilhadas pelos painéis de contexto do chat.
 *
 * Os nomes semânticos antigos continuam temporariamente no JSX apenas como
 * pontos de ancoragem para contextos especiais (configurações e Obsidian).
 * A aparência base já vive integralmente nestes utilitários.
 */
export const railStyles = {
  panel:
    'flex min-h-0 flex-col gap-3 overflow-auto rounded-aether border border-[var(--line)] p-3 backdrop-blur-[10px] [background:linear-gradient(135deg,color-mix(in_srgb,var(--cyan)_5%,transparent),transparent_34%),var(--surface)]',
  heading:
    'flex min-w-0 items-center justify-between gap-2.5 [&>strong]:overflow-hidden [&>strong]:text-ellipsis [&>strong]:whitespace-nowrap [&>strong]:text-[13px] [&>strong]:text-aether-text',
  eyebrow:
    'text-[11px] tracking-normal text-aether-muted',
  stack: 'grid gap-[7px]',
  list: 'grid gap-2',
  chip:
    'grid min-h-8 items-center gap-2 rounded-aether border border-[var(--line)] px-[9px] text-aether-muted [background:color-mix(in_srgb,var(--surface-2)_88%,transparent)] [&>span]:overflow-hidden [&>span]:text-ellipsis [&>span]:whitespace-nowrap [&>strong]:font-mono [&>strong]:text-[11px] [&>strong]:text-aether-cyan',
  empty:
    'rounded-aether border border-dashed border-[var(--line)] p-2.5 text-xs text-aether-faint [background:color-mix(in_srgb,var(--surface-2)_70%,transparent)]',
  item:
    'grid gap-1 rounded-aether border border-[var(--line)] bg-aether-surface-2 p-[9px] [&>span]:text-[10px] [&>span]:uppercase [&>span]:text-aether-faint [&>p]:m-0 [&>p]:line-clamp-3 [&>p]:text-xs [&>p]:leading-[1.4] [&>p]:text-aether-muted',
  summary:
    'grid gap-1.5 rounded-aether border border-[var(--line)] bg-aether-surface-2 p-2.5 [&>span]:text-[10px] [&>span]:uppercase [&>span]:text-aether-faint [&>p]:m-0 [&>p]:line-clamp-3 [&>p]:text-xs [&>p]:leading-[1.4] [&>p]:text-aether-muted',
  stats:
    'grid grid-cols-2 gap-2 [&>div]:grid [&>div]:min-w-0 [&>div]:gap-1 [&>div]:rounded-aether [&>div]:border [&>div]:border-[var(--line)] [&>div]:bg-aether-surface-2 [&>div]:p-[9px] [&_span]:text-[10px] [&_span]:leading-[1.15] [&_span]:text-aether-faint [&_strong]:font-mono [&_strong]:text-lg [&_strong]:leading-none [&_strong]:text-aether-text',
} as const
