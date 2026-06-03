import { Bell, Search, Settings } from 'lucide-react'
import type { AiState } from '../types'

interface TopBarProps {
  aiState: AiState
  sessionTitle: string | null
  latency: string
}

const STATE_MAP: Record<AiState, { label: string; color: string; glow: string }> = {
  idle:         { label: 'Aguardando',    color: 'text-[#7a8fb5]',    glow: '' },
  listening:    { label: 'Ouvindo',       color: 'text-cyan-400',     glow: '0 0 8px rgba(0,212,255,0.5)' },
  transcribing: { label: 'Transcrevendo', color: 'text-amber-400',    glow: '0 0 8px rgba(255,179,71,0.5)' },
  thinking:     { label: 'Pensando',      color: 'text-violet-400',   glow: '0 0 8px rgba(123,47,247,0.5)' },
  speaking:     { label: 'Falando',       color: 'text-emerald-400',  glow: '0 0 8px rgba(0,255,159,0.5)' },
  error:        { label: 'Erro',          color: 'text-rose-400',     glow: '0 0 8px rgba(255,68,102,0.5)' },
}

export function TopBar({ aiState, sessionTitle, latency }: TopBarProps) {
  const stateInfo = STATE_MAP[aiState]

  return (
    <header className="h-[52px] shrink-0 flex items-center justify-between px-5 glass border-b border-[rgba(0,212,255,0.1)] z-10">
      {/* Left */}
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-emerald-400 animate-blink" style={{ boxShadow: '0 0 8px #00ff9f' }} />
          <span className="text-[11px] font-semibold tracking-[2px] text-[#7a8fb5]">
            NEXUS PRIME ONLINE
          </span>
        </div>
        <div className="h-4 w-px bg-[rgba(0,212,255,0.15)]" />
        <span className="text-[10px] font-mono text-[#3d5078] bg-[#111e36] px-2 py-0.5 rounded border border-[rgba(0,212,255,0.1)]">
          v1.0.1
        </span>
        {sessionTitle && (
          <>
            <div className="h-4 w-px bg-[rgba(0,212,255,0.15)]" />
            <span className="text-[12px] text-[#7a8fb5] truncate max-w-[200px]">{sessionTitle}</span>
          </>
        )}
      </div>

      {/* Center search */}
      <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-[#0c1425] border border-[rgba(0,212,255,0.12)] w-64">
        <Search size={12} className="text-[#3d5078]" />
        <span className="text-[12px] text-[#3d5078]">Quick command or search...</span>
        <span className="ml-auto text-[10px] font-mono text-[#3d5078] bg-[#111e36] px-1.5 py-0.5 rounded">⌘K</span>
      </div>

      {/* Right */}
      <div className="flex items-center gap-3">
        {/* AI state badge */}
        <div className={`flex items-center gap-1.5 px-3 py-1 rounded-full border border-[rgba(0,212,255,0.15)] bg-[rgba(11,20,42,0.6)] text-[11px] font-semibold tracking-wide ${stateInfo.color}`}>
          <div
            className="w-1.5 h-1.5 rounded-full shrink-0"
            style={{
              background: 'currentColor',
              boxShadow: stateInfo.glow,
              animation: aiState !== 'idle' ? 'blink 0.8s ease infinite' : undefined,
            }}
          />
          {stateInfo.label}
        </div>

        {latency && (
          <span className="text-[10px] font-mono text-[#3d5078]">{latency}</span>
        )}

        <button className="p-1.5 rounded-lg text-[#7a8fb5] hover:text-cyan-400 hover:bg-[rgba(0,212,255,0.08)] transition-colors relative">
          <Bell size={15} />
          <span className="absolute -top-0.5 -right-0.5 w-3.5 h-3.5 rounded-full bg-violet-500 text-[8px] text-white flex items-center justify-center font-bold">3</span>
        </button>
        <button className="p-1.5 rounded-lg text-[#7a8fb5] hover:text-cyan-400 hover:bg-[rgba(0,212,255,0.08)] transition-colors">
          <Settings size={15} />
        </button>
        <div className="flex items-center gap-2 pl-3 border-l border-[rgba(0,212,255,0.1)]">
          <div className="w-7 h-7 rounded-full bg-violet-600/50 border border-violet-500/40 flex items-center justify-center text-[11px] font-bold text-violet-300">
            N
          </div>
          <div className="hidden sm:block">
            <div className="text-[11px] font-semibold text-white leading-none">Nexus Admin</div>
            <div className="text-[9px] text-[#3d5078] mt-0.5">Administrator</div>
          </div>
        </div>
      </div>
    </header>
  )
}
