import { focusStyles } from '../../styles/focus'

interface FocusHeaderProps {
  openCount: number
  completedToday: number
  inboxCount: number
}

export function FocusHeader({ openCount, completedToday, inboxCount }: FocusHeaderProps) {
  const hour = new Date().getHours()
  const greeting = hour < 12 ? 'Bom dia' : hour < 18 ? 'Boa tarde' : 'Boa noite'

  return (
    <div className={focusStyles.header}>
      <h1 className={focusStyles.greeting}>
        {greeting}.
      </h1>
      <p className={focusStyles.subtitle}>
        Sua central do dia: compromissos que o Buds percebeu e o que você decidiu priorizar.
      </p>
      <div className="mt-2 flex min-w-0 flex-wrap gap-2" aria-label="Resumo do dia">
        <span className="rounded-full border border-[var(--liquid-border)] bg-[var(--liquid-panel-soft)] px-3 py-1.5 text-[12px] text-[var(--muted)]"><strong className="text-[var(--text)]">{openCount}</strong> em aberto</span>
        <span className="rounded-full border border-[var(--liquid-border)] bg-[var(--liquid-panel-soft)] px-3 py-1.5 text-[12px] text-[var(--muted)]"><strong className="text-[var(--text)]">{completedToday}</strong> concluídas hoje</span>
        <span className="rounded-full border border-[var(--liquid-border)] bg-[var(--liquid-panel-soft)] px-3 py-1.5 text-[12px] text-[var(--muted)]"><strong className="text-[var(--text)]">{inboxCount}</strong> para revisar</span>
      </div>
    </div>
  )
}
