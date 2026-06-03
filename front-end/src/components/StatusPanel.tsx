import { useState, useEffect } from 'react'
import { ParticleNetwork } from './ParticleNetwork'
import { ArrowRight } from 'lucide-react'
import type { AiState } from '../types'

interface StatusPanelProps {
  aiState: AiState
  sessionId: string | null
  msgCount: number
  latency: string
  model: string
}

// ─── Sparkline ───────────────────────────────────────────────────────────────
function Sparkline({ data, color }: { data: number[]; color: string }) {
  const W = 80, H = 26
  const max = Math.max(...data, 1)
  const pts = data.map((v, i) => `${(i / (data.length - 1)) * W},${H - (v / max) * H}`).join(' ')
  return (
    <svg width={W} height={H} className="shrink-0">
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" opacity="0.8" />
    </svg>
  )
}

// ─── Donut Chart ─────────────────────────────────────────────────────────────
function DonutChart({ pct }: { pct: number }) {
  const r = 34, cx = 42, cy = 42, circumference = 2 * Math.PI * r
  const offset = circumference - (pct / 100) * circumference
  return (
    <svg width="84" height="84" viewBox="0 0 84 84">
      <circle cx={cx} cy={cy} r={r} fill="none" stroke="#111e36" strokeWidth="8" />
      <circle cx={cx} cy={cy} r={r} fill="none" stroke="url(#donutGrad)" strokeWidth="8"
        strokeDasharray={circumference} strokeDashoffset={offset}
        strokeLinecap="round" transform={`rotate(-90 ${cx} ${cy})`} />
      <defs>
        <linearGradient id="donutGrad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#00d4ff" />
          <stop offset="100%" stopColor="#7b2ff7" />
        </linearGradient>
      </defs>
      <text x={cx} y={cy + 5} textAnchor="middle" fill="#e8f0ff" fontSize="13" fontWeight="700" fontFamily="Outfit">{pct}%</text>
      <text x={cx} y={cy + 17} textAnchor="middle" fill="#3d5078" fontSize="7" fontFamily="Outfit">Total</text>
    </svg>
  )
}

