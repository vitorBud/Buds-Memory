import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import * as THREE from 'three'
import {
  Activity,
  BarChart3,
  BrainCircuit,
  CalendarDays,
  Database,
  FileText,
  GitBranch,
  Layers3,
  LockKeyhole,
  MousePointer2,
  Network,
  Pin,
  Radio,
  ScanSearch,
  Sparkles,
  Trash2,
  X,
  ZoomIn,
} from 'lucide-react'
import { deleteCognitiveMemory, setCoreMemory, updateCognitiveMemory } from '../services/api'
import type { CognitiveMemory, KnowledgeGraph, KnowledgeSource, Message } from '../types'

interface BrainMapProps {
  messages: Message[]
  knowledgeSources?: KnowledgeSource[]
  cognitiveMemories?: CognitiveMemory[]
  knowledgeGraph?: KnowledgeGraph | null
  onRefresh?: () => Promise<void> | void
}

type MemoryKind = 'fonte' | 'memoria' | 'entidade' | 'topico' | 'sistema'
type MemoryPeriod = 'today' | 'yesterday' | 'week' | 'month' | 'all'

interface MemoryNode {
  id: string
  label: string
  summary: string
  kind: MemoryKind
  weight: number
  angle: number
  radius: number
  x: number
  y: number
  z: number
  createdAt: Date
  source: string
  tags: string[]
  memoryId?: number
  isCore?: boolean
  locked?: boolean
  originType?: string | null
}

type SelectableNodeMesh = THREE.Mesh<THREE.SphereGeometry, THREE.MeshStandardMaterial> & {
  userData: { nodeId: string }
}

type MemoryLabelSprite = THREE.Sprite & {
  material: THREE.SpriteMaterial
  userData: { nodeId: string; baseOpacity: number; baseScaleX: number; baseScaleY: number }
}

const STOP_WORDS = new Set([
  'para', 'como', 'uma', 'com', 'que', 'por', 'mais', 'menos', 'isso', 'esse',
  'essa', 'esta', 'está', 'ser', 'ter', 'das', 'dos', 'nas', 'nos', 'não',
  'nao', 'meu', 'minha', 'seu', 'sua', 'sobre', 'apenas', 'agora', 'quando',
  'onde', 'porque', 'qual', 'quais', 'cada', 'toda', 'todo', 'voce', 'você',
  'texto', 'documento', 'arquivo', 'pagina', 'página', 'conteudo', 'conteúdo',
  'trechos', 'material', 'fornecido', 'informacoes', 'informações', 'especificas',
  'específicas', 'parte', 'partir', 'fonte', 'fontes', 'resumo', 'contexto',
])

const TOPIC_ALIASES: Record<string, string> = {
  api: 'APIs',
  apis: 'APIs',
  backend: 'backend',
  banco: 'banco de dados',
  classe: 'classes',
  classes: 'classes',
  codigo: 'código',
  dados: 'dados',
  database: 'banco de dados',
  desenvolvimento: 'desenvolvimento',
  frontend: 'frontend',
  funcao: 'funções',
  funcoes: 'funções',
  flask: 'Flask',
  javascript: 'JavaScript',
  modelo: 'modelo de IA',
  modelos: 'modelos de IA',
  programacao: 'programação',
  python: 'Python',
  react: 'React',
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
  topico: 'Conceito',
  sistema: 'Sistema',
}

const KIND_COLOR: Record<MemoryKind, string> = {
  fonte: '#d6a63d',
  memoria: '#d7f7ff',
  entidade: '#c7b8ff',
  topico: '#7da7ff',
  sistema: '#cfd7e6',
}

function normalize(text: string) {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
}

function compactLabel(text: string, fallback: string, limit = 72) {
  const clean = text.replace(/\s+/g, ' ').trim()
  if (!clean) return fallback
  return clean.length > limit ? `${clean.slice(0, limit - 3).trim()}...` : clean
}

function getTopics(text: string, limit = 5) {
  const counts = new Map<string, number>()
  normalize(text)
    .split(/\s+/)
    .filter(word => word.length > 3 && !STOP_WORDS.has(word) && !word.includes('-'))
    .forEach(word => counts.set(word, (counts.get(word) ?? 0) + 1))

  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([word]) => word)
}

function prettifyTopic(topic: string) {
  const clean = normalize(topic).replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim()
  if (!clean || clean.length < 3 || STOP_WORDS.has(clean)) return ''
  return TOPIC_ALIASES[clean] ?? clean.replace(/\b\w/g, char => char.toUpperCase())
}

function getLearningTitle(source: KnowledgeSource) {
  const candidates = [
    ...(source.topics ?? []),
    ...getTopics(`${source.summary} ${source.title}`, 6),
  ]
  const topics = [...new Set(candidates.map(prettifyTopic).filter(Boolean))].slice(0, 3)

  if (topics.length === 1) return `Aprendizado sobre ${topics[0]}`
  if (topics.length > 1) {
    return `Aprendizado: ${topics.slice(0, -1).join(', ')} e ${topics[topics.length - 1]}`
  }

  return compactLabel(source.title || source.summary, 'Conhecimento importado', 58)
}

function parseDate(value?: string | null, fallbackOffset = 0) {
  const parsed = value ? new Date(value) : null
  if (parsed && !Number.isNaN(parsed.getTime())) return parsed
  return new Date(Date.now() - fallbackOffset)
}

