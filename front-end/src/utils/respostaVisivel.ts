const INTERNAL_REASONING_TAGS = [
  'think',
  'thinking',
  'analysis',
  'reasoning',
  'scratchpad',
  'internal',
] as const

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function holdPartialInternalTag(text: string) {
  const lastOpen = text.lastIndexOf('<')
  if (lastOpen < 0 || text.slice(lastOpen).includes('>')) return text

  const suffix = text.slice(lastOpen).replace(/\s+/g, '').toLowerCase()
  const candidates = INTERNAL_REASONING_TAGS.flatMap(tag => [`<${tag}`, `</${tag}`])
  return candidates.some(candidate => candidate.startsWith(suffix))
    ? text.slice(0, lastOpen)
    : text
}

/**
 * Remove raciocínio interno do texto sem destruir Markdown ou blocos de código.
 * No streaming, retém também o começo incompleto de uma tag (por exemplo `<thi`).
 */
export function stripInternalReasoning(text: string, streaming = false) {
  let visible = String(text ?? '')

  for (const tag of INTERNAL_REASONING_TAGS) {
    const escaped = escapeRegExp(tag)
    visible = visible.replace(
      new RegExp(`<\\s*${escaped}\\b[^>]*>[\\s\\S]*?<\\s*\\/\\s*${escaped}\\s*>`, 'gi'),
      '',
    )
    visible = visible.replace(
      new RegExp(`<\\s*${escaped}\\b[^>]*>[\\s\\S]*$`, 'gi'),
      '',
    )
    visible = visible.replace(new RegExp(`<\\s*\\/?\\s*${escaped}\\b[^>]*>`, 'gi'), '')
  }

  return streaming ? holdPartialInternalTag(visible) : visible
}

