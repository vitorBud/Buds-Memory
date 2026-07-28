// ─── Text Analysis Utilities ─────────────────────────────────────────────────
// Funções de análise de texto extraídas do App.tsx para reutilização nos painéis.

import type { Message } from '../types'

const STOP_WORDS = new Set([
  'para', 'como', 'uma', 'com', 'que', 'por', 'mais', 'menos', 'isso', 'esse',
  'essa', 'aqui', 'voce', 'você', 'esta', 'está', 'ser', 'ter', 'das', 'dos',
  'nas', 'nos', 'sim', 'não', 'nao', 'meu', 'minha', 'seu', 'sua', 'ele',
  'ela', 'tem', 'vai', 'fazer', 'sobre', 'apenas', 'agora', 'entao', 'então',
  'quando', 'onde', 'porque', 'qual', 'quais', 'cada', 'todo', 'toda',
])

function normalizeText(text: string) {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s._/-]/g, ' ')
}

/** Extrai os conceitos mais frequentes de uma lista de mensagens. */
export function getConversationConcepts(messages: Message[]) {
  const counts = new Map<string, number>()

  messages.forEach(message => {
    if (message.text === '__thinking__') return
    normalizeText(message.text)
      .split(/\s+/)
      .filter(word => word.length > 3 && !STOP_WORDS.has(word) && !word.includes('/'))
      .forEach(word => counts.set(word, (counts.get(word) ?? 0) + 1))
  })

  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 8)
}

/** Detecta referências a arquivos de código nas mensagens. */
export function getDetectedFiles(messages: Message[]) {
  const fileRegex = /(?:[\w.-]+\/)*[\w.-]+\.(?:js|jsx|ts|tsx|py|json|css|html|md|sql|env|yml|yaml)/gi
  const files = new Map<string, number>()

  messages.forEach(message => {
    const matches = message.text.match(fileRegex) ?? []
    matches.forEach(match => files.set(match, (files.get(match) ?? 0) + 1))
  })

  return [...files.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 8)
}

/** Retorna o texto da primeira mensagem enviada pelo usuário. */
export function getFirstUserMessage(messages: Message[]) {
  return messages.find(message => message.sender === 'user' && message.text !== '__thinking__')?.text ?? ''
}
