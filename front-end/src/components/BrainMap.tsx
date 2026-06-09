import { useEffect, useMemo, useRef, useState } from 'react'
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
  MousePointer2,
  Network,
  Radio,
  ScanSearch,
  Sparkles,
  X,
  ZoomIn,
} from 'lucide-react'
import type { KnowledgeSource, Message } from '../types'

interface BrainMapProps {
  messages: Message[]
  knowledgeSources?: KnowledgeSource[]
}

type MemoryKind = 'fonte' | 'mensagem' | 'topico' | 'sistema'
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
}

type SelectableNodeMesh = THREE.Mesh<THREE.SphereGeometry, THREE.MeshPhysicalMaterial> & {
  userData: { nodeId: string }
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
  mensagem: 'Conversa',
  topico: 'Conceito',
  sistema: 'Sistema',
}

const KIND_COLOR: Record<MemoryKind, string> = {
  fonte: '#d6a63d',
  mensagem: '#62c77b',
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

function buildMemoryNodes(messages: Message[], sources: KnowledgeSource[]): MemoryNode[] {
  const nodes: Omit<MemoryNode, 'angle' | 'radius' | 'x' | 'y' | 'z'>[] = []

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

  messages
    .filter(message => message.text !== '__thinking__')
    .slice(-36)
    .forEach((message, index) => {
      const topics = getTopics(message.text, 5)
      nodes.push({
        id: `msg-${message.id ?? index}-${message.sender}`,
        label: compactLabel(topics.join(' · ') || message.text, message.sender === 'user' ? 'Memória do usuário' : 'Memória da IA', 58),
        summary: compactLabel(message.text, 'Registro de conversa', 180),
        kind: 'mensagem',
        weight: message.sender === 'user' ? 8 : 7,
        createdAt: parseDate(message.created_at, index * 7_200_000),
        source: message.sender === 'user' ? 'Usuário' : 'Nexus IA',
        tags: topics,
      })
    })

  if (!nodes.length) {
    return positionNodes([
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
    ])
  }

  return positionNodes(nodes.slice(0, 140))
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

  useEffect(() => {
    const mount = mountRef.current
    if (!mount) return

    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(48, 1, 0.1, 100)
    camera.position.set(0, 0.65, 7.2)

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.setClearColor(0x000000, 0)
    mount.appendChild(renderer.domElement)

    const root = new THREE.Group()
    const nodesGroup = new THREE.Group()
    const flowGroup = new THREE.Group()
    const ambientParticles = new THREE.Group()
    root.rotation.x = -0.18
    root.position.y = 0.45
    scene.add(root)
    root.add(flowGroup, nodesGroup, ambientParticles)

    const style = getComputedStyle(document.documentElement)
    const accentHot = new THREE.Color(style.getPropertyValue('--accent-hot').trim() || '#ffffff')
    const accent = new THREE.Color(style.getPropertyValue('--accent').trim() || '#dbe4ef')
    const textColor = new THREE.Color(style.getPropertyValue('--text').trim() || '#111827')

    const disposables: Array<{ dispose: () => void }> = []
    const selectableMeshes: SelectableNodeMesh[] = []

    scene.add(new THREE.AmbientLight(0xffffff, 1.2))
    const keyLight = new THREE.PointLight(accentHot, 5.6, 24)
    keyLight.position.set(0, 2.8, 4.6)
    scene.add(keyLight)
    const sideLight = new THREE.PointLight(accent, 2.4, 18)
    sideLight.position.set(-4, -1, 3)
    scene.add(sideLight)

    const coreGeometry = new THREE.SphereGeometry(0.42, 64, 64)
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

    const haloGeometry = new THREE.SphereGeometry(0.88, 64, 64)
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
      const geometry = new THREE.TorusGeometry(1.1 + index * 0.42, 0.003, 6, 170)
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

    const pointCount = Math.max(1200, nodes.length * 18)
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
      const geometry = new THREE.SphereGeometry(size, 28, 28)
      const material = new THREE.MeshPhysicalMaterial({
        color,
        emissive: color,
        emissiveIntensity: node.id === selectedId ? 0.72 : 0.22,
        metalness: 0.05,
        roughness: 0.16,
        transmission: 0.28,
        transparent: true,
        opacity: node.id === selectedId ? 0.96 : 0.72,
        clearcoat: 1,
      })
      disposables.push(geometry, material)
      const mesh = new THREE.Mesh(geometry, material) as unknown as SelectableNodeMesh
      mesh.position.set(node.x, node.y, node.z)
      mesh.userData = { nodeId: node.id }
      nodesGroup.add(mesh)
      selectableMeshes.push(mesh)

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

    const setPointer = (event: PointerEvent) => {
      const rect = renderer.domElement.getBoundingClientRect()
      pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1
      pointer.y = -(((event.clientY - rect.top) / rect.height) * 2 - 1)
    }

    const onPointerDown = (event: PointerEvent) => {
      dragging = true
      moved = false
      startX = event.clientX
      startY = event.clientY
      renderer.domElement.setPointerCapture(event.pointerId)
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
      renderer.domElement.releasePointerCapture(event.pointerId)
      if (moved) return
      setPointer(event)
      raycaster.setFromCamera(pointer, camera)
      const hit = raycaster.intersectObjects(selectableMeshes, false)[0]
      const nodeId = hit?.object.userData.nodeId
      if (nodeId) onSelect(nodeId)
    }

    const onWheel = (event: WheelEvent) => {
      event.preventDefault()
      camera.position.z = Math.max(3.8, Math.min(11, camera.position.z + event.deltaY * 0.004))
    }

    renderer.domElement.addEventListener('pointerdown', onPointerDown)
    renderer.domElement.addEventListener('pointermove', onPointerMove)
    renderer.domElement.addEventListener('pointerup', onPointerUp)
    renderer.domElement.addEventListener('wheel', onWheel, { passive: false })

    let frame = 0
    let animationId = 0
    const animate = () => {
      frame += 1
      root.rotation.y += (targetRotY - root.rotation.y) * 0.08
      root.rotation.x += (targetRotX - root.rotation.x) * 0.08
      root.rotation.z = Math.sin(frame * 0.006) * 0.025
      core.scale.setScalar(1 + Math.sin(frame * 0.04) * 0.06)
      ambientParticles.rotation.y += 0.0009
      ambientParticles.rotation.x = Math.sin(frame * 0.004) * 0.08
      flowGroup.rotation.y -= 0.0007
      if (thoughtLine) thoughtLine.material.opacity = 0.48 + Math.sin(frame * 0.05) * 0.26

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
      renderer.domElement.removeEventListener('pointerdown', onPointerDown)
      renderer.domElement.removeEventListener('pointermove', onPointerMove)
      renderer.domElement.removeEventListener('pointerup', onPointerUp)
      renderer.domElement.removeEventListener('wheel', onWheel)
      renderer.dispose()
      disposables.forEach(item => item.dispose())
      mount.removeChild(renderer.domElement)
    }
  }, [nodes, selectedId, thoughtMode, onSelect])

  return <div ref={mountRef} className="memory-three-canvas" aria-label="Mapa neural 3D interativo" />
}

// Mapa Obsidian do cérebro da IA: memórias, fontes e raciocínio em uma cena 3D interativa.
export function BrainMap({ messages, knowledgeSources = [] }: BrainMapProps) {
  const allNodes = useMemo(() => buildMemoryNodes(messages, knowledgeSources), [messages, knowledgeSources])
  const [selectedId, setSelectedId] = useState(allNodes[0]?.id ?? 'sistema-contexto')
  const [isStatsOpen, setIsStatsOpen] = useState(false)
  const [period, setPeriod] = useState<MemoryPeriod>('all')
  const [thoughtMode, setThoughtMode] = useState(false)
  const nodes = useMemo(() => filterNodesByPeriod(allNodes, period), [allNodes, period])
  const visibleNodes = nodes.length ? nodes : allNodes.slice(0, 8)
  const selectedNode = visibleNodes.find(node => node.id === selectedId) ?? visibleNodes[0]
  const activeMessages = messages.filter(message => message.text !== '__thinking__')
  const learnedCount = knowledgeSources.length
  const memoryLoad = Math.min(100, Math.round((allNodes.length / 140) * 100))
  const sourceTopics = knowledgeSources.flatMap(source => source.topics ?? []).slice(0, 12)
  const totalConnections = Math.max(allNodes.length * 3, sourceTopics.length + activeMessages.length)
  const processedTokens = [...messages, ...knowledgeSources.map(source => ({ text: source.summary }))]
    .reduce((total, item) => total + Math.ceil((item.text || '').length / 4), 0)

  const recentLearning = useMemo(() => {
    const sourceEvents = knowledgeSources.slice(0, 4).map(source => ({
      id: `source-${source.id}`,
      label: 'Documento indexado',
      text: getLearningTitle(source),
      date: parseDate(source.created_at),
    }))
    const nodeEvents = allNodes.slice(0, 5).map(node => ({
      id: `node-${node.id}`,
      label: node.kind === 'topico' ? 'Relação criada' : node.kind === 'mensagem' ? 'Memória criada' : 'Conhecimento consolidado',
      text: node.label,
      date: node.createdAt,
    }))
    return [...sourceEvents, ...nodeEvents].sort((a, b) => b.date.getTime() - a.date.getTime()).slice(0, 6)
  }, [allNodes, knowledgeSources])

  useEffect(() => {
    if (!visibleNodes.some(node => node.id === selectedId)) {
      setSelectedId(visibleNodes[0]?.id ?? allNodes[0]?.id ?? 'sistema-contexto')
    }
  }, [allNodes, selectedId, visibleNodes])

  return (
    <div className="brain-card memory-brain-card">
      <div className="brain-card-header obsidian-glass-hud">
        <div>
          <span className="eyebrow">Nexus Core</span>
          <strong>Cérebro digital vivo</strong>
        </div>
        <div className="brain-header-actions">
          <span><Radio size={12} /> ao vivo</span>
          <span><GitBranch size={12} /> {visibleNodes.length}</span>
          <button
            type="button"
            className={thoughtMode ? 'is-active' : ''}
            onClick={() => setThoughtMode(value => !value)}
            title="Modo pensamento"
          >
            <BrainCircuit size={14} />
          </button>
          <button type="button" onClick={() => setIsStatsOpen(true)} title="Abrir estatísticas do cérebro">
            <BarChart3 size={14} />
          </button>
        </div>
      </div>

      <div className="obsidian-timeline obsidian-glass-hud" aria-label="Linha do tempo de aprendizado">
        <div>
          <CalendarDays size={13} />
          <span>Timeline</span>
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
          onSelect={setSelectedId}
        />

        <div className="nexus-core-readout">
          <span>Nexus Core</span>
          <strong>{allNodes.length}</strong>
          <em>memórias vivas</em>
        </div>

        <div className="brain-hud memory-hud">
          <span>Memória selecionada</span>
          <strong>{selectedNode?.label ?? 'Nexus'}</strong>
          <em>{selectedNode ? KIND_LABEL[selectedNode.kind] : 'Sistema'}</em>
        </div>

        <div className="brain-vault-status">
          <Layers3 size={13} />
          <span>Conexões cognitivas</span>
          <strong>{totalConnections}</strong>
        </div>
      </div>

      <div className="brain-controls obsidian-glass-hud">
        <span><MousePointer2 size={12} /> arraste para girar</span>
        <span><ZoomIn size={12} /> scroll para zoom</span>
        <button type="button" onClick={() => setIsStatsOpen(true)}>
          <Activity size={12} /> abrir cérebro aprendido
        </button>
      </div>

      <div className="thought-path-panel obsidian-glass-hud">
        <span>Modo Pensamento</span>
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
            aria-label="Estatísticas e memórias aprendidas"
            initial={{ opacity: 0, x: 28, scale: 0.98 }}
            animate={{ opacity: 1, x: 0, scale: 1 }}
            exit={{ opacity: 0, x: 28, scale: 0.98 }}
            transition={{ duration: 0.18, ease: 'easeOut' }}
          >
            <div className="brain-stats-popover-head">
              <div>
                <span className="eyebrow">Cérebro aprendido</span>
                <strong>Memória da IA</strong>
              </div>
              <button type="button" onClick={() => setIsStatsOpen(false)} aria-label="Fechar estatísticas" title="Fechar">
                <X size={16} />
              </button>
            </div>

            <div className="brain-stats">
              <div className="brain-stat-card">
                <span>Memórias totais</span>
                <strong>{allNodes.length}</strong>
                <small>pontos ligados ao núcleo</small>
              </div>
              <div className="brain-stat-card">
                <span>Aprendizados</span>
                <strong>{learnedCount}</strong>
                <small>documentos, páginas ou pesquisas</small>
              </div>
              <div className="brain-stat-card">
                <span>Conexões</span>
                <strong>{totalConnections}</strong>
                <small>relações cognitivas estimadas</small>
              </div>
              <div className="brain-stat-card">
                <span>Tokens</span>
                <strong>{processedTokens}</strong>
                <small>conteúdo processado na sessão</small>
              </div>
              <div className="brain-stat-card">
                <span>Atividade</span>
                <strong>{memoryLoad}%</strong>
                <small>densidade atual do mapa</small>
              </div>
              <div className="brain-stat-card">
                <span>Precisão</span>
                <strong>{Math.min(99, 82 + learnedCount * 3)}%</strong>
                <small>qualidade contextual estimada</small>
              </div>
            </div>

            <div className="brain-detail">
              <span>Nó ativo</span>
              <strong>{selectedNode?.label ?? 'Nexus Core'}</strong>
              <p>{selectedNode?.summary ?? 'Selecione uma memória para ver o que foi guardado.'}</p>
              <div className="memory-meta-grid">
                <small>Origem: {selectedNode?.source ?? 'Nexus Core'}</small>
                <small>Data: {selectedNode ? formatShortDate(selectedNode.createdAt) : '--'}</small>
                <small>Importância: {selectedNode?.weight ?? 0}</small>
                <small>Tipo: {selectedNode ? KIND_LABEL[selectedNode.kind] : 'Sistema'}</small>
              </div>
            </div>

            <div className="brain-signal-panel">
              <div>
                <Activity size={13} />
                <span>Sinapses</span>
                <strong>{totalConnections}</strong>
              </div>
              <div>
                <Network size={13} />
                <span>Tópicos</span>
                <strong>{sourceTopics.length}</strong>
              </div>
              <div>
                <Database size={13} />
                <span>Conversas</span>
                <strong>{activeMessages.length}</strong>
              </div>
              <div className="brain-signal-bars" aria-hidden="true">
                <span />
                <span />
                <span />
                <span />
                <span />
              </div>
            </div>

            <div className="recent-learning-strip">
              <span className="eyebrow">Aprendizados recentes</span>
              {recentLearning.map(item => (
                <div key={item.id}>
                  <Sparkles size={13} />
                  <strong>{item.label}</strong>
                  <p>{item.text}</p>
                  <small>{formatShortDate(item.date)}</small>
                </div>
              ))}
            </div>

            <div className="learned-source-list">
              <span className="eyebrow">Fontes importadas</span>
              {knowledgeSources.length ? knowledgeSources.slice(0, 6).map(source => {
                const title = getLearningTitle(source)
                const detail = source.summary || source.topics?.slice(0, 4).join(' · ') || 'Aprendizado salvo na memória.'
                return (
                  <button key={source.id} type="button" onClick={() => setSelectedId(`fonte-${source.id}`)}>
                    <FileText size={14} />
                    <span>
                      <strong>{title}</strong>
                      <small>{compactLabel(detail, 'Resumo indisponível', 120)}</small>
                    </span>
                  </button>
                )
              }) : (
                <p>Nenhum PDF, página ou pesquisa importada ainda.</p>
              )}
            </div>

            <div className="concept-list">
              <div className="panel-heading compact">
                <span>Memórias recentes</span>
                <ScanSearch size={13} />
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
