import { useCallback, useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import {
  ArrowDownLeft,
  ArrowUpRight,
  Bot,
  Check,
  ChevronDown,
  CircleDollarSign,
  CreditCard,
  LoaderCircle,
  PiggyBank,
  Plus,
  ReceiptText,
  Sparkles,
  Trash2,
  WalletCards,
  X,
} from 'lucide-react'
import type { FinanceDashboard, FinanceTransactionInput, FinanceTransactionKind } from '../../types'
import {
  createFinanceTransaction,
  deleteFinanceTransaction,
  getFinanceDashboard,
  updateFinanceTransactionStatus,
} from '../../services/api'

interface FinancePageProps {
  visible: boolean
  onAskBuds: (prompt: string) => void
}

const KIND_OPTIONS: Array<{
  kind: FinanceTransactionKind
  label: string
  icon: typeof CircleDollarSign
  category: string
}> = [
  { kind: 'income', label: 'Receita', icon: ArrowDownLeft, category: 'Renda' },
  { kind: 'expense', label: 'Despesa', icon: ArrowUpRight, category: 'Essencial' },
  { kind: 'investment', label: 'Investimento', icon: PiggyBank, category: 'Investimentos' },
  { kind: 'card', label: 'Cartão', icon: CreditCard, category: 'Cartão' },
]

function localDate() {
  const now = new Date()
  const offset = now.getTimezoneOffset() * 60_000
  return new Date(now.getTime() - offset).toISOString().slice(0, 10)
}

function currentMonth() {
  return localDate().slice(0, 7)
}

function money(cents: number) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(cents / 100)
}

function toCents(value: string) {
  const normalized = value.includes(',')
    ? value.replace(/\./g, '').replace(',', '.')
    : value
  const amount = Number(normalized.replace(/[^\d.-]/g, ''))
  return Number.isFinite(amount) ? Math.round(amount * 100) : 0
}

function monthLabel(month: string) {
  const [year, monthNumber] = month.split('-').map(Number)
  return new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric' })
    .format(new Date(year, monthNumber - 1, 1))
}

