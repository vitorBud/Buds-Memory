import { Bot, Clock3, MessageSquare, Plus, Search, Trash2 } from 'lucide-react'
import type { AiState, Session } from '../types'
import { formatSessionDate, truncate } from '../utils/formatters'
import { SystemStatus } from './SystemStatus'
import type { SystemHealth } from './BootScreen'
import { sidebarStyles, sidebarToneStyles } from '../styles/barraLateral'

interface SidebarProps {
  isClosing?: boolean
  sessions: Session[]
  currentSessionId: string | null
  searchQuery: string
  onSearchChange: (value: string) => void
  onNewChat: () => void
  onSelect: (s: Session) => void
  onDelete: (id: string) => void
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

// Barra lateral de conversas, responsável por listar sessões e criar/remover chats.
export function Sidebar({
  isClosing = false,
  sessions,
  currentSessionId,
  searchQuery,
  onSearchChange,
  onNewChat,
  onSelect,
  onDelete,
  systemUptime,
  aiState,
  systemHealth = null,
  selectedModel,
}: SidebarProps) {
  const stateInfo = STATE_MAP[aiState]
  const normalizedSearch = searchQuery.trim().toLowerCase()
  const visibleSessions = normalizedSearch
    ? sessions.filter(session => session.title.toLowerCase().includes(normalizedSearch))
    : sessions

  return (
    <aside className={`sidebar ${isClosing ? 'is-closing' : ''} ${sidebarStyles.root}`}>
      <div className={`sidebar-head ${sidebarStyles.head}`}>
        <div className={`sidebar-mobile-brand ${sidebarStyles.mobileBrand}`}>
          <div className={`nexus-glyph ${sidebarStyles.glyph}`}>
            <Bot size={18} />
          </div>
          <div className={sidebarStyles.mobileBrandCopy}>
            <strong>Buds Memory</strong>
            <span>Conversas</span>
          </div>
        </div>
        <button className={`new-chat-button ${sidebarStyles.newChat}`} type="button" onClick={onNewChat}>
          <Plus size={15} />
          <span>Novo chat</span>
        </button>
        <label className={`sidebar-search ${sidebarStyles.search}`}>
          <Search size={13} />
          <input
            value={searchQuery}
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder="Buscar conversa"
            className={sidebarStyles.searchInput}
          />
        </label>
      </div>

      <div className={`sidebar-section ${sidebarStyles.section}`}>
        <div className={`section-title ${sidebarStyles.title}`}>
          <MessageSquare size={13} />
          Conversas
        </div>

        <div className={`session-list ${sidebarStyles.list}`}>
          {sessions.length === 0 ? (
            <div className={`empty-sessions ${sidebarStyles.empty}`}>
              <MessageSquare size={20} />
              <span>Nenhuma conversa</span>
            </div>
          ) : visibleSessions.length === 0 ? (
            <div className={`empty-sessions ${sidebarStyles.empty}`}>
              <MessageSquare size={20} />
              <span>Nada encontrado</span>
            </div>
          ) : (
            visibleSessions.map(session => (
              <button
                key={session.id}
                type="button"
                onClick={() => onSelect(session)}
                className={`session-item group ${sidebarStyles.session} ${currentSessionId === session.id ? `is-active ${sidebarStyles.sessionActive}` : ''}`}
              >
                <span className={`session-title ${sidebarStyles.sessionTitle}`}>{truncate(session.title, 28)}</span>
                <span className={`session-date ${sidebarStyles.sessionDate}`}>{formatSessionDate(session.created_at)}</span>
                <span
                  role="button"
                  tabIndex={0}
                  className={`delete-session ${sidebarStyles.delete}`}
                  onClick={(event) => {
                    event.stopPropagation()
                    onDelete(session.id)
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault()
                      event.stopPropagation()
                      onDelete(session.id)
                    }
                  }}
                  aria-label="Deletar conversa"
                >
                  <Trash2 size={12} />
                </span>
              </button>
            ))
          )}
        </div>
      </div>

      <div className={`sidebar-footer ${sidebarStyles.footer}`}>
        <div className={`sidebar-runtime ${sidebarStyles.runtime}`}>
          <Clock3 size={13} />
          <span>{systemUptime}</span>
        </div>
        <div className={`state-pill tone-${stateInfo.tone} ${sidebarStyles.state} ${sidebarToneStyles[stateInfo.tone] ?? sidebarToneStyles.muted}`}>
          <span />
          {stateInfo.label}
        </div>
        <SystemStatus health={systemHealth} selectedModel={selectedModel} />
      </div>
    </aside>
  )
}
