import { AiOrb } from './AiOrb'
import type { AiState } from '../types'

interface MainCommandPanelProps {
  aiState: AiState
  hasMessages: boolean
  greeting: string
  children: React.ReactNode
}

export function MainCommandPanel({ aiState, hasMessages, greeting, children }: MainCommandPanelProps) {
  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-[#070c1a] border border-[rgba(0,212,255,0.08)] rounded-xl m-3 mt-0">
      {/* Hero – shown when no messages */}
      {!hasMessages && (
        <div className="flex flex-col items-center justify-center gap-6 py-10 px-6">
          {/* Orb with rings */}
          <div className="relative flex items-center justify-center">
            {/* Outer rings */}
            <div className="absolute w-[190px] h-[190px] rounded-full border border-[rgba(0,212,255,0.18)] animate-glow-pulse" />
            <div className="absolute w-[160px] h-[160px] rounded-full border border-[rgba(0,212,255,0.1)]" />
            <AiOrb state={aiState} size={130} />
          </div>

          {/* Greeting */}
          <div className="text-center">
            <h1 className="text-3xl font-semibold text-gradient-cyan mb-2">{greeting}</h1>
            <p className="text-[15px] text-[#7a8fb5] font-light">Como posso ajudar você hoje?</p>
          </div>
        </div>
      )}

      {/* Chat window when there are messages */}
      {hasMessages && children}
    </div>
  )
}
