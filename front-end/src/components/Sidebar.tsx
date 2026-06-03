import { MessageSquare, Plus, Trash2, Zap, Activity, BarChart3, Database, Bot, Settings, LayoutDashboard } from 'lucide-react'
import type { Session } from '../types'
import { formatSessionDate, truncate } from '../utils/formatters'

interface SidebarProps {
  sessions: Session[]
  currentSessionId: string | null
  onNewChat: () => void
  onSelect: (s: Session) => void
  onDelete: (id: string) => void
  systemUptime: string
}

const NAV_ITEMS = [
  { icon: LayoutDashboard, label: 'Dashboard',    active: true  },
  { icon: Bot,             label: 'Assistant',    active: false },
  { icon: MessageSquare,   label: 'Conversations',active: false },
  { icon: Database,        label: 'Knowledge',    active: false },
  { icon: Activity,        label: 'Data Sources', active: false },
  { icon: Zap,             label: 'Automations',  active: false },
  { icon: BarChart3,       label: 'Analytics',    active: false },
  { icon: Settings,        label: 'System',       active: false },
]

export function Sidebar({ sessions, currentSessionId, onNewChat, onSelect, onDelete, systemUptime }: SidebarProps) {
  return (
    <aside className="w-[200px] shrink-0 flex flex-col bg-[#070c1a] border-r border-[rgba(0,212,255,0.1)] overflow-hidden">
      {/* Logo */}
      <div className="px-4 py-5 border-b border-[rgba(0,212,255,0.1)]">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full border-2 border-cyan-400 flex items-center justify-center shrink-0"
               style={{ boxShadow: '0 0 14px rgba(0,212,255,0.5)' }}>
            <div className="w-3 h-3 rounded-full bg-cyan-400" style={{ boxShadow: '0 0 8px #00d4ff' }} />
          </div>
          <div>
            <div className="text-sm font-bold tracking-[3px] text-white leading-none">NEXUS</div>
            <div className="text-[8px] tracking-[1.5px] text-[#3d5078] font-medium mt-0.5">AI COMMAND CENTER</div>
          </div>
        </div>
      </div>

      {/* Nav items */}
      <nav className="py-3 px-2 border-b border-[rgba(0,212,255,0.1)]">
        {NAV_ITEMS.map(({ icon: Icon, label, active }) => (
          <div
            key={label}
            className={`flex items-center gap-2.5 px-3 py-2 rounded-lg mb-0.5 cursor-pointer transition-all duration-150 group
              ${active
                ? 'bg-[rgba(0,212,255,0.12)] border border-[rgba(0,212,255,0.25)] text-cyan-400'
                : 'text-[#7a8fb5] hover:text-white hover:bg-[rgba(255,255,255,0.04)]'
              }`}
          >
            <Icon size={14} className="shrink-0" />
            <span className="text-[13px] font-medium">{label}</span>
          </div>
        ))}
      </nav>

      {/* New chat button */}
      <div className="px-3 py-3 border-b border-[rgba(0,212,255,0.1)]">
        <button
          onClick={onNewChat}
          className="w-full flex items-center gap-2 px-3 py-2 rounded-lg border border-[rgba(0,212,255,0.3)] bg-[rgba(0,212,255,0.06)] text-cyan-400 text-[13px] font-semibold hover:bg-[rgba(0,212,255,0.14)] hover:shadow-[0_0_20px_rgba(0,212,255,0.12)] transition-all duration-150"
        >
          <Plus size={14} />
          Nova Conversa
        </button>
      </div>

      {/* Sessions list */}
      <div className="flex-1 overflow-y-auto scrollbar-thin py-2 px-2">
        {sessions.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-8 text-[#3d5078]">
            <MessageSquare size={22} opacity={0.4} />
            <span className="text-[11px]">Nenhuma conversa</span>
          </div>
        ) : (
          sessions.map(session => (
            <div
              key={session.id}
              onClick={() => onSelect(session)}
              className={`group flex items-start justify-between gap-1.5 px-3 py-2 rounded-lg mb-1 cursor-pointer transition-all duration-150 border
                ${currentSessionId === session.id
                  ? 'bg-[rgba(0,212,255,0.08)] border-[rgba(0,212,255,0.3)] shadow-[0_0_16px_rgba(0,212,255,0.08)]'
                  : 'border-transparent hover:bg-[rgba(255,255,255,0.03)] hover:border-[rgba(0,212,255,0.1)]'
                }`}
            >
              <div className="min-w-0 flex-1">
                <div className={`text-[12px] font-medium truncate ${currentSessionId === session.id ? 'text-cyan-400' : 'text-[#e8f0ff]'}`}>
                  {truncate(session.title, 22)}
                </div>
                <div className="text-[10px] text-[#3d5078] mt-0.5">{formatSessionDate(session.created_at)}</div>
              </div>
              <button
                onClick={(e) => { e.stopPropagation(); onDelete(session.id) }}
                className="opacity-0 group-hover:opacity-100 p-0.5 rounded text-[#3d5078] hover:text-rose-400 hover:bg-[rgba(255,68,102,0.15)] transition-all duration-150 shrink-0 mt-0.5"
              >
                <Trash2 size={11} />
              </button>
            </div>
          ))
        )}
      </div>

      {/* Footer */}
      <div className="px-4 py-3 border-t border-[rgba(0,212,255,0.1)]">
        <div className="flex items-center gap-2 text-[11px] text-[#7a8fb5] mb-1">
          <div className="w-2 h-2 rounded-full bg-emerald-400 animate-blink shrink-0" style={{ boxShadow: '0 0 6px #00ff9f' }} />
          Sistema Operacional
        </div>
        <div className="text-[10px] text-[#3d5078] font-mono">Uptime · {systemUptime}</div>
      </div>
    </aside>
  )
}