export function FinancePage({ visible, onAskBuds }: FinancePageProps) {
  const [month, setMonth] = useState(currentMonth)
  const [dashboard, setDashboard] = useState<FinanceDashboard | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [formOpen, setFormOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [kind, setKind] = useState<FinanceTransactionKind>('expense')
  const [amount, setAmount] = useState('')
  const [description, setDescription] = useState('')
  const [category, setCategory] = useState('Essencial')
  const [occurredOn, setOccurredOn] = useState(localDate)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      setDashboard(await getFinanceDashboard(month))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível abrir suas finanças.')
    } finally {
      setLoading(false)
    }
  }, [month])

  useEffect(() => {
    if (!visible) return
    const timeout = window.setTimeout(() => void load(), 0)
    return () => window.clearTimeout(timeout)
  }, [visible, load])

  const totals = dashboard?.totals
  const committed = (totals?.expense_cents ?? 0) + (totals?.invoice_cents ?? 0) + (totals?.invoice_paid_cents ?? 0)
  const pressure = totals?.income_cents
    ? Math.min(100, Math.round((committed / totals.income_cents) * 100))
    : 0

  const cards = useMemo(() => [
    { label: 'Ganhei', value: totals?.income_cents ?? 0, icon: ArrowDownLeft, tone: 'text-emerald-500' },
    { label: 'Investi', value: totals?.investment_cents ?? 0, icon: PiggyBank, tone: 'text-sky-500' },
    { label: 'Fatura atual', value: totals?.invoice_cents ?? 0, icon: CreditCard, tone: 'text-amber-500' },
    { label: 'Livre agora', value: totals?.available_cents ?? 0, icon: WalletCards, tone: (totals?.available_cents ?? 0) < 0 ? 'text-rose-500' : 'text-[var(--text)]' },
  ], [totals])

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    const amountCents = toCents(amount)
    if (!amountCents || !description.trim()) return
    setSaving(true)
    try {
      const input: FinanceTransactionInput = {
        kind,
        amount_cents: amountCents,
        description: description.trim(),
        category: category.trim() || 'Outros',
        occurred_on: occurredOn,
        ...(kind === 'card' ? { invoice_month: month, status: 'pending' as const } : {}),
      }
      await createFinanceTransaction(input)
      setAmount('')
      setDescription('')
      setFormOpen(false)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível salvar o lançamento.')
    } finally {
      setSaving(false)
    }
  }

  const togglePaid = async (id: number, paid: boolean) => {
    try {
      await updateFinanceTransactionStatus(id, paid ? 'paid' : 'pending')
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível atualizar a fatura.')
    }
  }

  const remove = async (id: number) => {
    if (!window.confirm('Apagar este lançamento?')) return
    try {
      await deleteFinanceTransaction(id)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível apagar o lançamento.')
    }
  }

  if (!visible) return null

  return (
    <section className="h-dvh min-h-0 w-full overflow-y-auto overflow-x-hidden bg-[var(--liquid-bg)] px-3 pb-[calc(var(--mobile-nav-height,72px)+32px+env(safe-area-inset-bottom))] pt-[76px] sm:px-5 lg:px-7 lg:pb-10">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-4">
        <header className="flex items-end justify-between gap-3">
          <div className="min-w-0">
            <span className="mb-1 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.14em] text-[var(--muted)]">
              <CircleDollarSign size={14} /> Assistente financeiro local
            </span>
            <h1 className="text-[clamp(26px,6vw,40px)] font-semibold tracking-[-0.04em] text-[var(--text)]">Seu mês, sem ruído.</h1>
          </div>
          <button
            type="button"
            onClick={() => setFormOpen(open => !open)}
            className="grid size-11 shrink-0 place-items-center rounded-full bg-buds-action text-buds-action-ink shadow-[0_10px_28px_rgba(var(--accent-hot-rgb)/0.2)]"
            aria-label={formOpen ? 'Fechar lançamento' : 'Novo lançamento'}
          >
            {formOpen ? <X size={20} /> : <Plus size={20} />}
          </button>
        </header>

        <div className="flex items-center justify-between rounded-[20px] border border-[var(--liquid-border)] bg-[var(--liquid-panel)] px-4 py-3">
          <div>
            <small className="block text-[10px] font-bold uppercase tracking-[0.12em] text-[var(--muted)]">Período</small>
            <strong className="capitalize text-[15px] text-[var(--text)]">{monthLabel(month)}</strong>
          </div>
          <label className="relative flex items-center gap-2 rounded-xl border border-[var(--liquid-border-strong)] bg-[var(--liquid-panel-soft)] px-3 py-2 text-[12px] font-semibold text-[var(--text)]">
            Alterar
            <ChevronDown size={14} />
            <input
              className="absolute inset-0 cursor-pointer opacity-0"
              type="month"
              value={month}
              onChange={event => setMonth(event.target.value || currentMonth())}
              aria-label="Selecionar mês"
            />
          </label>
        </div>

        {formOpen && (
          <form onSubmit={submit} className="rounded-[24px] border border-[var(--liquid-border-strong)] bg-[var(--liquid-panel-strong)] p-4 shadow-[var(--liquid-shadow)] platform-ios:shadow-none">
            <div className="mb-4 grid grid-cols-4 gap-1.5" role="group" aria-label="Tipo de lançamento">
              {KIND_OPTIONS.map(option => {
                const Icon = option.icon
                const active = kind === option.kind
                return (
                  <button
                    key={option.kind}
                    type="button"
                    onClick={() => {
                      setKind(option.kind)
                      setCategory(option.category)
                    }}
                    className={`flex min-h-14 min-w-0 flex-col items-center justify-center gap-1 rounded-[15px] border px-1 text-[10px] font-bold ${active ? 'border-transparent bg-buds-action text-buds-action-ink' : 'border-[var(--liquid-border)] bg-[var(--liquid-panel-soft)] text-[var(--muted)]'}`}
                  >
                    <Icon size={17} /> {option.label}
                  </button>
                )
              })}
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="grid gap-1 text-[11px] font-bold uppercase tracking-wide text-[var(--muted)]">
                Valor
                <input autoFocus inputMode="decimal" value={amount} onChange={event => setAmount(event.target.value)} placeholder="0,00" className="min-h-12 rounded-[14px] border border-[var(--liquid-border)] bg-[var(--input-bg)] px-3 text-[18px] font-semibold text-[var(--text)] outline-none focus:border-[var(--accent-hot)]" />
              </label>
              <label className="grid gap-1 text-[11px] font-bold uppercase tracking-wide text-[var(--muted)]">
                Descrição
                <input value={description} onChange={event => setDescription(event.target.value)} maxLength={120} placeholder="Ex.: salário, mercado..." className="min-h-12 rounded-[14px] border border-[var(--liquid-border)] bg-[var(--input-bg)] px-3 text-[15px] text-[var(--text)] outline-none focus:border-[var(--accent-hot)]" />
              </label>
              <label className="grid gap-1 text-[11px] font-bold uppercase tracking-wide text-[var(--muted)]">
                Categoria
                <input value={category} onChange={event => setCategory(event.target.value)} maxLength={40} className="min-h-12 rounded-[14px] border border-[var(--liquid-border)] bg-[var(--input-bg)] px-3 text-[15px] text-[var(--text)] outline-none focus:border-[var(--accent-hot)]" />
              </label>
              <label className="grid gap-1 text-[11px] font-bold uppercase tracking-wide text-[var(--muted)]">
                Data
                <input type="date" value={occurredOn} onChange={event => setOccurredOn(event.target.value)} className="min-h-12 rounded-[14px] border border-[var(--liquid-border)] bg-[var(--input-bg)] px-3 text-[15px] text-[var(--text)] outline-none focus:border-[var(--accent-hot)]" />
              </label>
            </div>
            <button disabled={saving || !description.trim() || !toCents(amount)} className="mt-4 flex min-h-12 w-full items-center justify-center gap-2 rounded-[15px] bg-buds-action text-[14px] font-bold text-buds-action-ink disabled:opacity-45">
              {saving ? <LoaderCircle className="animate-spin" size={17} /> : <Check size={17} />}
              Salvar lançamento
            </button>
          </form>
        )}

        {error && (
          <div role="alert" className="flex items-center justify-between gap-3 rounded-[16px] border border-rose-500/25 bg-rose-500/10 px-4 py-3 text-[13px] text-rose-500">
            <span>{error}</span>
            <button type="button" onClick={() => void load()} className="font-bold">Tentar</button>
          </div>
        )}

        <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
          {cards.map(card => {
            const Icon = card.icon
            return (
              <article key={card.label} className="min-w-0 rounded-[20px] border border-[var(--liquid-border)] bg-[var(--liquid-panel)] p-3.5 sm:p-4">
                <div className="mb-4 flex items-center justify-between text-[var(--muted)]">
                  <small className="text-[11px] font-bold">{card.label}</small>
                  <Icon size={16} />
                </div>
                <strong className={`block truncate text-[clamp(18px,5vw,25px)] tracking-[-0.04em] ${card.tone}`} title={money(card.value)}>
                  {loading ? '—' : money(card.value)}
                </strong>
              </article>
            )
          })}
        </div>

        <div className="grid gap-3 lg:grid-cols-[1.4fr_0.8fr]">
          <article className="rounded-[22px] border border-[var(--liquid-border)] bg-[var(--liquid-panel)] p-4">
            <div className="mb-3 flex items-center justify-between">
              <div>
                <small className="text-[10px] font-bold uppercase tracking-[0.12em] text-[var(--muted)]">Comprometimento</small>
                <strong className="mt-0.5 block text-[17px] text-[var(--text)]">{pressure}% da receita</strong>
              </div>
              <span className="text-[12px] font-semibold text-[var(--muted)]">{money(committed)}</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-[var(--liquid-panel-soft)]">
              <div className={`h-full rounded-full transition-[width] ${pressure > 80 ? 'bg-rose-500' : pressure > 55 ? 'bg-amber-500' : 'bg-emerald-500'}`} style={{ width: `${pressure}%` }} />
            </div>
            <p className="mt-3 text-[12px] leading-relaxed text-[var(--muted)]">Despesas e fatura do mês. Investimentos ficam separados porque são construção de patrimônio.</p>
          </article>

          <article className="rounded-[22px] border border-[var(--liquid-border-strong)] bg-[var(--liquid-panel-strong)] p-4">
            <div className="flex items-center gap-2 text-[var(--text)]"><Bot size={17} /><strong className="text-[14px]">Buds entende estes números</strong></div>
            <p className="mt-2 text-[12px] leading-relaxed text-[var(--muted)]">Os totais entram no mesmo contexto local da sua memória. A IA explica; o código calcula.</p>
            <button type="button" onClick={() => onAskBuds(`Analise minhas finanças de ${month} usando o resumo financeiro local. Seja objetivo, destaque riscos e sugira três ações práticas sem inventar valores.`)} className="mt-3 flex min-h-10 w-full items-center justify-center gap-2 rounded-[13px] border border-[var(--liquid-border-strong)] bg-[var(--liquid-panel-soft)] text-[12px] font-bold text-[var(--text)]">
              <Sparkles size={15} /> Analisar com o Buds
            </button>
          </article>
        </div>

        <article className="overflow-hidden rounded-[22px] border border-[var(--liquid-border)] bg-[var(--liquid-panel)]">
          <div className="flex items-center justify-between border-b border-[var(--liquid-border)] px-4 py-3.5">
            <div className="flex items-center gap-2 text-[var(--text)]"><ReceiptText size={17} /><strong className="text-[14px]">Lançamentos</strong></div>
            <small className="text-[11px] text-[var(--muted)]">{dashboard?.transactions.length ?? 0} no período</small>
          </div>
          {loading ? (
            <div className="grid min-h-28 place-items-center text-[var(--muted)]"><LoaderCircle className="animate-spin" size={20} /></div>
          ) : !dashboard?.transactions.length ? (
            <div className="px-5 py-10 text-center">
              <WalletCards className="mx-auto mb-3 text-[var(--muted)]" size={25} />
              <strong className="block text-[14px] text-[var(--text)]">Seu mês começa aqui</strong>
              <span className="mt-1 block text-[12px] text-[var(--muted)]">Adicione receita, investimento, despesa ou compra no cartão.</span>
            </div>
          ) : (
            <div className="divide-y divide-[var(--liquid-border)]">
              {dashboard.transactions.map(item => {
                const meta = KIND_OPTIONS.find(option => option.kind === item.kind) ?? KIND_OPTIONS[1]
                const Icon = meta.icon
                return (
                  <div key={item.id} className="flex min-w-0 items-center gap-3 px-4 py-3">
                    <span className="grid size-9 shrink-0 place-items-center rounded-[12px] bg-[var(--liquid-panel-soft)] text-[var(--muted)]"><Icon size={16} /></span>
                    <div className="min-w-0 flex-1">
                      <strong className="block truncate text-[13px] text-[var(--text)]">{item.description}</strong>
                      <span className="block truncate text-[10px] text-[var(--muted)]">{item.category} · {new Date(`${item.occurred_on}T12:00:00`).toLocaleDateString('pt-BR')}</span>
                    </div>
                    <div className="shrink-0 text-right">
                      <strong className={`block text-[13px] ${item.kind === 'income' ? 'text-emerald-500' : 'text-[var(--text)]'}`}>{item.kind === 'income' ? '+' : '−'} {money(item.amount_cents)}</strong>
                      {item.kind === 'card' && (
                        <button type="button" onClick={() => void togglePaid(item.id, item.status !== 'paid')} className={`mt-0.5 text-[10px] font-bold ${item.status === 'paid' ? 'text-emerald-500' : 'text-amber-500'}`}>
                          {item.status === 'paid' ? 'Pago · reabrir' : 'Em aberto · pagar'}
                        </button>
                      )}
                    </div>
                    <button type="button" onClick={() => void remove(item.id)} className="grid size-8 shrink-0 place-items-center rounded-full text-[var(--muted)] hover:bg-rose-500/10 hover:text-rose-500" aria-label={`Apagar ${item.description}`}><Trash2 size={14} /></button>
                  </div>
                )
              })}
            </div>
          )}
        </article>
      </div>
    </section>
  )
}
