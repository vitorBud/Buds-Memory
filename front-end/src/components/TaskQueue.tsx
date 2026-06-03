import { ArrowRight, ListChecks } from 'lucide-react'
import type { ActivityItem, TaskItem } from '../types'

const DEMO_TASKS: TaskItem[] = [
  { id: '1', title: 'Analise NLP', category: 'Processamento', progress: 78, color: '#14b8a6' },
  { id: '2', title: 'Cache de voz', category: 'Piper TTS', progress: 43, color: '#8b5cf6' },
  { id: '3', title: 'Contexto local', category: 'Memoria', progress: 91, color: '#22c55e' },
]

export function TaskQueue() {
  return (
    <div className="activity-card">
      <div className="panel-heading">
        <span>Fila</span>
        <ListChecks size={14} />
      </div>
      <div className="task-list">
        {DEMO_TASKS.map(task => (
          <div key={task.id} className="task-item">
            <div>
              <strong>{task.title}</strong>
              <span>{task.category}</span>
            </div>
            <em>{task.progress}%</em>
            <i>
              <b style={{ width: `${task.progress}%`, background: task.color }} />
            </i>
          </div>
        ))}
      </div>
      <button className="text-button" type="button">
        Ver todos <ArrowRight size={12} />
      </button>
    </div>
  )
}

const COLOR_MAP: Record<ActivityItem['color'], string> = {
  cyan: '#06b6d4',
  violet: '#8b5cf6',
  emerald: '#22c55e',
  amber: '#f59e0b',
  rose: '#f43f5e',
}

const BASE_ACTIVITY: ActivityItem[] = [
  { id: '1', label: 'Whisper inicializado', time: '1m', color: 'cyan' },
  { id: '2', label: 'Piper em standby', time: '3m', color: 'emerald' },
  { id: '3', label: 'Ollama conectado', time: '5m', color: 'violet' },
  { id: '4', label: 'SQLite pronto', time: '7m', color: 'amber' },
]

export function RecentActivity({ extraItems = [] }: { extraItems?: ActivityItem[] }) {
  const items = [...extraItems, ...BASE_ACTIVITY].slice(0, 7)

  return (
    <div className="activity-card">
      <div className="panel-heading">
        <span>Atividade</span>
        <ArrowRight size={14} />
      </div>
      <div className="activity-list">
        {items.map(item => (
          <div key={item.id} className="activity-item">
            <i style={{ background: COLOR_MAP[item.color] }} />
            <span>{item.label}</span>
            <em>{item.time}</em>
          </div>
        ))}
      </div>
    </div>
  )
}