function buildBaseMemoryNodes(): Omit<MemoryNode, 'angle' | 'radius' | 'x' | 'y' | 'z'>[] {
  return [
    {
      id: 'sistema-contexto',
      label: 'Contexto da conversa',
      summary: 'Memória inicial aguardando mensagens e arquivos.',
      kind: 'sistema',
      weight: 8,
      createdAt: new Date(),
      source: 'Nexus Core',
      tags: ['contexto', 'sessão'],
    },
    {
      id: 'sistema-pdfs',
      label: 'PDFs importados',
      summary: 'Quando você importar PDFs, cada um vira um ponto vivo no grafo.',
      kind: 'sistema',
      weight: 7,
      createdAt: new Date(),
      source: 'Vault',
      tags: ['pdf', 'documentos'],
    },
    {
      id: 'sistema-pesquisas',
      label: 'Pesquisas salvas',
      summary: 'Pesquisas e páginas entram como conhecimento navegável.',
      kind: 'sistema',
      weight: 7,
      createdAt: new Date(),
      source: 'Web',
      tags: ['google', 'web'],
    },
    {
      id: 'sistema-topicos',
      label: 'Tópicos aprendidos',
      summary: 'Os principais tópicos aparecem como ramificações do núcleo.',
      kind: 'sistema',
      weight: 7,
      createdAt: new Date(),
      source: 'Nexus Core',
      tags: ['aprendizado', 'conceitos'],
    },
  ]
}

function positionNodes(nodes: Omit<MemoryNode, 'angle' | 'radius' | 'x' | 'y' | 'z'>[]): MemoryNode[] {
  const total = Math.max(nodes.length, 1)

  return nodes.map((node, index) => {
    const ring = index % 5
    const angle = index * 2.399963 + ring * 0.2
    const radius = 1.35 + ring * 0.42 + Math.floor(index / 5) * 0.045 + Math.min(node.weight, 12) * 0.04
    const vertical = Math.sin(index * 1.71) * (0.45 + ring * 0.06)

    return {
      ...node,
      angle,
      radius,
      x: Math.cos(angle) * radius,
      y: vertical,
      z: Math.sin(angle) * radius * 0.78,
      weight: node.weight + Math.round((index / total) * 2),
    }
  })
}

function buildMemoryNodes(
  sources: KnowledgeSource[],
  cognitiveMemories: CognitiveMemory[] = [],
  graph?: KnowledgeGraph | null,
): MemoryNode[] {
  const nodes: Omit<MemoryNode, 'angle' | 'radius' | 'x' | 'y' | 'z'>[] = buildBaseMemoryNodes()

  sources.forEach((source, sourceIndex) => {
    const createdAt = parseDate(source.created_at, sourceIndex * 86_400_000)
    const sourceText = `${source.title} ${source.summary} ${(source.topics ?? []).join(' ')}`
    const learnedTitle = getLearningTitle(source)
    const topicTags = [...new Set([...(source.topics ?? []), ...getTopics(sourceText, 4)])]
      .map(prettifyTopic)
      .filter(Boolean)
      .slice(0, 7)
    const tags = [...new Set([source.source_type, ...topicTags])].slice(0, 8)

    nodes.push({
      id: `fonte-${source.id}`,
      label: learnedTitle,
      summary: source.summary || `A IA aprendeu conteúdos relacionados a ${learnedTitle}.`,
      kind: 'fonte',
      weight: 12 + Math.min(source.topics?.length ?? 0, 10),
      createdAt,
      source: source.source_name || source.source_type,
      tags,
    })

    topicTags.slice(0, 7).forEach((topic, topicIndex) => {
      nodes.push({
        id: `topico-${source.id}-${topic}`,
        label: compactLabel(topic, 'Tópico aprendido', 48),
        summary: `Tópico aprendido em ${learnedTitle}.`,
        kind: 'topico',
        weight: 6 + (topicIndex % 3),
        createdAt,
        source: learnedTitle,
        tags: [source.source_type, topic],
      })
    })
  })

  // Memórias cognitivas — somente acima do limiar de relevância
  cognitiveMemories
    .filter(memory => (memory.importance ?? 0) >= 0.4)
    .forEach((memory, memoryIndex) => {
    const createdAt = parseDate(memory.created_at || memory.last_accessed, memoryIndex * 3_600_000)
    const tags = [...new Set([memory.memory_type, ...(memory.tags ?? []), ...getTopics(memory.content, 4)])]
      .map(prettifyTopic)
      .filter(Boolean)
      .slice(0, 8)
    const importance = Number.isFinite(memory.importance) ? memory.importance : 0.5

    nodes.push({
      id: `memoria-${memory.id}`,
      label: compactLabel(memory.content, memory.is_core ? 'Core Memory' : `Memória ${memory.memory_type}`, 68),
      summary: memory.content,
      kind: 'memoria',
      weight: (memory.is_core ? 18 : 9) + Math.round(importance * 8) + Math.min(memory.access_count ?? 0, 4),
      createdAt,
      source: memory.origin_type ? `Origem: ${memory.origin_type}` : `Memória ${memory.memory_type}`,
      tags,
      memoryId: memory.id,
      isCore: Boolean(memory.is_core),
      locked: Boolean(memory.locked),
      originType: memory.origin_type,
    })
  })

  // Entidades do grafo cognitivo — somente confirmadas (importance >= 0.5, access >= 1)
  ;(graph?.entities ?? [])
    .filter(entity => (entity.importance ?? 0) >= 0.5 && (entity.access_count ?? 0) >= 1)
    .slice(0, 50)
    .forEach((entity, entityIndex) => {
    const createdAt = parseDate(entity.last_seen || entity.first_seen, entityIndex * 5_400_000)
    const entityTags = [entity.entity_type, ...getTopics(`${entity.name} ${entity.description ?? ''}`, 4)]
      .map(prettifyTopic)
      .filter(Boolean)
      .slice(0, 6)
    const importance = Number.isFinite(entity.importance) ? entity.importance : 0.5

    nodes.push({
      id: `entidade-${entity.id}`,
      label: compactLabel(prettifyTopic(entity.name) || entity.name, 'Conceito salvo', 54),
      summary: entity.description || `Conceito detectado e salvo no grafo cognitivo: ${entity.name}.`,
      kind: 'entidade',
      weight: 7 + Math.round(importance * 8) + Math.min(entity.access_count ?? 0, 4),
      createdAt,
      source: 'Grafo cognitivo',
      tags: entityTags,
    })
  })

  // Mensagens brutas NÃO entram no Obsidian.
  // O grafo representa conhecimento adquirido, não histórico de chat.

  return positionNodes(nodes.slice(0, 80))
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
  return date.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })
}

