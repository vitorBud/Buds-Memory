import { ArrowRight } from 'lucide-react'
import type { ActivityItem, TaskItem } from '../types'

// ─── Task Queue ──────────────────────────────────────────────────────────────

const DEMO_TASKS: TaskItem[] = [
  { id: '1', title: 'Análise de Comportamento', category: 'Processamento NLP', progress: 78, color: '#00d4ff' },
  { id: '2', title: 'Síntese de Voz em Cache',  category: 'TTS · Piper',       progress: 43, color: '#7b2ff7' },
  { id: '3', title: 'Indexação de Contexto',     category: 'Knowledge Base',    progress: 91, color: '#00ff9f' },
  { id: '4', title: 'Otimização de Latência',    category: 'Performance',       progress: 32, color: '#ffb347' },
  { id: '5', title: 'Monitoramento de Sessão',   category: 'Sistema',           progress: 68, color: '#00d4ff' },
]

export function TaskQueue() {
  return (
    <div className="glass border border-[rgba(0,212,255,0.1)] rounded-xl p-4 flex flex-col gap-3 h-full">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-[9px] tracking-[2px] font-bold text-[#3d5078]">TASK QUEUE</span>
          <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-[rgba(0,212,255,0.12)] text-cyan-400 border border-[rgba(0,212,255,0.2)]">
            {DEMO_TASKS.length}
          </span>
        </div>
        <button className="flex items-center gap-1 text-[10px] text-cyan-400/70 hover:text-cyan-400 transition-colors">
          Ver todos <ArrowRight size={9} />
        </button>
      </div>
      <div className="flex flex-col gap-2.5 overflow-y-auto scrollbar-thin flex-1">
        {DEMO_TASKS.map(task => (
          <div key={task.id} className="flex items-center gap-2.5 group">
            <div className="w-6 h-6 rounded-md flex items-center justify-center shrink-0"
                 style={{ background: `${task.color}18`, border: `1px solid ${task.color}30` }}>
              <div className="w-1.5 h-1.5 rounded-full" style={{ background: task.color }} />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between mb-1">
                <span className="text-[12px] font-medium text-[#e8f0ff] truncate">{task.title}</span>
                <span className="text-[10px] font-mono ml-2 shrink-0" style={{ color: task.color }}>{task.progress}%</span>
              </div>
              <div className="text-[10px] text-[#3d5078] mb-1">{task.category}</div>
              <div className="h-1 bg-[#111e36] rounded-full overflow-hidden">
                <div className="h-full rounded-full transition-all duration-700" style={{ width: `${task.progress}%`, background: `linear-gradient(90deg, ${task.color}, ${task.color}99)` }} />
              </div>
            </div>
          </div>
        ))}
      </div>
      <button className="flex items-center gap-1.5 text-[11px] text-cyan-400/70 hover:text-cyan-400 transition-colors mt-1">
        <span>+</span> Nova Tarefa
      </button>
    </div>
  )
}

// ─── Recent Activity ─────────────────────────────────────────────────────────

const COLOR_MAP: Record<ActivityItem['color'], { bg: string; dot: string }> = {
  cyan:    { bg: 'rgba(0,212,255,0.12)', dot: '#00d4ff' },
  violet:  { bg: 'rgba(123,47,247,0.15)', dot: '#7b2ff7' },
  emerald: { bg: 'rgba(0,255,159,0.12)', dot: '#00ff9f' },
  amber:   { bg: 'rgba(255,179,71,0.12)', dot: '#ffb347' },
  rose:    { bg: 'rgba(255,68,102,0.12)', dot: '#ff4466' },
}

const BASE_ACTIVITY: ActivityItem[] = [
  { id: '1', label: 'Modelo Whisper inicializado',      time: '1m atrás',  color: 'cyan' },
  { id: '2', label: 'Piper TTS em modo standby',        time: '3m atrás',  color: 'emerald' },
  { id: '3', label: 'Ollama conectado com sucesso',     time: '5m atrás',  color: 'violet' },
  { id: '4', label: 'Banco de dados SQLite pronto',     time: '7m atrás',  color: 'amber' },
  { id: '5', label: 'Sessão de chat iniciada',          time: '9m atrás',  color: 'cyan' },
  { id: '6', label: 'API Flask iniciada na porta 5000', time: '12m atrás', color: 'emerald' },
]

export function RecentActivity({ extraItems = [] }: { extraItems?: ActivityItem[] }) {
  const items = [...extraItems, ...BASE_ACTIVITY].slice(0, 7)

  return (
    <div className="glass border border-[rgba(0,212,255,0.1)] rounded-xl p-4 flex flex-col gap-3 h-full">
      <div className="flex items-center justify-between">
        <span className="text-[9px] tracking-[2px] font-bold text-[#3d5078]">RECENT ACTIVITY</span>
        <button className="flex items-center gap-1 text-[10px] text-cyan-400/70 hover:text-cyan-400 transition-colors">
          Ver todos <ArrowRight size={9} />
        </button>
      </div>
      <div className="flex flex-col gap-2 overflow-y-auto scrollbar-thin flex-1">
        {items.map(item => {
          const c = COLOR_MAP[item.color]
          return (
            <div key={item.id} className="flex items-center gap-2.5">
              <div className="w-5 h-5 rounded-full flex items-center justify-center shrink-0" style={{ background: c.bg }}>
                <div className="w-1.5 h-1.5 rounded-full" style={{ background: c.dot, boxShadow: `0 0 4px ${c.dot}` }} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-[12px] text-[#e8f0ff] truncate">{item.label}</div>
              </div>
              <div className="text-[10px] text-[#3d5078] shrink-0 whitespace-nowrap">{item.time}</div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