// ─── Model Activity Card ──────────────────────────────────────────────────────
function ModelBar({ label, avatar, pct, color, role, isActive }: {
  label: string; avatar: string; pct: number; color: string; role: string; isActive: boolean
}) {
  return (
    <div className={`flex items-center gap-2 px-2.5 py-2 rounded-xl border transition-all duration-200 ${isActive ? 'border-[rgba(0,212,255,0.2)] bg-[rgba(0,212,255,0.04)]' : 'border-transparent'}`}>
      <div className="w-7 h-7 rounded-lg flex items-center justify-center text-[11px] font-bold shrink-0" style={{ background: `${color}20`, border: `1px solid ${color}40`, color }}>
        {avatar}
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-[11px] font-semibold text-[#e8f0ff] font-mono">{label}</div>
        <div className="text-[9px] text-[#3d5078]">{role}</div>
        <div className="mt-1 h-1.5 bg-[#111e36] rounded-full overflow-hidden">
          <div className="h-full rounded-full transition-all duration-700" style={{ width: `${pct}%`, background: `linear-gradient(90deg, ${color}, ${color}80)` }} />
        </div>
      </div>
      <span className="text-[10px] font-mono shrink-0" style={{ color }}>{pct}%</span>
    </div>
  )
}

export function StatusPanel({ aiState, sessionId, msgCount, latency, model }: StatusPanelProps) {
  const [stats] = useState({ cpu: 23, gpu: 61, mem: 48, net: 72 })
  const [cpuHistory]  = useState<number[]>(() => Array.from({ length: 12 }, () => Math.floor(Math.random() * 40 + 10)))
  const [gpuHistory]  = useState<number[]>(() => Array.from({ length: 12 }, () => Math.floor(Math.random() * 50 + 30)))
  const [memHistory]  = useState<number[]>(() => Array.from({ length: 12 }, () => Math.floor(Math.random() * 30 + 35)))
  const [netHistory]  = useState<number[]>(() => Array.from({ length: 12 }, () => Math.floor(Math.random() * 60 + 20)))

  // Model bar activity simulation
  const [llmPct, setLlmPct] = useState(22)
  const [sttPct, setSttPct] = useState(8)
  const [ttsPct, setTtsPct] = useState(5)

  useEffect(() => {
    const thinking = aiState === 'thinking'
    const listening = aiState === 'listening' || aiState === 'transcribing'
    const speaking  = aiState === 'speaking'

    setLlmPct(thinking ? Math.round(60 + Math.random() * 32) : 10 + Math.round(Math.random() * 20))
    setSttPct(listening ? Math.round(65 + Math.random() * 25) : 5 + Math.round(Math.random() * 15))
    setTtsPct(speaking  ? Math.round(70 + Math.random() * 22) : 5 + Math.round(Math.random() * 10))
  }, [aiState])

  return (
    <aside className="w-[268px] shrink-0 flex flex-col bg-[#070c1a] border-l border-[rgba(0,212,255,0.1)] overflow-y-auto scrollbar-thin">

      {/* System Status */}
      <div className="p-4 border-b border-[rgba(0,212,255,0.1)]">
        <div className="flex items-center justify-between mb-3">
          <span className="text-[9px] tracking-[2px] font-bold text-[#3d5078]">◉ SYSTEM STATUS</span>
          <span className="text-[9px] font-bold text-emerald-400 bg-[rgba(0,255,159,0.1)] px-2 py-0.5 rounded-full border border-[rgba(0,255,159,0.25)]">
            All Systems OK
          </span>
        </div>
        <div className="grid grid-cols-2 gap-2">
          {[
            { label: 'CPU Usage', val: stats.cpu, hist: cpuHistory, color: '#00d4ff' },
            { label: 'GPU Usage', val: stats.gpu, hist: gpuHistory, color: '#7b2ff7' },
            { label: 'Memory',    val: stats.mem, hist: memHistory, color: '#00d4ff' },
            { label: 'Network',   val: stats.net, hist: netHistory, color: '#7b2ff7' },
          ].map(s => (
            <div key={s.label} className="bg-[#0c1425] border border-[rgba(0,212,255,0.08)] rounded-xl p-2.5">
              <div className="text-[9px] text-[#3d5078] mb-1">{s.label}</div>
              <div className="text-[16px] font-bold text-[#e8f0ff] mb-1">{s.val}%</div>
              <Sparkline data={s.hist} color={s.color} />
            </div>
          ))}
        </div>
      </div>

      {/* Model Activity */}
      <div className="p-4 border-b border-[rgba(0,212,255,0.1)]">
        <div className="flex items-center justify-between mb-3">
          <span className="text-[9px] tracking-[2px] font-bold text-[#3d5078]">⬡ MODEL ACTIVITY</span>
          <span className="text-[9px] text-cyan-400/70 bg-[rgba(0,212,255,0.08)] px-2 py-0.5 rounded-full border border-[rgba(0,212,255,0.15)]">Real-time</span>
        </div>
        <div className="flex flex-col gap-1.5">
          <ModelBar label="qwen3:8b"       avatar="Q" pct={llmPct} color="#7b2ff7" role="LLM Principal"  isActive={aiState === 'thinking'} />
          <ModelBar label="faster-whisper" avatar="W" pct={sttPct} color="#00d4ff" role="Speech-to-Text" isActive={aiState === 'listening' || aiState === 'transcribing'} />
          <ModelBar label="Piper TTS"      avatar="P" pct={ttsPct} color="#00ff9f" role="Text-to-Speech" isActive={aiState === 'speaking'} />
        </div>
        <button className="flex items-center gap-1 mt-3 text-[10px] text-cyan-400/70 hover:text-cyan-400 transition-colors">
          Ver todos os modelos <ArrowRight size={10} />
        </button>
      </div>

      {/* System Visualization Canvas */}
      <div className="p-4 border-b border-[rgba(0,212,255,0.1)]">
        <div className="flex items-center justify-between mb-2">
          <span className="text-[9px] tracking-[2px] font-bold text-[#3d5078]">⬡ AI NETWORK</span>
        </div>
        <div className="h-[140px] rounded-xl overflow-hidden border border-[rgba(0,212,255,0.1)] bg-[#04060f]">
          <ParticleNetwork count={40} maxDist={75} />
        </div>
      </div>

      {/* Resource Allocation Donut */}
      <div className="p-4 border-b border-[rgba(0,212,255,0.1)]">
        <div className="flex items-center justify-between mb-3">
          <span className="text-[9px] tracking-[2px] font-bold text-[#3d5078]">◈ RESOURCE ALLOCATION</span>
          <ArrowRight size={10} className="text-[#3d5078]" />
        </div>
        <div className="flex items-center gap-4">
          <DonutChart pct={65} />
          <div className="flex flex-col gap-1.5 flex-1">
            {[
              { label: 'Compute', val: '65%', color: '#00d4ff' },
              { label: 'Memory',  val: '48%', color: '#7b2ff7' },
              { label: 'Storage', val: '72%', color: '#00ff9f' },
              { label: 'Network', val: '30%', color: '#ffb347' },
            ].map(r => (
              <div key={r.label} className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full shrink-0" style={{ background: r.color, boxShadow: `0 0 4px ${r.color}` }} />
                <span className="text-[10px] text-[#7a8fb5] flex-1">{r.label}</span>
                <span className="text-[10px] font-mono" style={{ color: r.color }}>{r.val}</span>
              </div>
            ))}
          </div>
        </div>
        <button className="flex items-center gap-1 mt-3 text-[10px] text-cyan-400/70 hover:text-cyan-400 transition-colors">
          Optimize Resources <ArrowRight size={10} />
        </button>
      </div>

      {/* Session Info */}
      <div className="p-4">
        <span className="text-[9px] tracking-[2px] font-bold text-[#3d5078] mb-3 block">◈ SESSÃO ATIVA</span>
        <div className="flex flex-col gap-2">
          {[
            { k: 'ID',          v: sessionId ? sessionId.split('-')[0].toUpperCase() + '...' : '—' },
            { k: 'Mensagens',   v: String(msgCount) },
            { k: 'Latência',    v: latency || '—' },
            { k: 'Modelo',      v: model },
          ].map(({ k, v }) => (
            <div key={k} className="flex justify-between items-center py-1.5 border-b border-[rgba(255,255,255,0.03)]">
              <span className="text-[10px] text-[#3d5078]">{k}</span>
              <span className="text-[10px] text-[#7a8fb5] font-mono max-w-[120px] truncate text-right">{v}</span>
            </div>
          ))}
        </div>
      </div>

    </aside>
  )
}