function makeLabelLines(text: string) {
  const clean = compactLabel(text, 'Memória', 44)
  const words = clean.split(/\s+/)
  const lines: string[] = []
  let current = ''

  words.forEach(word => {
    const next = current ? `${current} ${word}` : word
    if (next.length > 21 && current) {
      lines.push(current)
      current = word
    } else {
      current = next
    }
  })

  if (current) lines.push(current)
  return lines.slice(0, 2)
}

function createTextLabelSprite(node: MemoryNode, color: THREE.Color, textColor: THREE.Color): MemoryLabelSprite {
  const lines = makeLabelLines(node.label)
  const canvas = document.createElement('canvas')
  const context = canvas.getContext('2d')
  const pixelRatio = Math.min(window.devicePixelRatio || 1, 2)
  const fontSize = 25
  const paddingX = 18
  const paddingY = 10
  const lineHeight = 29

  if (!context) {
    const fallbackTexture = new THREE.CanvasTexture(canvas)
    const fallbackMaterial = new THREE.SpriteMaterial({ map: fallbackTexture, transparent: true, opacity: 0.55 })
    const fallback = new THREE.Sprite(fallbackMaterial) as MemoryLabelSprite
    fallback.userData = { nodeId: node.id, baseOpacity: 0.55, baseScaleX: 0.5, baseScaleY: 0.18 }
    return fallback
  }

  context.font = `700 ${fontSize}px -apple-system, BlinkMacSystemFont, "SF Pro Display", Inter, sans-serif`
  const textWidth = Math.max(...lines.map(line => context.measureText(line).width), 72)
  const width = Math.ceil((textWidth + paddingX * 2) * pixelRatio)
  const height = Math.ceil((paddingY * 2 + lineHeight * lines.length) * pixelRatio)
  canvas.width = width
  canvas.height = height

  context.scale(pixelRatio, pixelRatio)
  context.font = `700 ${fontSize}px -apple-system, BlinkMacSystemFont, "SF Pro Display", Inter, sans-serif`
  context.textAlign = 'center'
  context.textBaseline = 'middle'

  const cssWidth = width / pixelRatio
  const cssHeight = height / pixelRatio
  const radius = 14
  context.beginPath()
  context.roundRect(0.5, 0.5, cssWidth - 1, cssHeight - 1, radius)
  context.fillStyle = `rgba(${Math.round(textColor.r * 255)}, ${Math.round(textColor.g * 255)}, ${Math.round(textColor.b * 255)}, 0.12)`
  context.fill()
  context.strokeStyle = `rgba(${Math.round(color.r * 255)}, ${Math.round(color.g * 255)}, ${Math.round(color.b * 255)}, 0.38)`
  context.lineWidth = 1
  context.stroke()

  lines.forEach((line, index) => {
    const y = paddingY + lineHeight * index + lineHeight / 2
    context.lineWidth = 5
    context.strokeStyle = 'rgba(0, 0, 0, 0.5)'
    context.strokeText(line, cssWidth / 2, y)
    context.fillStyle = `rgba(${Math.round(textColor.r * 255)}, ${Math.round(textColor.g * 255)}, ${Math.round(textColor.b * 255)}, 0.92)`
    context.fillText(line, cssWidth / 2, y)
  })

  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.needsUpdate = true

  const material = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    opacity: 0.46,
    depthWrite: false,
    depthTest: false,
  })
  const sprite = new THREE.Sprite(material) as MemoryLabelSprite
  const worldWidth = Math.min(1.24, Math.max(0.52, cssWidth / 155))
  const worldHeight = worldWidth * (cssHeight / cssWidth)
  sprite.scale.set(worldWidth, worldHeight, 1)
  sprite.userData = {
    nodeId: node.id,
    baseOpacity: node.kind === 'fonte' || node.kind === 'memoria' ? 0.62 : 0.42,
    baseScaleX: worldWidth,
    baseScaleY: worldHeight,
  }
  return sprite
}

