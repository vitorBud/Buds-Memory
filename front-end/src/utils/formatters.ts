// ─── Utility Formatters ──────────────────────────────────────────────────────

export function formatTime(date: Date): string {
  return date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
}

export function formatRelative(isoString: string): string {
  const date = new Date(isoString)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffMin = Math.floor(diffMs / 60000)
  const diffHr  = Math.floor(diffMin / 60)
  const diffDay = Math.floor(diffHr / 24)

  if (diffMin < 1)   return 'agora'
  if (diffMin < 60)  return `${diffMin}m atrás`
  if (diffHr  < 24)  return `${diffHr}h atrás`
  return `${diffDay}d atrás`
}

export function formatSessionDate(isoString: string): string {
  return new Date(isoString).toLocaleDateString('pt-BR', {
    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
  })
}

export function truncate(str: string, len: number): string {
  return str.length > len ? str.slice(0, len) + '…' : str
}

export function formatIdShort(id: string): string {
  return id.split('-')[0].toUpperCase()
}
