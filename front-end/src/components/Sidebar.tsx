import { useMemo, useState } from 'react'
import {
  Bot, Briefcase, ChartNoAxesCombined, Check, Clock3, Code2, Dumbbell,
  Folder, FolderInput, FolderPlus, GraduationCap, Heart, House, Inbox,
  Lightbulb, MessageSquare, MoreHorizontal, Palette, Plus, Search, Trash2,
  WalletCards, X,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { AiState, ChatFolder, Session } from '../types'
import { formatSessionDate, truncate } from '../utils/formatters'
import { SystemStatus } from './SystemStatus'
import type { SystemHealth } from './BootScreen'
import { sidebarStyles, sidebarToneStyles } from '../styles/barraLateral'

export type ChatFolderFilter = 'all' | 'unfiled' | string

interface SidebarProps {
  isClosing?: boolean
  sessions: Session[]
  folders: ChatFolder[]
  activeFolderId: ChatFolderFilter
  currentSessionId: string | null
  searchQuery: string
  onSearchChange: (value: string) => void
  onFolderFilterChange: (folderId: ChatFolderFilter) => void
  onNewChat: () => void
  onSelect: (s: Session) => void
  onDelete: (id: string) => void
  onCreateFolder: (input: Pick<ChatFolder, 'name' | 'icon' | 'color'>) => Promise<ChatFolder>
  onUpdateFolder: (id: string, updates: Partial<Pick<ChatFolder, 'name' | 'icon' | 'color'>>) => Promise<void>
  onDeleteFolder: (id: string) => Promise<boolean>
  onMoveSession: (sessionId: string, folderId: string | null) => Promise<void>
  systemUptime: string
  aiState: AiState
  systemHealth?: SystemHealth | null
  selectedModel?: string
}

const STATE_MAP: Record<AiState, { label: string; tone: string }> = {
  idle: { label: 'Aguardando', tone: 'muted' },
  listening: { label: 'Ouvindo', tone: 'cyan' },
  transcribing: { label: 'Transcrevendo', tone: 'amber' },
  thinking: { label: 'Pensando', tone: 'violet' },
  speaking: { label: 'Falando', tone: 'emerald' },
  error: { label: 'Erro', tone: 'rose' },
}

const FOLDER_COLORS = ['#8b5cf6', '#2563eb', '#06b6d4', '#10b981', '#f59e0b', '#f97316', '#ef4444', '#ec4899']

const FOLDER_ICONS: Record<string, LucideIcon> = {
  folder: Folder,
  briefcase: Briefcase,
  'graduation-cap': GraduationCap,
  'chart-no-axes-combined': ChartNoAxesCombined,
  'wallet-cards': WalletCards,
  heart: Heart,
  house: House,
  lightbulb: Lightbulb,
  'code-2': Code2,
  dumbbell: Dumbbell,
}

function suggestedIcon(name: string) {
  const value = name.toLocaleLowerCase('pt-BR')
  if (/trabalho|empresa|cliente|negócio|negocio/.test(value)) return 'briefcase'
  if (/estudo|escola|faculdade|curso|prova/.test(value)) return 'graduation-cap'
  if (/invest|ação|acao|bolsa|mercado/.test(value)) return 'chart-no-axes-combined'
  if (/finan|dinheiro|orçamento|orcamento/.test(value)) return 'wallet-cards'
  if (/código|codigo|program|dev/.test(value)) return 'code-2'
  if (/academia|treino|saúde|saude/.test(value)) return 'dumbbell'
  if (/casa|lar|família|familia/.test(value)) return 'house'
  if (/ideia|projeto/.test(value)) return 'lightbulb'
  if (/pessoal|vida/.test(value)) return 'heart'
  return 'folder'
}

function FolderGlyph({ icon, color, size = 15 }: { icon: string; color: string; size?: number }) {
  const Icon = FOLDER_ICONS[icon] ?? Folder
  return (
    <span className="grid size-7 shrink-0 place-items-center rounded-[9px]" style={{ color, backgroundColor: `${color}1f` }}>
      <Icon size={size} />
    </span>
  )
}

export function Sidebar({
  isClosing = false, sessions, folders, activeFolderId, currentSessionId,
  searchQuery, onSearchChange, onFolderFilterChange, onNewChat, onSelect,
  onDelete, onCreateFolder, onUpdateFolder, onDeleteFolder, onMoveSession,
  systemUptime, aiState, systemHealth = null, selectedModel,
}: SidebarProps) {
  const stateInfo = STATE_MAP[aiState]
  const [folderComposerOpen, setFolderComposerOpen] = useState(false)
  const [folderName, setFolderName] = useState('')
  const [folderColor, setFolderColor] = useState(FOLDER_COLORS[0])
  const [editingFolderId, setEditingFolderId] = useState<string | null>(null)
  const [sessionMenuId, setSessionMenuId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const normalizedSearch = searchQuery.trim().toLocaleLowerCase('pt-BR')
  const visibleSessions = useMemo(() => sessions.filter(session => {
    if (normalizedSearch) return session.title.toLocaleLowerCase('pt-BR').includes(normalizedSearch)
    if (activeFolderId === 'all') return true
    if (activeFolderId === 'unfiled') return !session.folder_id
    return session.folder_id === activeFolderId
  }), [activeFolderId, normalizedSearch, sessions])

  const activeFolder = folders.find(folder => folder.id === activeFolderId)

  async function submitFolder() {
    const name = folderName.trim()
    if (!name || busy) return
    setBusy(true)
    try {
      if (editingFolderId) {
        await onUpdateFolder(editingFolderId, { name, color: folderColor, icon: suggestedIcon(name) })
      } else {
        const created = await onCreateFolder({ name, color: folderColor, icon: suggestedIcon(name) })
        onFolderFilterChange(created.id)
      }
      setFolderName('')
      setEditingFolderId(null)
      setFolderComposerOpen(false)
    } catch {
      // O componente pai já mostra a causa; o formulário permanece aberto.
    } finally {
      setBusy(false)
    }
  }

  async function removeEditingFolder() {
    if (!editingFolderId || busy) return
    setBusy(true)
    try {
      const removed = await onDeleteFolder(editingFolderId)
      if (removed) {
        setFolderComposerOpen(false)
        setEditingFolderId(null)
        setFolderName('')
      }
    } finally {
      setBusy(false)
    }
  }

  async function moveSession(sessionId: string, folderId: string | null) {
    try {
      await onMoveSession(sessionId, folderId)
      setSessionMenuId(null)
    } catch {
      // Mantém o menu aberto para o usuário tentar novamente.
    }
  }

  function editFolder(folder: ChatFolder) {
    setFolderName(folder.name)
    setFolderColor(folder.color)
    setEditingFolderId(folder.id)
    setFolderComposerOpen(true)
  }

  return (
    <aside className={`sidebar ${isClosing ? 'is-closing' : ''} ${sidebarStyles.root}`}>
      <div className={`sidebar-head ${sidebarStyles.head}`}>
        <div className={`sidebar-mobile-brand ${sidebarStyles.mobileBrand}`}>
          <div className={`nexus-glyph ${sidebarStyles.glyph}`}><Bot size={18} /></div>
          <div className={sidebarStyles.mobileBrandCopy}><strong>Buds Memory</strong><span>Conversas organizadas</span></div>
        </div>
        <button className={`new-chat-button ${sidebarStyles.newChat}`} type="button" onClick={onNewChat}>
          <Plus size={15} /><span>{activeFolder ? `Novo em ${activeFolder.name}` : 'Novo chat'}</span>
        </button>
        <label className={`sidebar-search ${sidebarStyles.search}`}>
          <Search size={13} />
          <input value={searchQuery} onChange={event => onSearchChange(event.target.value)} placeholder="Buscar em todos os chats" className={sidebarStyles.searchInput} />
        </label>
      </div>

      <div className="grid min-h-0 flex-1 grid-rows-[auto_minmax(0,1fr)] overflow-hidden">
        <section className="grid gap-1.5 border-b border-[var(--liquid-border)] px-3 py-3">
          <div className="flex items-center justify-between px-1 text-[10px] font-extrabold uppercase tracking-[0.08em] text-buds-muted">
            <span>Pastas</span>
            <button type="button" onClick={() => { setEditingFolderId(null); setFolderName(''); setFolderComposerOpen(value => !value) }} className="grid size-7 place-items-center rounded-lg text-buds-muted hover:bg-[var(--liquid-panel-soft)] hover:text-buds-text" aria-label="Criar pasta"><FolderPlus size={15} /></button>
          </div>

          <div className="flex gap-1.5 overflow-x-auto pb-0.5 max-[760px]:[-webkit-overflow-scrolling:touch] min-[901px]:grid min-[901px]:overflow-visible">
            <button type="button" onClick={() => onFolderFilterChange('all')} className={`flex min-h-9 min-w-max items-center gap-2 rounded-xl px-2.5 text-left text-xs font-bold transition-colors ${activeFolderId === 'all' ? 'bg-[var(--liquid-panel-strong)] text-buds-text' : 'text-buds-muted hover:bg-[var(--liquid-panel-soft)] hover:text-buds-text'}`}>
              <MessageSquare size={14} /> Todos <small className="opacity-60">{sessions.length}</small>
            </button>
            {folders.map(folder => {
              const count = sessions.filter(session => session.folder_id === folder.id).length
              return (
                <div key={folder.id} className={`group/folder flex min-w-max items-center rounded-xl pr-1 ${activeFolderId === folder.id ? 'bg-[var(--liquid-panel-strong)]' : 'hover:bg-[var(--liquid-panel-soft)]'}`}>
                  <button type="button" onClick={() => onFolderFilterChange(folder.id)} className={`flex min-h-9 items-center gap-2 px-2 text-left text-xs font-bold ${activeFolderId === folder.id ? 'text-buds-text' : 'text-buds-muted'}`}>
                    <FolderGlyph icon={folder.icon} color={folder.color} /><span className="max-w-28 truncate">{folder.name}</span><small className="opacity-60">{count}</small>
                  </button>
                  <button type="button" onClick={() => editFolder(folder)} className="grid size-7 place-items-center rounded-lg text-buds-faint opacity-60 hover:text-buds-text group-hover/folder:opacity-100" aria-label={`Editar pasta ${folder.name}`}><MoreHorizontal size={14} /></button>
                </div>
              )
            })}
            <button type="button" onClick={() => onFolderFilterChange('unfiled')} className={`flex min-h-9 min-w-max items-center gap-2 rounded-xl px-2.5 text-left text-xs font-bold ${activeFolderId === 'unfiled' ? 'bg-[var(--liquid-panel-strong)] text-buds-text' : 'text-buds-muted hover:bg-[var(--liquid-panel-soft)] hover:text-buds-text'}`}>
              <Inbox size={14} /> Sem pasta <small className="opacity-60">{sessions.filter(session => !session.folder_id).length}</small>
            </button>
          </div>

          {folderComposerOpen && (
            <div className="grid gap-2 rounded-[16px] border border-[var(--liquid-border)] bg-[var(--liquid-panel-soft)] p-2.5">
              <div className="flex items-center gap-2">
                <FolderGlyph icon={suggestedIcon(folderName)} color={folderColor} />
                <input autoFocus value={folderName} onChange={event => setFolderName(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') void submitFolder() }} placeholder="Ex.: Trabalho" className="min-h-9 min-w-0 flex-1 rounded-xl border border-[var(--liquid-border)] bg-[var(--surface)] px-3 text-sm text-buds-text outline-none focus:border-[var(--accent-hot)]" />
                <button type="button" onClick={() => setFolderComposerOpen(false)} className="grid size-8 place-items-center rounded-lg text-buds-muted"><X size={14} /></button>
              </div>
              <div className="flex items-center gap-1.5" aria-label="Cor da pasta">
                <Palette size={13} className="mr-1 text-buds-muted" />
                {FOLDER_COLORS.map(color => <button key={color} type="button" onClick={() => setFolderColor(color)} className="grid size-7 place-items-center rounded-full border" style={{ backgroundColor: color, borderColor: folderColor === color ? 'white' : 'transparent' }} aria-label={`Usar cor ${color}`}>{folderColor === color && <Check size={13} color="white" />}</button>)}
              </div>
              <div className="flex gap-2">
                {editingFolderId && <button type="button" disabled={busy} onClick={() => void removeEditingFolder()} className="min-h-9 rounded-xl px-3 text-xs font-bold text-rose-300 hover:bg-rose-500/10 disabled:opacity-40"><Trash2 size={13} className="inline" /> Apagar</button>}
                <button type="button" disabled={!folderName.trim() || busy} onClick={() => void submitFolder()} className="ml-auto min-h-9 rounded-xl bg-buds-action px-4 text-xs font-extrabold text-buds-action-ink disabled:opacity-40">{busy ? 'Salvando…' : editingFolderId ? 'Salvar pasta' : 'Criar pasta'}</button>
              </div>
            </div>
          )}
        </section>

        <div className={`sidebar-section ${sidebarStyles.section}`}>
          <div className={`section-title ${sidebarStyles.title}`}><span className="flex items-center gap-2"><MessageSquare size={13} />{normalizedSearch ? 'Resultados' : activeFolder?.name ?? (activeFolderId === 'unfiled' ? 'Sem pasta' : 'Conversas')}</span><small>{visibleSessions.length}</small></div>
          <div className={`session-list ${sidebarStyles.list}`}>
            {visibleSessions.length === 0 ? (
              <div className={`empty-sessions ${sidebarStyles.empty}`}><MessageSquare size={20} /><span>{normalizedSearch ? 'Nada encontrado' : 'Nenhuma conversa aqui'}</span></div>
            ) : visibleSessions.map(session => {
              const folder = folders.find(item => item.id === session.folder_id)
              return (
                <div key={session.id} role="button" tabIndex={0} onClick={() => { setSessionMenuId(null); onSelect(session) }} onKeyDown={event => { if (event.key === 'Enter') onSelect(session) }} className={`session-item group ${sidebarStyles.session} ${currentSessionId === session.id ? `is-active ${sidebarStyles.sessionActive}` : ''}`}>
                  <span className={`session-title ${sidebarStyles.sessionTitle}`}>{truncate(session.title, 34)}</span>
                  <span className={`session-date ${sidebarStyles.sessionDate}`}>{folder ? <><span style={{ color: folder.color }}>●</span> {folder.name} · </> : null}{formatSessionDate(session.created_at)}</span>
                  <button type="button" className="absolute right-[6px] top-[13px] grid size-7 place-items-center rounded-lg text-buds-faint opacity-70 hover:bg-[var(--liquid-panel-strong)] hover:text-buds-text group-hover:opacity-100 max-[760px]:opacity-100" onClick={event => { event.stopPropagation(); setSessionMenuId(value => value === session.id ? null : session.id) }} aria-label="Organizar conversa"><MoreHorizontal size={14} /></button>
                  {sessionMenuId === session.id && (
                    <div className="relative z-30 col-span-full mt-1 grid w-full gap-1 rounded-[16px] border border-[var(--liquid-border-strong)] bg-[var(--surface)] p-2 shadow-2xl" onClick={event => event.stopPropagation()}>
                      <span className="flex items-center gap-2 px-2 py-1 text-[10px] font-extrabold uppercase text-buds-muted"><FolderInput size={12} /> Mover para</span>
                      <button type="button" onClick={() => void moveSession(session.id, null)} className="min-h-8 rounded-lg px-2 text-left text-xs text-buds-muted hover:bg-[var(--liquid-panel-soft)] hover:text-buds-text">Sem pasta</button>
                      {folders.map(item => <button key={item.id} type="button" onClick={() => void moveSession(session.id, item.id)} className="flex min-h-8 items-center gap-2 rounded-lg px-2 text-left text-xs text-buds-muted hover:bg-[var(--liquid-panel-soft)] hover:text-buds-text"><span className="size-2 rounded-full" style={{ backgroundColor: item.color }} />{item.name}</button>)}
                      <button type="button" onClick={() => { setSessionMenuId(null); onDelete(session.id) }} className="mt-1 flex min-h-8 items-center gap-2 border-t border-[var(--liquid-border)] px-2 pt-2 text-left text-xs text-rose-300"><Trash2 size={13} /> Remover conversa</button>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      </div>

      <div className={`sidebar-footer ${sidebarStyles.footer}`}>
        <div className={`sidebar-runtime ${sidebarStyles.runtime}`}><Clock3 size={13} /><span>{systemUptime}</span></div>
        <div className={`state-pill tone-${stateInfo.tone} ${sidebarStyles.state} ${sidebarToneStyles[stateInfo.tone] ?? sidebarToneStyles.muted}`}><span />{stateInfo.label}</div>
        <SystemStatus health={systemHealth} selectedModel={selectedModel} />
      </div>
    </aside>
  )
}