function ThreeMemoryGraph({
  nodes,
  selectedId,
  thoughtMode,
  onSelect,
}: {
  nodes: MemoryNode[]
  selectedId: string
  thoughtMode: boolean
  onSelect: (id: string) => void
}) {
  const mountRef = useRef<HTMLDivElement>(null)
  const selectedIdRef = useRef(selectedId)
  const onSelectRef = useRef(onSelect)

  useEffect(() => {
    selectedIdRef.current = selectedId
  }, [selectedId])

  useEffect(() => {
    onSelectRef.current = onSelect
  }, [onSelect])

  useEffect(() => {
    const mount = mountRef.current
    if (!mount) return
    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(48, 1, 0.1, 100)
    camera.position.set(0, 0.65, 7.2)

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.25))
    renderer.setClearColor(0x000000, 0)
    renderer.domElement.style.touchAction = 'none'
    renderer.domElement.style.pointerEvents = 'auto'
    mount.appendChild(renderer.domElement)

    // Ocultar barras de rolagem nativas para evitar que o mouse cause scroll em vez de zoom
    mount.style.overflow = 'hidden'

    // O target real onde os eventos de mouse vão disparar é o próprio canvas
    const eventTarget = renderer.domElement

    const root = new THREE.Group()
    const nodesGroup = new THREE.Group()
    const labelsGroup = new THREE.Group()
    const flowGroup = new THREE.Group()
    const ambientParticles = new THREE.Group()
    root.rotation.x = -0.18
    root.position.y = 0.45
    scene.add(root)
    root.add(flowGroup, nodesGroup, labelsGroup, ambientParticles)

    const style = getComputedStyle(document.documentElement)
    const accentHot = new THREE.Color(style.getPropertyValue('--accent-hot').trim() || '#ffffff')
    const accent = new THREE.Color(style.getPropertyValue('--accent').trim() || '#dbe4ef')
    const textColor = new THREE.Color(style.getPropertyValue('--text').trim() || '#111827')

    const disposables: Array<{ dispose: () => void }> = []
    const selectableMeshes: SelectableNodeMesh[] = []
    const labelSprites: MemoryLabelSprite[] = []

    scene.add(new THREE.AmbientLight(0xffffff, 1.2))
    const keyLight = new THREE.PointLight(accentHot, 5.6, 24)
    keyLight.position.set(0, 2.8, 4.6)
    scene.add(keyLight)
    const sideLight = new THREE.PointLight(accent, 2.4, 18)
    sideLight.position.set(-4, -1, 3)
    scene.add(sideLight)

    const coreGeometry = new THREE.SphereGeometry(0.42, 48, 48)
    const coreMaterial = new THREE.MeshPhysicalMaterial({
      color: accentHot,
      emissive: accentHot,
      emissiveIntensity: 0.28,
      metalness: 0.08,
      roughness: 0.12,
      transmission: 0.58,
      transparent: true,
      opacity: 0.68,
      clearcoat: 1,
      clearcoatRoughness: 0.08,
    })
    disposables.push(coreGeometry, coreMaterial)
    const core = new THREE.Mesh(coreGeometry, coreMaterial)
    root.add(core)

    const haloGeometry = new THREE.SphereGeometry(0.88, 40, 40)
    const haloMaterial = new THREE.MeshBasicMaterial({
      color: accentHot,
      transparent: true,
      opacity: 0.08,
      wireframe: true,
      blending: THREE.AdditiveBlending,
    })
    disposables.push(haloGeometry, haloMaterial)
    root.add(new THREE.Mesh(haloGeometry, haloMaterial))

    const ringMaterial = new THREE.LineBasicMaterial({
      color: accentHot,
      transparent: true,
      opacity: 0.13,
      blending: THREE.AdditiveBlending,
    })
    disposables.push(ringMaterial)
    for (let index = 0; index < 7; index += 1) {
      const geometry = new THREE.TorusGeometry(1.1 + index * 0.42, 0.003, 6, 112)
      disposables.push(geometry)
      const ring = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({
        color: index % 2 ? accent : accentHot,
        transparent: true,
        opacity: 0.11,
        blending: THREE.AdditiveBlending,
      }))
      disposables.push(ring.material)
      ring.rotation.x = Math.PI / 2 + index * 0.035
      ring.rotation.y = index * 0.16
      ring.userData = { speed: 0.001 + index * 0.0002 }
      root.add(ring)
    }

    const pointCount = Math.max(360, nodes.length * 8)
    const particlePositions = new Float32Array(pointCount * 3)
    for (let index = 0; index < pointCount; index += 1) {
      const angle = index * 2.399963
      const radius = 1.2 + Math.random() * 4.4
      particlePositions[index * 3] = Math.cos(angle) * radius
      particlePositions[index * 3 + 1] = (Math.random() - 0.5) * 2.5
      particlePositions[index * 3 + 2] = Math.sin(angle) * radius
    }
    const particleGeometry = new THREE.BufferGeometry()
    particleGeometry.setAttribute('position', new THREE.BufferAttribute(particlePositions, 3))
    const particleMaterial = new THREE.PointsMaterial({
      color: accentHot,
      size: 0.012,
      sizeAttenuation: true,
      transparent: true,
      opacity: 0.32,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    })
    disposables.push(particleGeometry, particleMaterial)
    ambientParticles.add(new THREE.Points(particleGeometry, particleMaterial))

    const linePositions: number[] = []
    const thoughtPositions: number[] = []
    nodes.forEach((node, index) => {
      const color = new THREE.Color(KIND_COLOR[node.kind])
      const size = 0.055 + Math.min(node.weight, 16) * 0.008
      const geometry = new THREE.SphereGeometry(size, 12, 12)
      const material = new THREE.MeshStandardMaterial({
        color,
        emissive: color,
        emissiveIntensity: node.id === selectedIdRef.current ? 0.72 : 0.22,
        metalness: 0.02,
        roughness: 0.34,
        transparent: true,
        opacity: node.id === selectedIdRef.current ? 0.96 : 0.72,
      })
      disposables.push(geometry, material)
      const mesh = new THREE.Mesh(geometry, material) as unknown as SelectableNodeMesh
      mesh.position.set(node.x, node.y, node.z)
      mesh.userData = { nodeId: node.id }
      nodesGroup.add(mesh)
      selectableMeshes.push(mesh)

      const label = createTextLabelSprite(node, color, textColor)
      const labelLift = size + 0.16 + (index % 3) * 0.018
      label.position.set(node.x, node.y + labelLift, node.z)
      labelsGroup.add(label)
      labelSprites.push(label)
      if (label.material.map) disposables.push(label.material.map)
      disposables.push(label.material)

      linePositions.push(0, 0, 0, node.x, node.y, node.z)

      if (thoughtMode && index < Math.min(8, nodes.length)) {
        const previous = index === 0 ? { x: 0, y: 0, z: 0 } : nodes[index - 1]
        thoughtPositions.push(previous.x, previous.y, previous.z, node.x, node.y, node.z)
      }
    })

    const lineGeometry = new THREE.BufferGeometry()
    lineGeometry.setAttribute('position', new THREE.Float32BufferAttribute(linePositions, 3))
    const lineMaterial = new THREE.LineBasicMaterial({
      color: textColor,
      transparent: true,
      opacity: 0.2,
      blending: THREE.AdditiveBlending,
    })
    disposables.push(lineGeometry, lineMaterial)
    flowGroup.add(new THREE.LineSegments(lineGeometry, lineMaterial))

    let thoughtLine: THREE.LineSegments<THREE.BufferGeometry, THREE.LineBasicMaterial> | null = null
    if (thoughtPositions.length) {
      const geometry = new THREE.BufferGeometry()
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(thoughtPositions, 3))
      const material = new THREE.LineBasicMaterial({
        color: accentHot,
        transparent: true,
        opacity: 0.82,
        blending: THREE.AdditiveBlending,
      })
      disposables.push(geometry, material)
      thoughtLine = new THREE.LineSegments(geometry, material)
      root.add(thoughtLine)
    }

    const resize = () => {
      const width = Math.max(mount.clientWidth, 320)
      const height = Math.max(mount.clientHeight, 320)
      camera.aspect = width / height
      camera.updateProjectionMatrix()
      renderer.setSize(width, height)
    }
    resize()
    const observer = new ResizeObserver(resize)
    observer.observe(mount)

    const raycaster = new THREE.Raycaster()
    const pointer = new THREE.Vector2()
    let dragging = false
    let moved = false
    let startX = 0
    let startY = 0
    let targetRotY = root.rotation.y
    let targetRotX = root.rotation.x
    let idleVelocity = 0.0019

    const setPointer = (event: PointerEvent) => {
      const rect = renderer.domElement.getBoundingClientRect()
      pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1
      pointer.y = -(((event.clientY - rect.top) / rect.height) * 2 - 1)
    }

    const onPointerDown = (event: PointerEvent) => {
      dragging = true
      idleVelocity = 0.0004
      moved = false
      startX = event.clientX
      startY = event.clientY
      try {
        eventTarget.setPointerCapture(event.pointerId)
      } catch {
        /* pointer capture can fail if the event began on a composed child */
      }
    }

    const onPointerMove = (event: PointerEvent) => {
      if (!dragging) return
      const dx = event.clientX - startX
      const dy = event.clientY - startY
      if (Math.abs(dx) + Math.abs(dy) > 6) moved = true
      startX = event.clientX
      startY = event.clientY
      targetRotY += dx * 0.006
      targetRotX += dy * 0.003
      targetRotX = Math.max(-0.92, Math.min(0.42, targetRotX))
    }

    const onPointerUp = (event: PointerEvent) => {
      dragging = false
      idleVelocity = 0.0019
      if (eventTarget.hasPointerCapture(event.pointerId)) {
        eventTarget.releasePointerCapture(event.pointerId)
      }
      if (moved) return
      setPointer(event)
      raycaster.setFromCamera(pointer, camera)
      const hit = raycaster.intersectObjects(selectableMeshes, false)[0]
      const nodeId = hit?.object.userData.nodeId
      if (nodeId) onSelectRef.current(nodeId)
    }

    const onWheel = (event: WheelEvent) => {
      event.preventDefault()
      event.stopPropagation()
      const delta = Math.sign(event.deltaY) * Math.min(Math.abs(event.deltaY), 120)
      camera.position.z = Math.max(3.5, Math.min(11.5, camera.position.z + delta * 0.01))
    }

    eventTarget.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', onPointerUp)
    window.addEventListener('pointercancel', onPointerUp)
    eventTarget.addEventListener('wheel', onWheel, { passive: false })

    let frame = 0
    let animationId = 0
    const animate = () => {
      frame += 1
      if (!dragging) {
        targetRotY += idleVelocity
        targetRotX += Math.sin(frame * 0.003) * 0.0002
      }
      root.rotation.y += (targetRotY - root.rotation.y) * 0.08
      root.rotation.x += (targetRotX - root.rotation.x) * 0.08
      root.rotation.z = Math.sin(frame * 0.006) * 0.025
      core.scale.setScalar(1 + Math.sin(frame * 0.04) * 0.06)
      ambientParticles.rotation.y += 0.0009
      ambientParticles.rotation.x = Math.sin(frame * 0.004) * 0.08
      flowGroup.rotation.y -= 0.0007
      if (thoughtLine) thoughtLine.material.opacity = 0.48 + Math.sin(frame * 0.05) * 0.26

      selectableMeshes.forEach(mesh => {
        const material = mesh.material
        const active = mesh.userData.nodeId === selectedIdRef.current
        const targetOpacity = active ? 0.96 : 0.72
        const targetIntensity = active ? 0.72 : 0.22
        material.opacity += (targetOpacity - material.opacity) * 0.12
        material.emissiveIntensity += (targetIntensity - material.emissiveIntensity) * 0.12
        mesh.scale.setScalar(active ? 1.22 : 1)
      })

      labelSprites.forEach(sprite => {
        const active = sprite.userData.nodeId === selectedIdRef.current
        const targetOpacity = active ? 0.98 : sprite.userData.baseOpacity
        const targetScale = active ? 1.16 : 1
        sprite.material.opacity += (targetOpacity - sprite.material.opacity) * 0.12
        sprite.scale.x += (sprite.userData.baseScaleX * targetScale - sprite.scale.x) * 0.12
        sprite.scale.y += (sprite.userData.baseScaleY * targetScale - sprite.scale.y) * 0.12
        sprite.visible = camera.position.distanceTo(sprite.position) < 12
        sprite.renderOrder = active ? 4 : 2
      })

      root.children.forEach(child => {
        if (child instanceof THREE.Mesh && child.geometry.type === 'TorusGeometry') {
          child.rotation.z += (child.userData.speed ?? 0.001)
        }
      })

      renderer.render(scene, camera)
      animationId = window.requestAnimationFrame(animate)
    }
    animate()

    return () => {
      window.cancelAnimationFrame(animationId)
      observer.disconnect()
      eventTarget.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', onPointerUp)
      window.removeEventListener('pointercancel', onPointerUp)
      eventTarget.removeEventListener('wheel', onWheel)
      renderer.dispose()
      disposables.forEach(item => item.dispose())
      if (mount.contains(renderer.domElement)) mount.removeChild(renderer.domElement)
    }
  }, [nodes, thoughtMode])

  return <div ref={mountRef} className="memory-three-canvas" aria-label="Mapa neural 3D interativo" />
}

