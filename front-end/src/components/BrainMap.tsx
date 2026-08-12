import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import {
  BarChart3,
  CircleHelp,
  Database,
  FileText,
  GitBranch,
  LockKeyhole,
  MousePointer2,
  Minus,
  Network,
  Pin,
  Plus,
  RotateCcw,
  ScanSearch,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react'
import { deleteCognitiveMemory, setCoreMemory, updateCognitiveMemory } from '../services/api'
import type {
  CognitiveMemory,
  KnowledgeGraph,
  KnowledgeSource,
  Message,
} from '../types'
import { getIOSVisualProfile, isIOSRuntime, isWindowsRuntime } from '../plataformas'
import { brainMapStyles } from '../styles/mapaObsidian'

interface BrainMapProps {
  messages: Message[]
  knowledgeSources?: KnowledgeSource[]
  cognitiveMemories?: CognitiveMemory[]
  knowledgeGraph?: KnowledgeGraph | null
  onRefresh?: () => Promise<void> | void
}

type MemoryKind = 'fonte' | 'memoria' | 'entidade' | 'topico'
type MemoryPeriod = 'today' | 'yesterday' | 'week' | 'month' | 'all'

interface MemoryNode {
  id: string
  label: string
  summary: string
  kind: MemoryKind
  weight: number
  x: number
  y: number
  createdAt: Date
  source: string
  tags: string[]
  memoryId?: number
  isCore?: boolean
  locked?: boolean
}

interface MemoryLink {
  id: string
  sourceId: string
  targetId: string
  relationType: string
  strength: number
  evidence: 'saved' | 'classification' | 'semantic'
}

interface SemanticCandidate {
  id: string
  tokens: Set<string>
  label: string
}

const PERIODS: Array<{ id: MemoryPeriod; label: string }> = [
  { id: 'today', label: 'Hoje' },
  { id: 'yesterday', label: 'Ontem' },
  { id: 'week', label: 'Última semana' },
  { id: 'month', label: 'Último mês' },
  { id: 'all', label: 'Histórico' },
]

const KIND_LABEL: Record<MemoryKind, string> = {
  fonte: 'Documento',
  memoria: 'Memória salva',
  entidade: 'Conceito salvo',
  topico: 'Tópico indexado',
}

const KIND_COLOR: Record<MemoryKind, string> = {
  fonte: '#d6a63d',
  memoria: '#d7f7ff',
  entidade: '#c7b8ff',
  topico: '#7da7ff',
}

const KIND_PRIORITY: Record<MemoryKind, number> = {
  memoria: 58,
  fonte: 54,
  entidade: 38,
  topico: 26,
}

const ENTITY_TYPE_LABEL: Record<string, string> = {
  technology: 'Tecnologias',
  project: 'Projetos',
  concept: 'Conceitos',
  person: 'Pessoas',
  event: 'Eventos',
  tool: 'Ferramentas',
  library: 'Bibliotecas',
}

const MEMORY_TYPE_LABEL: Record<string, string> = {
  short: 'Memórias recentes',
  medium: 'Memórias de contexto',
  long: 'Memórias permanentes',
  archive: 'Memórias arquivadas',
}

const MAX_GRAPH_NODES = 260
const MAX_GRAPH_NODES_WINDOWS = 190
const MAX_GRAPH_NODES_IOS = getIOSVisualProfile().maxGraphNodes
const MIN_ZOOM = 0.65
const MAX_ZOOM = 3.2
const GRAPH_WIDTH = 1000
const GRAPH_HEIGHT = 860
const GRAPH_CENTER_X = GRAPH_WIDTH / 2
const GRAPH_CENTER_Y = GRAPH_HEIGHT / 2
const OBSIDIAN_GUIDE_STORAGE_KEY = 'buds-obsidian-guide-seen-v1'

const SEMANTIC_STOP_WORDS = new Set([
  'ainda', 'algo', 'apenas', 'aquela', 'aquele', 'aqui', 'cada', 'como',
  'com', 'conteudo', 'conversa', 'das', 'de', 'dela', 'dele', 'desde',
  'documento', 'dos', 'essa', 'esse', 'esta', 'este', 'isso', 'mais',
  'memoria', 'mesmo', 'minha', 'muito', 'nao', 'nas', 'nos', 'para',
  'pela', 'pelo', 'por', 'porque', 'qual', 'quando', 'que', 'seu', 'sua',
  'sobre', 'tambem', 'tem', 'uma', 'voce',
  'short', 'medium', 'long', 'archive', 'core', 'iphone', 'local',
])

function normalize(text: string) {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function compactLabel(text: string, fallback: string, limit = 72) {
  const clean = text.replace(/\s+/g, ' ').trim()
  if (!clean) return fallback
  return clean.length > limit ? `${clean.slice(0, limit - 3).trim()}...` : clean
}

function prettifyTopic(topic: string) {
  const clean = topic.replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim()
  if (!clean) return ''
  return clean.replace(/\b\w/g, char => char.toUpperCase())
}

function getLearningTitle(source: KnowledgeSource) {
  const topics = [...new Set((source.topics ?? []).map(prettifyTopic).filter(Boolean))].slice(0, 3)
  if (topics.length === 1) return `Aprendizado sobre ${topics[0]}`
  if (topics.length > 1) {
    return `Aprendizado: ${topics.slice(0, -1).join(', ')} e ${topics[topics.length - 1]}`
  }
  return compactLabel(source.title || source.summary, 'Conhecimento importado', 58)
}

function parseDate(value?: string | null) {
  const parsed = value ? new Date(value) : null
  return parsed && !Number.isNaN(parsed.getTime()) ? parsed : new Date(0)
}

function semanticTokens(...values: Array<string | null | undefined>) {
  return new Set(
    normalize(values.filter(Boolean).join(' '))
      .split(/\s+/)
      .filter(token => token.length >= 3 && !SEMANTIC_STOP_WORDS.has(token)),
  )
}

function sharedSemanticScore(left: Set<string>, right: Set<string>) {
  if (!left.size || !right.size) return { shared: 0, score: 0 }
  let shared = 0
  left.forEach(token => {
    if (right.has(token)) shared += 1
  })
  return {
    shared,
    score: shared / Math.max(2, Math.min(left.size, right.size)),
  }
}

function containsSemanticLabel(text: string, label: string) {
  const normalizedLabel = normalize(label)
  if (normalizedLabel.length < 4) return false
  return ` ${normalize(text)} `.includes(` ${normalizedLabel} `)
}

function formatRelationType(relationType: string) {
  const normalizedType = normalize(relationType).replace(/[\s-]+/g, '_')
  const labels: Record<string, string> = {
    uses: 'usa',
    usa: 'usa',
    part_of: 'faz parte de',
    faz_parte_de: 'faz parte de',
    learned_in: 'aprendido em',
    aprendido_em: 'aprendido em',
    related_to: 'relacionado a',
    created: 'criou',
    criado_em: 'criado em',
    depends_on: 'depende de',
    depende_de: 'depende de',
    extends: 'estende',
    implements: 'implementa',
    implementa: 'implementa',
    applies_to: 'aplica-se a',
    mentions: 'menciona',
    mencionado_em: 'mencionado em',
    documentado_em: 'documentado em',
  }
  return labels[normalizedType] ?? relationType.replace(/[_-]+/g, ' ')
}

function evidenceLabel(evidence: MemoryLink['evidence']) {
  if (evidence === 'semantic') return 'contexto provável'
  if (evidence === 'classification') return 'organização do Buds'
  return 'relação confirmada'
}

function shouldShowObsidianGuide() {
  try {
    return window.localStorage.getItem(OBSIDIAN_GUIDE_STORAGE_KEY) !== '1'
  } catch {
    return true
  }
}

function selectGraphNodes(
  nodes: Omit<MemoryNode, 'x' | 'y'>[],
  limit = isIOSRuntime() ? MAX_GRAPH_NODES_IOS : isWindowsRuntime() ? MAX_GRAPH_NODES_WINDOWS : MAX_GRAPH_NODES,
) {
  if (nodes.length <= limit) return nodes
  return nodes
    .map((node, index) => ({
      node,
      index,
      score: KIND_PRIORITY[node.kind] + node.weight * 2 + (node.isCore ? 120 : 0),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .sort((a, b) => a.index - b.index)
    .map(item => item.node)
}

function positionNodes(
  nodes: Omit<MemoryNode, 'x' | 'y'>[],
  links: MemoryLink[],
): MemoryNode[] {
  if (nodes.length === 0) return []
  if (nodes.length === 1) {
    return [{ ...nodes[0], x: GRAPH_CENTER_X, y: GRAPH_CENTER_Y }]
  }

  const indexById = new Map(nodes.map((node, index) => [node.id, index]))
  const degree = new Array(nodes.length).fill(0)
  links.forEach(link => {
    const source = indexById.get(link.sourceId)
    const target = indexById.get(link.targetId)
    if (source == null || target == null) return
    degree[source] += 1
    degree[target] += 1
  })

  const order = nodes
    .map((_, index) => index)
    .sort((a, b) => degree[b] - degree[a] || nodes[b].weight - nodes[a].weight)
  const rankByIndex = new Map(order.map((nodeIndex, rank) => [nodeIndex, rank]))
  const positions = nodes.map((_, index) => {
    const rank = rankByIndex.get(index) ?? index
    if (rank === 0) return { x: GRAPH_CENTER_X, y: GRAPH_CENTER_Y, vx: 0, vy: 0 }
    const angle = rank * 2.399963229728653
    const radius = Math.min(315, 54 + Math.sqrt(rank) * 30)
    return {
      x: GRAPH_CENTER_X + Math.cos(angle) * radius,
      y: GRAPH_CENTER_Y + Math.sin(angle) * radius * 0.78,
      vx: 0,
      vy: 0,
    }
  })

  const iterations = isIOSRuntime() ? (nodes.length > 100 ? 56 : 72) : nodes.length > 180 ? 90 : 135
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    const cooling = 1 - iteration / iterations

    for (let left = 0; left < positions.length; left += 1) {
      for (let right = left + 1; right < positions.length; right += 1) {
        const dx = positions[right].x - positions[left].x || 0.01
        const dy = positions[right].y - positions[left].y || 0.01
        const distanceSquared = Math.max(100, dx * dx + dy * dy)
        const distance = Math.sqrt(distanceSquared)
        const repulsion = (1450 + (nodes[left].weight + nodes[right].weight) * 26) / distanceSquared
        const fx = (dx / distance) * repulsion
        const fy = (dy / distance) * repulsion
        positions[left].vx -= fx
        positions[left].vy -= fy
        positions[right].vx += fx
        positions[right].vy += fy
      }
    }

    links.forEach(link => {
      const sourceIndex = indexById.get(link.sourceId)
      const targetIndex = indexById.get(link.targetId)
      if (sourceIndex == null || targetIndex == null) return
      const source = positions[sourceIndex]
      const target = positions[targetIndex]
      const dx = target.x - source.x
      const dy = target.y - source.y
      const distance = Math.max(1, Math.hypot(dx, dy))
      const desiredDistance = 72 + (1 - Math.min(1, link.strength)) * 68
      const attraction = (distance - desiredDistance) * (0.012 + link.strength * 0.012)
      const fx = (dx / distance) * attraction
      const fy = (dy / distance) * attraction
      source.vx += fx
      source.vy += fy
      target.vx -= fx
      target.vy -= fy
    })

    positions.forEach((position, index) => {
      const hubPull = index === order[0] ? 0.045 : 0.0035 + Math.min(degree[index], 8) * 0.0005
      position.vx += (GRAPH_CENTER_X - position.x) * hubPull
      position.vy += (GRAPH_CENTER_Y - position.y) * hubPull
      position.vx *= 0.78
      position.vy *= 0.78
      position.x += position.vx * Math.max(0.22, cooling)
      position.y += position.vy * Math.max(0.22, cooling)
    })
  }

  const minX = Math.min(...positions.map(position => position.x))
  const maxX = Math.max(...positions.map(position => position.x))
  const minY = Math.min(...positions.map(position => position.y))
  const maxY = Math.max(...positions.map(position => position.y))
  const contentWidth = Math.max(1, maxX - minX)
  const contentHeight = Math.max(1, maxY - minY)
  const fitScale = Math.min(1, 800 / contentWidth, 660 / contentHeight)
  const contentCenterX = (minX + maxX) / 2
  const contentCenterY = (minY + maxY) / 2

  return nodes.map((node, index) => ({
    ...node,
    x: GRAPH_CENTER_X + (positions[index].x - contentCenterX) * fitScale,
    y: GRAPH_CENTER_Y + (positions[index].y - contentCenterY) * fitScale,
  }))
}

function buildMemoryGraph(
  sources: KnowledgeSource[],
  cognitiveMemories: CognitiveMemory[],
  graph?: KnowledgeGraph | null,
): { nodes: MemoryNode[]; links: MemoryLink[] } {
  const rawNodes: Omit<MemoryNode, 'x' | 'y'>[] = []
  const rawLinks: MemoryLink[] = []
  const nodeIds = new Set<string>()
  const linkKeys = new Set<string>()
  const sourceSemanticTokens = new Map<string, Set<string>>()
  const memorySemanticTokens = new Map<string, Set<string>>()
  const entitySemanticTokens = new Map<string, Set<string>>()

  const addNode = (node: Omit<MemoryNode, 'x' | 'y'>) => {
    if (nodeIds.has(node.id)) return
    nodeIds.add(node.id)
    rawNodes.push(node)
  }

  const addLink = (link: MemoryLink) => {
    if (link.sourceId === link.targetId) return
    const pairKey = [link.sourceId, link.targetId].sort().join('::')
    if (linkKeys.has(pairKey)) return
    linkKeys.add(pairKey)
    rawLinks.push(link)
  }

  sources.forEach(source => {
    const sourceId = `fonte-${source.id}`
    const sourceTitle = getLearningTitle(source)
    const topics = [
      ...new Map(
        (source.topics ?? [])
          .map(prettifyTopic)
          .filter(Boolean)
          .map(topic => [normalize(topic), topic]),
      ).values(),
    ]

    addNode({
      id: sourceId,
      label: sourceTitle,
      summary: source.summary || source.title,
      kind: 'fonte',
      weight: 12 + Math.min(topics.length, 10),
      createdAt: parseDate(source.created_at),
      source: source.source_name || source.source_type,
      tags: [source.source_type, ...topics].slice(0, 8),
    })
    sourceSemanticTokens.set(
      sourceId,
      semanticTokens(source.title, source.summary, ...topics),
    )

    topics.slice(0, 7).forEach((topic, topicIndex) => {
      const topicKey = normalize(topic)
      if (!topicKey) return
      const topicId = `topico-${topicKey.replace(/\s+/g, '-')}`
      addNode({
        id: topicId,
        label: compactLabel(topic, 'Tópico indexado', 48),
        summary: `Tópico indexado a partir dos documentos e memórias do Buds.`,
        kind: 'topico',
        weight: 6 + (topicIndex % 3),
        createdAt: parseDate(source.created_at),
        source: 'Conhecimento indexado',
        tags: [source.source_type, topic],
      })
      addLink({
        id: `${sourceId}-${topicId}`,
        sourceId,
        targetId: topicId,
        relationType: 'contém tópico',
        strength: 0.72,
        evidence: 'saved',
      })
    })
  })

  cognitiveMemories.forEach(memory => {
    const importance = Number.isFinite(memory.importance) ? memory.importance : 0.5
    const memoryId = `memoria-${memory.id}`
    addNode({
      id: memoryId,
      label: compactLabel(memory.content, memory.is_core ? 'Core Memory' : `Memória ${memory.memory_type}`, 68),
      summary: memory.content,
      kind: 'memoria',
      weight: (memory.is_core ? 18 : 8) + Math.round(importance * 7) + Math.min(memory.access_count ?? 0, 4),
      createdAt: parseDate(memory.created_at || memory.last_accessed),
      source: memory.origin_type ? `Origem: ${memory.origin_type}` : `Memória ${memory.memory_type}`,
      tags: [...new Set([memory.memory_type, ...(memory.tags ?? [])])].slice(0, 8),
      memoryId: memory.id,
      isCore: Boolean(memory.is_core),
      locked: Boolean(memory.locked),
    })
    memorySemanticTokens.set(
      memoryId,
      semanticTokens(memory.content, ...(memory.tags ?? [])),
    )

    const hasDocumentSource = memory.source_table === 'knowledge_sources' && memory.source_id != null
    if (hasDocumentSource) {
      addLink({
        id: `${memoryId}-fonte-${memory.source_id}`,
        sourceId: memoryId,
        targetId: `fonte-${memory.source_id}`,
        relationType: 'originada de',
        strength: 0.9,
        evidence: 'saved',
      })
    }

    const meaningfulTags = (memory.tags ?? []).filter(tag => {
      const tagKey = normalize(tag)
      return Boolean(tagKey && !SEMANTIC_STOP_WORDS.has(tagKey))
    })
    meaningfulTags.forEach(tag => {
      const topicKey = normalize(tag)
      const topicId = `topico-${topicKey.replace(/\s+/g, '-')}`
      addNode({
        id: topicId,
        label: prettifyTopic(tag),
        summary: `Tópico associado diretamente a memórias salvas.`,
        kind: 'topico',
        weight: 6,
        createdAt: parseDate(memory.created_at || memory.last_accessed),
        source: 'Tags de memória',
        tags: [tag],
      })
      addLink({
        id: `${memoryId}-${topicId}`,
        sourceId: memoryId,
        targetId: topicId,
        relationType: 'marcada com',
        strength: 0.84,
        evidence: 'saved',
      })
    })

    if (!hasDocumentSource && meaningfulTags.length === 0) {
      const memoryType = normalize(memory.memory_type) || 'memory'
      const categoryId = `categoria-memoria-${memoryType}`
      addNode({
        id: categoryId,
        label: MEMORY_TYPE_LABEL[memoryType] || `Memórias ${memory.memory_type}`,
        summary: `Agrupamento pelo tipo real de retenção da memória.`,
        kind: 'topico',
        weight: 7,
        createdAt: parseDate(memory.created_at || memory.last_accessed),
        source: 'Classificação da memória',
        tags: [memory.memory_type],
      })
      addLink({
        id: `${memoryId}-${categoryId}`,
        sourceId: memoryId,
        targetId: categoryId,
        relationType: 'tipo de memória',
        strength: 0.72,
        evidence: 'classification',
      })
    }
  })

  const entityIdByName = new Map<string, string>()
  ;(graph?.entities ?? []).forEach(entity => {
    const entityId = `entidade-${entity.id}`
    entityIdByName.set(normalize(entity.name), entityId)
    const importance = Number.isFinite(entity.importance) ? entity.importance : 0.5
    addNode({
      id: entityId,
      label: compactLabel(entity.name, 'Conceito salvo', 54),
      summary: entity.description || `Conceito salvo no grafo cognitivo: ${entity.name}.`,
      kind: 'entidade',
      weight: 7 + Math.round(importance * 8) + Math.min(entity.access_count ?? 0, 4),
      createdAt: parseDate(entity.last_seen || entity.first_seen),
      source: 'Grafo cognitivo',
      tags: [entity.entity_type],
    })
    entitySemanticTokens.set(
      entityId,
      semanticTokens(entity.name, entity.description, entity.entity_type),
    )

    const entityType = normalize(entity.entity_type) || 'concept'
    const categoryId = `categoria-entidade-${entityType}`
    addNode({
      id: categoryId,
      label: ENTITY_TYPE_LABEL[entityType] || prettifyTopic(entity.entity_type),
      summary: `Agrupamento pela classificação registrada no grafo de conhecimento.`,
      kind: 'topico',
      weight: 8,
      createdAt: parseDate(entity.last_seen || entity.first_seen),
      source: 'Classificação do grafo',
      tags: [entity.entity_type],
    })
    addLink({
      id: `${entityId}-${categoryId}`,
      sourceId: entityId,
      targetId: categoryId,
      relationType: 'classificada como',
      strength: 0.76,
      evidence: 'classification',
    })
  })

  ;(graph?.edges ?? []).forEach((edge, index) => {
    const sourceId = entityIdByName.get(normalize(edge.source))
    const targetId = entityIdByName.get(normalize(edge.target))
    if (!sourceId || !targetId) return
    if (normalize(edge.relation_type).replace(/\s+/g, '_') === 'related_to' && edge.strength < 0.45) return
    addLink({
      id: `kg-${sourceId}-${targetId}-${edge.relation_type}-${index}`,
      sourceId,
      targetId,
      relationType: edge.relation_type,
      strength: Number.isFinite(edge.strength) ? edge.strength : 0.5,
      evidence: 'saved',
    })
  })

  const connectByMeaning = (
    sourceId: string,
    sourceText: string,
    sourceTokens: Set<string>,
    candidates: SemanticCandidate[],
    relationType: string,
    limit: number,
    minShared = 2,
  ) => {
    candidates
      .map(candidate => ({
        targetId: candidate.id,
        exactLabel: containsSemanticLabel(sourceText, candidate.label),
        ...sharedSemanticScore(sourceTokens, candidate.tokens),
      }))
      .filter(match => match.exactLabel || (match.shared >= minShared && match.score >= 0.22))
      .sort((a, b) => Number(b.exactLabel) - Number(a.exactLabel) || b.score - a.score || b.shared - a.shared)
      .slice(0, limit)
      .forEach(match => {
        addLink({
          id: `semantic-${sourceId}-${match.targetId}`,
          sourceId,
          targetId: match.targetId,
          relationType,
          strength: match.exactLabel ? 0.76 : Math.min(0.78, 0.5 + match.score * 0.32),
          evidence: 'semantic',
        })
      })
  }

  const topicSemanticTokens = rawNodes
    .filter(node => node.kind === 'topico' && !node.id.startsWith('categoria-'))
    .map(node => ({ id: node.id, tokens: semanticTokens(node.label, ...node.tags), label: node.label }))
  const entityCandidates = rawNodes
    .filter(node => node.kind === 'entidade')
    .map(node => ({ id: node.id, tokens: entitySemanticTokens.get(node.id) ?? new Set<string>(), label: node.label }))
  const sourceCandidates = rawNodes
    .filter(node => node.kind === 'fonte')
    .map(node => ({ id: node.id, tokens: sourceSemanticTokens.get(node.id) ?? new Set<string>(), label: node.label }))
  const memoryCandidates = rawNodes
    .filter(node => node.kind === 'memoria')
    .map(node => ({ id: node.id, tokens: memorySemanticTokens.get(node.id) ?? new Set<string>(), label: node.label }))

  memorySemanticTokens.forEach((tokens, memoryId) => {
    const memory = rawNodes.find(node => node.id === memoryId)
    const sourceText = [memory?.label, memory?.summary, ...(memory?.tags ?? [])].filter(Boolean).join(' ')
    connectByMeaning(memoryId, sourceText, tokens, entityCandidates, 'menciona conceito', 2)
    connectByMeaning(memoryId, sourceText, tokens, topicSemanticTokens, 'relacionada ao tópico', 2)
    connectByMeaning(memoryId, sourceText, tokens, sourceCandidates, 'contexto compartilhado', 1, 3)
    connectByMeaning(
      memoryId,
      sourceText,
      tokens,
      memoryCandidates.filter(candidate => candidate.id > memoryId),
      'assunto em comum',
      2,
    )
  })

  sourceSemanticTokens.forEach((tokens, sourceId) => {
    const source = rawNodes.find(node => node.id === sourceId)
    const sourceText = [source?.label, source?.summary, ...(source?.tags ?? [])].filter(Boolean).join(' ')
    connectByMeaning(sourceId, sourceText, tokens, entityCandidates, 'menciona conceito', 3)
  })

  const selectedNodes = selectGraphNodes(rawNodes)
  const visibleIds = new Set(selectedNodes.map(node => node.id))
  const selectedLinks = rawLinks.filter(
    link => visibleIds.has(link.sourceId) && visibleIds.has(link.targetId),
  )
  return {
    nodes: positionNodes(selectedNodes, selectedLinks),
    links: selectedLinks,
  }
}

function filterNodesByPeriod(nodes: MemoryNode[], period: MemoryPeriod) {
  if (period === 'all') return nodes
  const now = new Date()
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const startYesterday = startToday - 86_400_000

  return nodes.filter(node => {
    const time = node.createdAt.getTime()
    if (period === 'today') return time >= startToday
    if (period === 'yesterday') return time >= startYesterday && time < startToday
    if (period === 'week') return time >= now.getTime() - 7 * 86_400_000
    if (period === 'month') return time >= now.getTime() - 30 * 86_400_000
    return true
  })
}

function formatShortDate(date: Date) {
  if (date.getTime() === 0) return '--'
  return date.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })
}

function ObsidianMemoryGraph({
  nodes,
  links,
  selectedId,
  onSelect,
}: {
  nodes: MemoryNode[]
  links: MemoryLink[]
  selectedId: string
  onSelect: (id: string) => void
}) {
  const svgRef = useRef<SVGSVGElement>(null)
  const graphContentRef = useRef<SVGGElement>(null)
  const dragRef = useRef<{
    pointerId: number
    startX: number
    startY: number
    originX: number
    originY: number
    moved: boolean
  } | null>(null)
  const suppressClickUntilRef = useRef(0)
  const viewRef = useRef({ x: 0, y: 0, scale: 1 })
  const nodeById = useMemo(() => new Map(nodes.map(node => [node.id, node])), [nodes])
  const visibleLinks = useMemo(
    () => links
      .map(link => ({
        ...link,
        source: nodeById.get(link.sourceId),
        target: nodeById.get(link.targetId),
      }))
      .filter((link): link is typeof link & { source: MemoryNode; target: MemoryNode } => (
        Boolean(link.source && link.target)
      )),
    [links, nodeById],
  )

  const applyView = useCallback((next: { x: number; y: number; scale: number }) => {
    viewRef.current = next
    graphContentRef.current?.setAttribute(
      'transform',
      `translate(${next.x} ${next.y}) scale(${next.scale})`,
    )
  }, [])

  const zoomAtCenter = useCallback((factor: number) => {
    const current = viewRef.current
    const scale = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, current.scale * factor))
    applyView({
      scale,
      x: GRAPH_CENTER_X - ((GRAPH_CENTER_X - current.x) / current.scale) * scale,
      y: GRAPH_CENTER_Y - ((GRAPH_CENTER_Y - current.y) / current.scale) * scale,
    })
  }, [applyView])

  const resetView = useCallback(() => applyView({ x: 0, y: 0, scale: 1 }), [applyView])

  const handleWheel = useCallback((event: React.WheelEvent<SVGSVGElement>) => {
    event.preventDefault()
    const rect = event.currentTarget.getBoundingClientRect()
    const cursorX = ((event.clientX - rect.left) / Math.max(rect.width, 1)) * GRAPH_WIDTH
    const cursorY = ((event.clientY - rect.top) / Math.max(rect.height, 1)) * GRAPH_HEIGHT
    const factor = event.deltaY < 0 ? 1.12 : 0.89
    const current = viewRef.current
    const scale = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, current.scale * factor))
    const contentX = (cursorX - current.x) / current.scale
    const contentY = (cursorY - current.y) / current.scale
    applyView({
      scale,
      x: cursorX - contentX * scale,
      y: cursorY - contentY * scale,
    })
  }, [applyView])

  const handlePointerDown = useCallback((event: React.PointerEvent<SVGSVGElement>) => {
    if (event.button !== 0) return
    if ((event.target as Element).closest('.obsidian-graph-node')) return
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: viewRef.current.x,
      originY: viewRef.current.y,
      moved: false,
    }
    event.currentTarget.setPointerCapture(event.pointerId)
  }, [])

  const handlePointerMove = useCallback((event: React.PointerEvent<SVGSVGElement>) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    const rect = event.currentTarget.getBoundingClientRect()
    const dx = event.clientX - drag.startX
    const dy = event.clientY - drag.startY
    if (Math.abs(dx) + Math.abs(dy) > 5) drag.moved = true
    applyView({
      ...viewRef.current,
      x: drag.originX + (dx / Math.max(rect.width, 1)) * GRAPH_WIDTH,
      y: drag.originY + (dy / Math.max(rect.height, 1)) * GRAPH_HEIGHT,
    })
  }, [applyView])

  const handlePointerEnd = useCallback((event: React.PointerEvent<SVGSVGElement>) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    if (drag.moved) suppressClickUntilRef.current = performance.now() + 180
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    dragRef.current = null
  }, [])

  const selectNode = useCallback((id: string) => {
    if (performance.now() < suppressClickUntilRef.current) return
    onSelect(id)
  }, [onSelect])

  if (!nodes.length) {
    return (
      <div className="obsidian-graph-empty" role="status">
        <Network size={28} />
        <strong>Nenhum conhecimento neste período</strong>
        <p>Converse com o Buds ou importe um documento para criar memórias e relações reais.</p>
      </div>
    )
  }

  return (
    <div className="obsidian-graph-viewport" aria-label="Grafo interativo das memórias do Buds Memory">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${GRAPH_WIDTH} ${GRAPH_HEIGHT}`}
        preserveAspectRatio="xMidYMid meet"
        role="group"
        aria-label="Arraste para mover o mapa e use a roda ou os controles para aplicar zoom"
        onWheel={handleWheel}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerEnd}
        onPointerCancel={handlePointerEnd}
      >
        <g ref={graphContentRef} transform="translate(0 0) scale(1)">
          <circle
            className="obsidian-graph-boundary"
            cx={GRAPH_CENTER_X}
            cy={GRAPH_CENTER_Y}
            r="382"
          />
          <g className="obsidian-graph-links">
            {visibleLinks.map(link => (
              <line
                key={link.id}
                className={[
                  link.strength >= 0.7 ? 'is-strong' : '',
                  `evidence-${link.evidence}`,
                  link.sourceId === selectedId || link.targetId === selectedId ? 'is-active' : '',
                ].filter(Boolean).join(' ')}
                x1={link.source.x}
                y1={link.source.y}
                x2={link.target.x}
                y2={link.target.y}
              >
                <title>{`${formatRelationType(link.relationType)} · ${evidenceLabel(link.evidence)}`}</title>
              </line>
            ))}
          </g>
          <g className="obsidian-graph-nodes">
            {nodes.map(node => {
              const active = node.id === selectedId
              const size = Math.max(4.2, Math.min(11.5, 3.2 + node.weight * 0.38))
              const showGlow = active || node.isCore || node.weight >= 14
              return (
                <g
                  key={node.id}
                  className={`obsidian-graph-node node-${node.kind} ${active ? 'is-active' : ''}`}
                  style={{ color: KIND_COLOR[node.kind] }}
                  onPointerDown={event => event.stopPropagation()}
                  onClick={event => {
                    event.stopPropagation()
                    selectNode(node.id)
                  }}
                  role="button"
                  tabIndex={0}
                  onKeyDown={event => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault()
                      onSelect(node.id)
                    }
                  }}
                  aria-label={node.label}
                >
                  <title>{node.label}</title>
                  <circle
                    className="node-hit-area"
                    cx={node.x}
                    cy={node.y}
                    r={Math.max(16, size + 10)}
                  />
                  {showGlow && <circle className="node-glow" cx={node.x} cy={node.y} r={size * 3.1} />}
                  <circle className="node-dot" cx={node.x} cy={node.y} r={size} />
                  {active && <circle className="node-ring" cx={node.x} cy={node.y} r={size + 10} />}
                </g>
              )
            })}
          </g>
        </g>
      </svg>

      <div className="obsidian-graph-zoom-controls" aria-label="Controles de zoom">
        <button type="button" onClick={() => zoomAtCenter(1.2)} aria-label="Aumentar zoom" title="Aumentar zoom">
          <Plus size={14} />
        </button>
        <button type="button" onClick={() => zoomAtCenter(0.82)} aria-label="Diminuir zoom" title="Diminuir zoom">
          <Minus size={14} />
        </button>
        <button type="button" onClick={resetView} aria-label="Centralizar mapa" title="Centralizar mapa">
          <RotateCcw size={14} />
        </button>
      </div>
    </div>
  )
}

export function BrainMap({
  messages,
  knowledgeSources = [],
  cognitiveMemories = [],
  knowledgeGraph = null,
  onRefresh,
}: BrainMapProps) {
  const graphData = useMemo(
    () => buildMemoryGraph(knowledgeSources, cognitiveMemories, knowledgeGraph),
    [knowledgeSources, cognitiveMemories, knowledgeGraph],
  )
  const [selectedId, setSelectedId] = useState('')
  const [isStatsOpen, setIsStatsOpen] = useState(false)
  const [isGuideOpen, setIsGuideOpen] = useState(shouldShowObsidianGuide)
  const [period, setPeriod] = useState<MemoryPeriod>('all')
  const [memoryAction, setMemoryAction] = useState<string | null>(null)
  const [memoryError, setMemoryError] = useState('')
  const visibleNodes = useMemo(
    () => filterNodesByPeriod(graphData.nodes, period),
    [graphData.nodes, period],
  )
  const visibleNodeIds = useMemo(() => new Set(visibleNodes.map(node => node.id)), [visibleNodes])
  const visibleLinks = useMemo(
    () => graphData.links.filter(link => (
      visibleNodeIds.has(link.sourceId) && visibleNodeIds.has(link.targetId)
    )),
    [graphData.links, visibleNodeIds],
  )
  const selectedNode = visibleNodes.find(node => node.id === selectedId)
  const selectedMemory = selectedNode?.memoryId
    ? cognitiveMemories.find(memory => memory.id === selectedNode.memoryId)
    : null
  const visibleNodeById = useMemo(
    () => new Map(visibleNodes.map(node => [node.id, node])),
    [visibleNodes],
  )
  const selectedRelations = useMemo(() => {
    if (!selectedNode) return []
    return visibleLinks
      .filter(link => link.sourceId === selectedNode.id || link.targetId === selectedNode.id)
      .map(link => {
        const peerId = link.sourceId === selectedNode.id ? link.targetId : link.sourceId
        return {
          ...link,
          peer: visibleNodeById.get(peerId),
        }
      })
      .filter((relation): relation is typeof relation & { peer: MemoryNode } => Boolean(relation.peer))
      .sort((a, b) => b.strength - a.strength)
      .slice(0, 6)
  }, [selectedNode, visibleLinks, visibleNodeById])
  const activeMessages = messages.filter(message => message.text !== '__thinking__')
  const graphEntityCount = knowledgeGraph?.entities.length ?? 0
  const graphEdgeCount = knowledgeGraph?.edges.length ?? 0
  const savedLinkCount = visibleLinks.filter(link => link.evidence === 'saved').length
  const classificationLinkCount = visibleLinks.filter(link => link.evidence === 'classification').length
  const semanticLinkCount = visibleLinks.filter(link => link.evidence === 'semantic').length

  const dismissGuide = useCallback(() => {
    setIsGuideOpen(false)
    try {
      window.localStorage.setItem(OBSIDIAN_GUIDE_STORAGE_KEY, '1')
    } catch {
      // O guia continua dispensável mesmo quando o armazenamento local está indisponível.
    }
  }, [])

  const recentLearning = useMemo(() => {
    const memoryEvents = cognitiveMemories.slice(0, 5).map(memory => ({
      id: `memory-${memory.id}`,
      label: `Memória ${memory.memory_type}`,
      text: compactLabel(memory.content, 'Memória salva', 96),
      date: parseDate(memory.created_at || memory.last_accessed),
    }))
    const entityEvents = (knowledgeGraph?.entities ?? []).slice(0, 5).map(entity => ({
      id: `entity-${entity.id}`,
      label: 'Conceito aprendido',
      text: compactLabel(entity.name, 'Conceito salvo', 96),
      date: parseDate(entity.last_seen || entity.first_seen),
    }))
    const sourceEvents = knowledgeSources.slice(0, 4).map(source => ({
      id: `source-${source.id}`,
      label: 'Documento indexado',
      text: getLearningTitle(source),
      date: parseDate(source.created_at),
    }))
    return [...memoryEvents, ...entityEvents, ...sourceEvents]
      .filter(item => item.date.getTime() > 0)
      .sort((a, b) => b.date.getTime() - a.date.getTime())
      .slice(0, 6)
  }, [cognitiveMemories, knowledgeGraph, knowledgeSources])

  useEffect(() => {
    if (selectedId && !visibleNodes.some(node => node.id === selectedId)) {
      window.queueMicrotask(() => setSelectedId(''))
    }
  }, [selectedId, visibleNodes])

  const runMemoryAction = useCallback(async (label: string, action: () => Promise<void>) => {
    setMemoryAction(label)
    setMemoryError('')
    try {
      await action()
      await onRefresh?.()
    } catch (error) {
      setMemoryError(error instanceof Error ? error.message : 'Não foi possível atualizar a memória.')
    } finally {
      setMemoryAction(null)
    }
  }, [onRefresh])

  const handleToggleCore = useCallback(() => {
    if (!selectedMemory) return
    void runMemoryAction(selectedMemory.is_core ? 'desfixando' : 'fixando', async () => {
      await setCoreMemory(selectedMemory.id, !selectedMemory.is_core)
    })
  }, [runMemoryAction, selectedMemory])

  const handleDeleteMemory = useCallback(() => {
    if (!selectedMemory) return
    if (selectedMemory.is_core || selectedMemory.locked) {
      setMemoryError('Esta memória está protegida. Desfixe a Core Memory antes de excluí-la.')
      return
    }
    if (!window.confirm('Excluir esta memória permanentemente?')) return
    void runMemoryAction('excluindo', async () => {
      await deleteCognitiveMemory(selectedMemory.id, false)
      setSelectedId('')
    })
  }, [runMemoryAction, selectedMemory])

  const handleImportanceChange = useCallback((nextImportance: number) => {
    if (!selectedMemory) return
    void runMemoryAction('salvando', async () => {
      await updateCognitiveMemory(selectedMemory.id, { importance: nextImportance })
    })
  }, [runMemoryAction, selectedMemory])

  const renderMemoryActions = () => {
    if (!selectedMemory) return null
    const isProtected = Boolean(selectedMemory.is_core || selectedMemory.locked)
    return (
      <div className="memory-curation-actions">
        <button type="button" onClick={handleToggleCore} disabled={Boolean(memoryAction)}>
          <Pin size={13} />
          {selectedMemory.is_core ? 'Desfixar Core' : 'Fixar como Core'}
        </button>
        <label>
          Força visual
          <input
            type="range"
            min="0.2"
            max="1"
            step="0.05"
            value={selectedMemory.importance ?? 0.5}
            disabled={Boolean(memoryAction)}
            onChange={event => handleImportanceChange(Number(event.target.value))}
          />
        </label>
        <button
          type="button"
          className="danger"
          onClick={handleDeleteMemory}
          disabled={Boolean(memoryAction)}
          title={isProtected ? 'Desfixe esta memória antes de excluí-la' : 'Excluir memória'}
        >
          <Trash2 size={13} />
          {isProtected ? 'Memória protegida' : 'Excluir'}
        </button>
        {memoryAction && <small>Atualizando...</small>}
        {memoryError && <small className="error-text">{memoryError}</small>}
      </div>
    )
  }

  return (
    <div className={brainMapStyles.page}>
      <header className="obsidian-graph-topbar">
        <div>
          <span className="eyebrow">Visualização em gráfico</span>
          <strong>{selectedNode?.label ?? 'Memórias do Buds'}</strong>
        </div>
        <div className="obsidian-graph-actions">
          {PERIODS.map(option => (
            <button
              key={option.id}
              type="button"
              className={period === option.id ? 'is-active' : ''}
              onClick={() => setPeriod(option.id)}
              aria-pressed={period === option.id}
            >
              {option.label}
            </button>
          ))}
          <button
            type="button"
            onClick={() => setIsGuideOpen(current => !current)}
            aria-expanded={isGuideOpen}
            aria-label="Explicar como funciona o mapa de memórias"
            title="Como funciona"
          >
            <CircleHelp size={14} />
          </button>
          <button
            type="button"
            onClick={() => setIsStatsOpen(true)}
            aria-label="Abrir estatísticas da memória"
            title="Estatísticas da memória"
          >
            <BarChart3 size={14} />
          </button>
        </div>
      </header>

      <AnimatePresence initial={false}>
        {isGuideOpen && (
          <motion.section
            className="obsidian-guide"
            aria-label="Como funciona o mapa de memórias"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
          >
            <div className="obsidian-guide-intro">
              <span><Network size={18} /></span>
              <div>
                <strong>Este é o mapa do que o Buds aprendeu com você</strong>
                <p>
                  Ele reúne memórias, documentos, conceitos e tópicos. Ideias só são aproximadas
                  quando existe evidência suficiente — o mapa não inventa ligações para preencher espaço.
                </p>
              </div>
            </div>
            <div className="obsidian-guide-steps">
              <span><MousePointer2 size={14} /><small>Toque em um ponto para entender o conteúdo.</small></span>
              <span><GitBranch size={14} /><small>Linha contínua: vínculo salvo. Pontilhada: organização ou contexto provável.</small></span>
              <span><Sparkles size={14} /><small>{savedLinkCount} vínculos salvos, {classificationLinkCount} agrupamentos{semanticLinkCount ? ` e ${semanticLinkCount} aproximações` : ''}.</small></span>
            </div>
            <button type="button" onClick={dismissGuide}>Explorar meu mapa</button>
          </motion.section>
        )}
      </AnimatePresence>

      <main className={`obsidian-graph-main ${selectedNode ? 'has-selection' : ''}`}>
        <ObsidianMemoryGraph
          nodes={visibleNodes}
          links={visibleLinks}
          selectedId={selectedNode?.id ?? ''}
          onSelect={setSelectedId}
        />

        {selectedNode && (
          <aside className="obsidian-memory-card">
            <div className="obsidian-memory-card-head">
              <span>{KIND_LABEL[selectedNode.kind]}</span>
              <button
                type="button"
                onClick={() => setSelectedId('')}
                aria-label="Fechar detalhes da memória"
                title="Fechar detalhes"
              >
                <X size={15} />
              </button>
            </div>
            <strong>{selectedNode.label}</strong>
            <p>{selectedNode.summary}</p>
            <div className="obsidian-memory-meta">
              <small>Origem: {selectedNode.source}</small>
              <small>Data: {formatShortDate(selectedNode.createdAt)}</small>
              <small>Peso: {selectedNode.weight}</small>
            </div>
            {selectedNode.tags.length > 0 && (
              <div className="obsidian-memory-tags">
                {selectedNode.tags.slice(0, 7).map(tag => <em key={tag}>{tag}</em>)}
              </div>
            )}
            <div className="obsidian-node-relations">
              <span>Conexões ({selectedRelations.length})</span>
              {selectedRelations.length > 0 ? selectedRelations.map(relation => (
                <button
                  key={relation.id}
                  type="button"
                  onClick={() => setSelectedId(relation.peer.id)}
                  title={`Abrir ${relation.peer.label}`}
                >
                  <i style={{ background: KIND_COLOR[relation.peer.kind] }} />
                  <span>
                    <strong>{relation.peer.label}</strong>
                    <small>{formatRelationType(relation.relationType)} · {evidenceLabel(relation.evidence)}</small>
                  </span>
                </button>
              )) : (
                <small>Esta memória ainda não possui uma relação verificável.</small>
              )}
            </div>
            {renderMemoryActions()}
          </aside>
        )}

        <div className="obsidian-graph-legend">
          {(['memoria', 'fonte', 'entidade', 'topico'] as MemoryKind[]).map(kind => (
            <span key={kind}>
              <i style={{ background: KIND_COLOR[kind] }} />
              {KIND_LABEL[kind]}
            </span>
          ))}
        </div>

        <div className="obsidian-graph-stats">
          <div><span>Pontos</span><strong>{visibleNodes.length}</strong></div>
          <div><span>Memórias</span><strong>{cognitiveMemories.length}</strong></div>
          <div><span>Docs</span><strong>{knowledgeSources.length}</strong></div>
          <div><span>Conexões</span><strong>{visibleLinks.length}</strong></div>
        </div>
      </main>

      <AnimatePresence>
        {isStatsOpen && (
          <motion.div
            className="brain-stats-popover"
            role="dialog"
            aria-modal="true"
            aria-label="Painel de memória cognitiva"
            initial={{ opacity: 0, x: 28, scale: 0.98 }}
            animate={{ opacity: 1, x: 0, scale: 1 }}
            exit={{ opacity: 0, x: 28, scale: 0.98 }}
            transition={{ duration: 0.18, ease: 'easeOut' }}
          >
            <div className="brain-stats-popover-head">
              <div>
                <span className="eyebrow">Buds · Second Brain</span>
                <strong>Painel de memória</strong>
              </div>
              <button type="button" onClick={() => setIsStatsOpen(false)} aria-label="Fechar" title="Fechar">
                <X size={16} />
              </button>
            </div>

            {cognitiveMemories.filter(memory => memory.memory_type === 'long' || memory.is_core).length > 0 && (
              <div className="brain-user-profile-section">
                <div className="brain-section-label">
                  <LockKeyhole size={13} />
                  <span>Perfil salvo</span>
                  <small>
                    {cognitiveMemories.filter(memory => memory.memory_type === 'long' || memory.is_core).length} memórias permanentes
                  </small>
                </div>
                <div className="brain-profile-memories">
                  {cognitiveMemories
                    .filter(memory => memory.memory_type === 'long' || memory.is_core)
                    .slice(0, 5)
                    .map(memory => (
                      <div key={memory.id} className={`brain-profile-chip ${memory.is_core ? 'is-core' : ''}`}>
                        {memory.is_core ? <Pin size={11} /> : <Database size={11} />}
                        <span>{compactLabel(memory.content, 'Memória', 72)}</span>
                        <small>{Math.round((memory.importance ?? 0) * 100)}%</small>
                      </div>
                    ))}
                </div>
              </div>
            )}

            <div className="brain-stats">
              <div className="brain-stat-card">
                <span>Nós visíveis</span>
                <strong>{visibleNodes.length}</strong>
                <small>no período</small>
              </div>
              <div className="brain-stat-card">
                <span>Memórias</span>
                <strong>{cognitiveMemories.length}</strong>
                <small>banco cognitivo</small>
              </div>
              <div className="brain-stat-card">
                <span>Docs</span>
                <strong>{knowledgeSources.length}</strong>
                <small>indexados</small>
              </div>
              <div className="brain-stat-card">
                <span>Conceitos</span>
                <strong>{graphEntityCount}</strong>
                <small>no grafo real</small>
              </div>
              <div className="brain-stat-card">
                <span>Relações KG</span>
                <strong>{graphEdgeCount}</strong>
                <small>salvas no banco</small>
              </div>
              <div className="brain-stat-card">
                <span>Aproximações</span>
                <strong>{semanticLinkCount}</strong>
                <small>por contexto forte</small>
              </div>
              <div className="brain-stat-card">
                <span>Mensagens</span>
                <strong>{activeMessages.length}</strong>
                <small>na conversa</small>
              </div>
            </div>

            <div className="brain-detail">
              <div className="brain-section-label">
                <Network size={13} />
                <span>Nó selecionado</span>
                {selectedNode && <small>{KIND_LABEL[selectedNode.kind]}</small>}
              </div>
              {selectedNode ? (
                <>
                  <strong>
                    {selectedNode.isCore && <LockKeyhole size={14} />}
                    {selectedNode.label}
                  </strong>
                  <p>{selectedNode.summary}</p>
                  <div className="memory-meta-grid">
                    <small>Origem: {selectedNode.source}</small>
                    <small>Data: {formatShortDate(selectedNode.createdAt)}</small>
                    <small>Peso: {selectedNode.weight}</small>
                    <small>Tipo: {KIND_LABEL[selectedNode.kind]}</small>
                  </div>
                  {renderMemoryActions()}
                </>
              ) : (
                <p>Selecione um nó no grafo para ver detalhes.</p>
              )}
            </div>

            {recentLearning.length > 0 && (
              <div className="recent-learning-strip">
                <div className="brain-section-label">
                  <Sparkles size={13} />
                  <span>Atividade recente</span>
                  <small>{recentLearning.length} eventos</small>
                </div>
                {recentLearning.map(item => (
                  <div key={item.id}>
                    <Sparkles size={13} />
                    <strong>{item.label}</strong>
                    <p>{item.text}</p>
                    <small>{formatShortDate(item.date)}</small>
                  </div>
                ))}
              </div>
            )}

            <div className="learned-source-list">
              <div className="brain-section-label">
                <Database size={13} />
                <span>Memórias salvas</span>
                <small>{cognitiveMemories.length} registros</small>
              </div>
              {cognitiveMemories.length ? cognitiveMemories.slice(0, 8).map(memory => (
                <button key={memory.id} type="button" onClick={() => setSelectedId(`memoria-${memory.id}`)}>
                  {memory.is_core ? <LockKeyhole size={14} /> : <Database size={14} />}
                  <span>
                    <strong>{compactLabel(memory.content, `Memória ${memory.memory_type}`, 86)}</strong>
                    <small>
                      <span className={`memory-type-badge type-${memory.memory_type}`}>
                        {memory.is_core ? 'core' : memory.memory_type}
                      </span>
                      {' '}· {Math.round((memory.importance ?? 0) * 100)}% força visual
                    </small>
                  </span>
                </button>
              )) : (
                <p>Nenhuma memória cognitiva salva ainda.</p>
              )}
            </div>

            <div className="learned-source-list">
              <div className="brain-section-label">
                <FileText size={13} />
                <span>Documentos indexados</span>
                <small>{knowledgeSources.length} fontes</small>
              </div>
              {knowledgeSources.length ? knowledgeSources.slice(0, 6).map(source => (
                <button key={source.id} type="button" onClick={() => setSelectedId(`fonte-${source.id}`)}>
                  <FileText size={14} />
                  <span>
                    <strong>{getLearningTitle(source)}</strong>
                    <small>
                      <span className="memory-type-badge type-source">{source.source_type}</span>
                      {source.topics?.length ? ` · ${source.topics.slice(0, 3).join(' · ')}` : ''}
                    </small>
                  </span>
                </button>
              )) : (
                <p>Nenhum documento importado ainda.</p>
              )}
            </div>

            <div className="concept-list">
              <div className="brain-section-label">
                <ScanSearch size={13} />
                <span>Índice de nós</span>
                <small>top {Math.min(graphData.nodes.length, 10)}</small>
              </div>
              {graphData.nodes.slice(0, 10).map(node => (
                <button
                  key={node.id}
                  type="button"
                  className={selectedId === node.id ? 'is-active' : ''}
                  onClick={() => setSelectedId(node.id)}
                >
                  <span>{node.label}</span>
                  <strong>{node.weight}</strong>
                </button>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
