import { Bot, Clock3, MessageSquare, Plus, Trash2 } from 'lucide-react'
import type { Session } from '../types'
import { formatSessionDate, truncate } from '../utils/formatters'

interface SidebarProps {
  sessions: Session[]
  currentSessionId: string | null
  searchQuery: string
  onNewChat: () => void
  onSelect: (s: Session) => void
  onDelete: (id: string) => void
  systemUptime: string
}

export function Sidebar({
  sessions,
  currentSessionId,
  searchQuery,
  onNewChat,
  onSelect,
  onDelete,
  systemUptime,
}: SidebarProps) {
  const normalizedSearch = searchQuery.trim().toLowerCase()
  const visibleSessions = normalizedSearch
    ? sessions.filter(session => session.title.toLowerCase().includes(normalizedSearch))
    : sessions

  return (
    <aside className="sidebar">
      <div className="sidebar-head">
        <div className="nexus-glyph">
          <Bot size={18} />
        </div>
        <button className="new-chat-button" type="button" onClick={onNewChat}>
          <Plus size={15} />
          <span>Novo chat</span>
        </button>
      </div>

      <div className="sidebar-section">
        <div className="section-title">
          <MessageSquare size={13} />
          Conversas
        </div>

        <div className="session-list">
          {sessions.length === 0 ? (
            <div className="empty-sessions">
              <MessageSquare size={20} />
              <span>Nenhuma conversa</span>
            </div>
          ) : visibleSessions.length === 0 ? (
            <div className="empty-sessions">
              <MessageSquare size={20} />
              <span>Nada encontrado</span>
            </div>
          ) : (
            visibleSessions.map(session => (
              <button
                key={session.id}
                type="button"
                onClick={() => onSelect(session)}
                className={`session-item ${currentSessionId === session.id ? 'is-active' : ''}`}
              >
                <span className="session-title">{truncate(session.title, 28)}</span>
                <span className="session-date">{formatSessionDate(session.created_at)}</span>
                <span
                  role="button"
                  tabIndex={0}
                  className="delete-session"
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

      <div className="sidebar-footer">
        <Clock3 size={13} />
        <span>{systemUptime}</span>
      </div>
    </aside>
  )
}