// Mapa Obsidian do cérebro da IA: memórias, fontes e raciocínio em uma cena 3D interativa.
export function BrainMap({
  messages,
  knowledgeSources = [],
  cognitiveMemories = [],
  knowledgeGraph = null,
  onRefresh,
}: BrainMapProps) {
  const allNodes = useMemo(
    () => buildMemoryNodes(knowledgeSources, cognitiveMemories, knowledgeGraph),
    [knowledgeSources, cognitiveMemories, knowledgeGraph],
  )
  const [selectedId, setSelectedId] = useState(allNodes[0]?.id ?? 'sistema-contexto')
  const [isStatsOpen, setIsStatsOpen] = useState(false)
  const [period, setPeriod] = useState<MemoryPeriod>('all')
  const [thoughtMode, setThoughtMode] = useState(false)
  const [memoryAction, setMemoryAction] = useState<string | null>(null)
  const [memoryError, setMemoryError] = useState('')
  const nodes = useMemo(() => filterNodesByPeriod(allNodes, period), [allNodes, period])
  const visibleNodes = nodes.length ? nodes : allNodes.slice(0, 8)
  const selectedNode = visibleNodes.find(node => node.id === selectedId) ?? visibleNodes[0]
  const selectedMemory = selectedNode?.memoryId
    ? cognitiveMemories.find(memory => memory.id === selectedNode.memoryId)
    : null
  const handleSelectNode = useCallback((id: string) => setSelectedId(id), [])
  const activeMessages = messages.filter(message => message.text !== '__thinking__')
  const learnedCount = knowledgeSources.length
  const savedMemoryCount = cognitiveMemories.length
  const graphEntityCount = knowledgeGraph?.entities.length ?? 0
  const graphEdgeCount = knowledgeGraph?.edges.length ?? 0
  const memoryLoad = Math.min(100, Math.round((allNodes.length / 72) * 100))
  const sourceTopics = knowledgeSources.flatMap(source => source.topics ?? []).slice(0, 12)
  const totalConnections = Math.max(allNodes.length * 3, sourceTopics.length + activeMessages.length + graphEdgeCount)
  const processedTokens = [
    ...messages,
    ...knowledgeSources.map(source => ({ text: source.summary })),
    ...cognitiveMemories.map(memory => ({ text: memory.content })),
  ]
    .reduce((total, item) => total + Math.ceil((item.text || '').length / 4), 0)

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
      text: compactLabel(prettifyTopic(entity.name) || entity.name, 'Conceito salvo', 96),
      date: parseDate(entity.last_seen || entity.first_seen),
    }))
    const sourceEvents = knowledgeSources.slice(0, 4).map(source => ({
      id: `source-${source.id}`,
      label: 'Documento indexado',
      text: getLearningTitle(source),
      date: parseDate(source.created_at),
    }))
    const nodeEvents = allNodes.slice(0, 5).map(node => ({
      id: `node-${node.id}`,
      label: node.kind === 'topico' ? 'Relação criada' : node.kind === 'memoria' ? 'Memória criada' : 'Conhecimento consolidado',
      text: node.label,
      date: node.createdAt,
    }))
    return [...memoryEvents, ...entityEvents, ...sourceEvents, ...nodeEvents]
      .sort((a, b) => b.date.getTime() - a.date.getTime())
      .slice(0, 6)
  }, [allNodes, cognitiveMemories, knowledgeGraph, knowledgeSources])

  useEffect(() => {
    if (!visibleNodes.some(node => node.id === selectedId)) {
      window.queueMicrotask(() => {
        setSelectedId(visibleNodes[0]?.id ?? allNodes[0]?.id ?? 'sistema-contexto')
      })
    }
  }, [allNodes, selectedId, visibleNodes])

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
    void runMemoryAction('excluindo', async () => {
      await deleteCognitiveMemory(selectedMemory.id, Boolean(selectedMemory.is_core || selectedMemory.locked))
      setSelectedId('sistema-contexto')
    })
  }, [runMemoryAction, selectedMemory])

  const handleImportanceChange = useCallback((nextImportance: number) => {
    if (!selectedMemory) return
    void runMemoryAction('salvando', async () => {
      await updateCognitiveMemory(selectedMemory.id, { importance: nextImportance })
    })
  }, [runMemoryAction, selectedMemory])

  return (
    <div className="brain-card memory-brain-card">
      <div className="brain-card-header obsidian-glass-hud">
        <div>
          <span className="eyebrow">Nexus · Second Brain</span>
          <strong>Mapa cognitivo</strong>
        </div>
        <div className="brain-header-actions">
          <span><Radio size={12} /> ao vivo</span>
          <span><GitBranch size={12} /> {visibleNodes.length} nós</span>
          <button
            type="button"
            className={thoughtMode ? 'is-active' : ''}
            onClick={() => setThoughtMode(value => !value)}
            title="Modo pensamento — traça o caminho de raciocínio"
          >
            <BrainCircuit size={14} />
          </button>
          <button type="button" onClick={() => setIsStatsOpen(true)} title="Abrir painel de memória">
            <BarChart3 size={14} />
          </button>
        </div>
      </div>

      <div className="obsidian-timeline obsidian-glass-hud" aria-label="Filtro por período">
        <div>
          <CalendarDays size={13} />
          <span>Período</span>
        </div>
        {PERIODS.map(option => (
          <button
            key={option.id}
            type="button"
            className={period === option.id ? 'is-active' : ''}
            onClick={() => setPeriod(option.id)}
          >
            {option.label}
          </button>
        ))}
      </div>

      <div className="brain-graph memory-three-shell" aria-label="Mapa neural tridimensional de memórias">
          <ThreeMemoryGraph
            nodes={visibleNodes}
            selectedId={selectedNode?.id ?? selectedId}
            thoughtMode={thoughtMode}
            onSelect={handleSelectNode}
          />

        <div className="nexus-core-readout">
          <span>Nexus Core</span>
          <strong>{allNodes.length}</strong>
          <em>nós ativos</em>
        </div>

        <div className="brain-hud memory-hud">
          <span>Selecionado</span>
          <strong>{selectedNode?.label ?? 'Nexus'}</strong>
          <em>{selectedNode ? KIND_LABEL[selectedNode.kind] : 'Sistema'}</em>
        </div>

        <div className="brain-vault-status">
          <Layers3 size={13} />
          <span>Conexões</span>
          <strong>{totalConnections}</strong>
        </div>
      </div>

      <div className="brain-controls obsidian-glass-hud">
        <span><MousePointer2 size={12} /> arrastar · girar</span>
        <span><ZoomIn size={12} /> scroll · zoom</span>
        <button type="button" onClick={() => setIsStatsOpen(true)}>
          <Activity size={12} /> memória da IA
        </button>
      </div>

      <div className="thought-path-panel obsidian-glass-hud">
        <span>Fluxo de raciocínio</span>
        <ol>
          <li className={thoughtMode ? 'is-active' : ''}>Pergunta</li>
          <li className={thoughtMode ? 'is-active' : ''}>Busca</li>
          <li className={thoughtMode ? 'is-active' : ''}>Memórias</li>
          <li className={thoughtMode ? 'is-active' : ''}>Resposta</li>
        </ol>
      </div>

      <AnimatePresence>
        {isStatsOpen && (
          <motion.div
            className="brain-stats-popover"
            role="dialog"
            aria-label="Painel de memória cognitiva"
            initial={{ opacity: 0, x: 28, scale: 0.98 }}
            animate={{ opacity: 1, x: 0, scale: 1 }}
            exit={{ opacity: 0, x: 28, scale: 0.98 }}
            transition={{ duration: 0.18, ease: 'easeOut' }}
          >
            {/* ── Cabeçalho ─────────────────────────────────────────── */}
            <div className="brain-stats-popover-head">
              <div>
                <span className="eyebrow">Nexus · Second Brain</span>
                <strong>Painel de memória</strong>
              </div>
              <button type="button" onClick={() => setIsStatsOpen(false)} aria-label="Fechar" title="Fechar">
                <X size={16} />
              </button>
            </div>

            {/* ── Perfil do usuário ──────────────────────────────────── */}
            {cognitiveMemories.filter(m => m.memory_type === 'long' || m.is_core).length > 0 && (
              <div className="brain-user-profile-section">
                <div className="brain-section-label">
                  <LockKeyhole size={13} />
                  <span>Perfil salvo</span>
                  <small>{cognitiveMemories.filter(m => m.memory_type === 'long' || m.is_core).length} memórias permanentes</small>
                </div>
                <div className="brain-profile-memories">
                  {cognitiveMemories
                    .filter(m => m.memory_type === 'long' || m.is_core)
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

            {/* ── Métricas principais ────────────────────────────────── */}
            <div className="brain-stats">
              <div className="brain-stat-card">
                <span>Nós totais</span>
                <strong>{allNodes.length}</strong>
                <small>grafo ativo</small>
              </div>
              <div className="brain-stat-card">
                <span>Memórias</span>
                <strong>{savedMemoryCount}</strong>
                <small>banco cognitivo</small>
              </div>
              <div className="brain-stat-card">
                <span>Docs</span>
                <strong>{learnedCount}</strong>
                <small>importados</small>
              </div>
              <div className="brain-stat-card">
                <span>Conceitos</span>
                <strong>{graphEntityCount}</strong>
                <small>no grafo</small>
              </div>
              <div className="brain-stat-card">
                <span>Relações</span>
                <strong>{graphEdgeCount}</strong>
                <small>cognitivas</small>
              </div>
              <div className="brain-stat-card">
                <span>Tokens</span>
                <strong>{processedTokens > 999 ? `${(processedTokens / 1000).toFixed(1)}k` : processedTokens}</strong>
                <small>processados</small>
              </div>
              <div className="brain-stat-card">
                <span>Densidade</span>
                <strong>{memoryLoad}%</strong>
                <small>do mapa</small>
              </div>
              <div className="brain-stat-card">
                <span>Qualidade</span>
                <strong>{Math.min(99, 82 + learnedCount * 3)}%</strong>
                <small>contextual</small>
              </div>
            </div>

            {/* ── Nó selecionado ─────────────────────────────────────── */}
            <div className="brain-detail">
              <div className="brain-section-label">
                <Network size={13} />
                <span>Nó selecionado</span>
                {selectedNode && <small>{KIND_LABEL[selectedNode.kind]}</small>}
              </div>
              <strong>
                {selectedNode?.isCore && <LockKeyhole size={14} />}
                {selectedNode?.label ?? 'Nexus Core'}
              </strong>
              <p>{selectedNode?.summary ?? 'Selecione um nó no grafo para ver detalhes.'}</p>
              <div className="memory-meta-grid">
                <small>Origem: {selectedNode?.source ?? 'Nexus Core'}</small>
                <small>Data: {selectedNode ? formatShortDate(selectedNode.createdAt) : '--'}</small>
                <small>Peso: {selectedNode?.weight ?? 0}</small>
                <small>Tipo: {selectedNode ? KIND_LABEL[selectedNode.kind] : '--'}</small>
              </div>
              {selectedMemory && (
                <div className="memory-curation-actions">
                  <button type="button" onClick={handleToggleCore} disabled={Boolean(memoryAction)}>
                    <Pin size={13} />
                    {selectedMemory.is_core ? 'Desfixar Core' : 'Fixar como Core'}
                  </button>
                  <label>
                    Importância
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
                  <button type="button" className="danger" onClick={handleDeleteMemory} disabled={Boolean(memoryAction)}>
                    <Trash2 size={13} />
                    Excluir
                  </button>
                  {memoryAction && <small>Atualizando...</small>}
                  {memoryError && <small className="error-text">{memoryError}</small>}
                </div>
              )}
            </div>

            {/* ── Sinapses ───────────────────────────────────────────── */}
            <div className="brain-signal-panel">
              <div>
                <Activity size={13} />
                <span>Sinapses</span>
                <strong>{totalConnections}</strong>
              </div>
              <div>
                <Network size={13} />
                <span>Conceitos</span>
                <strong>{graphEntityCount}</strong>
              </div>
              <div>
                <Database size={13} />
                <span>Mensagens</span>
                <strong>{activeMessages.length}</strong>
              </div>
              <div className="brain-signal-bars" aria-hidden="true">
                <span /><span /><span /><span /><span />
              </div>
            </div>

            {/* ── Aprendizados recentes ──────────────────────────────── */}
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

            {/* ── Memórias cognitivas ────────────────────────────────── */}
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
                      {' '}· {Math.round((memory.importance ?? 0) * 100)}% relevância
                    </small>
                  </span>
                </button>
              )) : (
                <p>Nenhuma memória cognitiva salva ainda. Converse com o Nexus para ele começar a aprender.</p>
              )}
            </div>

            {/* ── Fontes importadas ──────────────────────────────────── */}
            <div className="learned-source-list">
              <div className="brain-section-label">
                <FileText size={13} />
                <span>Documentos indexados</span>
                <small>{knowledgeSources.length} fontes</small>
              </div>
              {knowledgeSources.length ? knowledgeSources.slice(0, 6).map(source => {
                const title = getLearningTitle(source)
                const topics = source.topics?.slice(0, 3).join(' · ') || ''
                return (
                  <button key={source.id} type="button" onClick={() => setSelectedId(`fonte-${source.id}`)}>
                    <FileText size={14} />
                    <span>
                      <strong>{title}</strong>
                      <small>
                        <span className="memory-type-badge type-source">{source.source_type}</span>
                        {topics && ` · ${topics}`}
                      </small>
                    </span>
                  </button>
                )
              }) : (
                <p>Nenhum PDF, página ou pesquisa importada. Use o botão ↑ no chat para importar.</p>
              )}
            </div>

            {/* ── Índice de nós ─────────────────────────────────────── */}
            <div className="concept-list">
              <div className="brain-section-label">
                <ScanSearch size={13} />
                <span>Índice de nós</span>
                <small>top {Math.min(allNodes.length, 10)}</small>
              </div>
              {allNodes.slice(0, 10).map(node => (
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
