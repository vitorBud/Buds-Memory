import { useEffect, useMemo, useRef, useState } from 'react'
import { Activity, BrainCircuit, GitBranch, Layers3, MousePointer2, Network, Radio, Rotate3D, ScanSearch, ZoomIn } from 'lucide-react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import type { KnowledgeSource, Message } from '../types'

interface BrainMapProps {
  messages: Message[]
  knowledgeSources?: KnowledgeSource[]
}

interface ConceptNode {
  id: string
  label: string
  count: number
  index: number
  senderMix: {
    user: number
    ia: number
  }
}

const STOP_WORDS = new Set([
  'para', 'como', 'uma', 'com', 'que', 'por', 'mais', 'menos', 'isso', 'esse',
  'essa', 'aqui', 'voce', 'você', 'esta', 'está', 'ser', 'ter', 'das', 'dos',
  'nas', 'nos', 'sim', 'não', 'nao', 'meu', 'minha', 'seu', 'sua', 'ele',
  'ela', 'tem', 'vai', 'fazer', 'sobre', 'apenas', 'agora', 'entao', 'então',
  'quando', 'onde', 'porque', 'qual', 'quais', 'cada', 'toda', 'todo', 'isso',
])

function normalize(text: string) {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
}

function hashString(value: string) {
  let hash = 0
  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) - hash + value.charCodeAt(index)) | 0
  }
  return Math.abs(hash)
}

function getConcepts(messages: Message[]): ConceptNode[] {
  const counts = new Map<string, ConceptNode>()

  messages.forEach(message => {
    if (message.text === '__thinking__') return

    normalize(message.text)
      .split(/\s+/)
      .filter(word => word.length > 3 && !STOP_WORDS.has(word))
      .forEach(word => {
        const previous = counts.get(word) ?? {
          id: word,
          label: word,
          count: 0,
          index: 0,
          senderMix: { user: 0, ia: 0 },
        }
        previous.count += 1
        previous.senderMix[message.sender === 'user' ? 'user' : 'ia'] += 1
        counts.set(word, previous)
      })
  })

  return [...counts.values()]
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
    .slice(0, 10)
    .map((node, index) => ({ ...node, index }))
}

function getKnowledgeConcepts(sources: KnowledgeSource[]): ConceptNode[] {
  const nodes: ConceptNode[] = []

  sources.slice(0, 6).forEach((source, sourceIndex) => {
    const title = source.title || 'Material importado'
    nodes.push({
      id: `fonte-${source.id}`,
      label: title,
      count: 6 + Math.min(source.topics?.length ?? 0, 6),
      index: nodes.length,
      senderMix: { user: 1, ia: 5 },
    })

    ;(source.topics ?? []).slice(0, 4).forEach(topic => {
      nodes.push({
        id: `topico-${source.id}-${topic}`,
        label: topic,
        count: 3 + sourceIndex,
        index: nodes.length,
        senderMix: { user: 1, ia: 3 },
      })
    })
  })

  return nodes.slice(0, 14).map((node, index) => ({ ...node, index }))
}

function makeLabelSprite(label: string, color: string, selected: boolean) {
  const canvas = document.createElement('canvas')
  const context = canvas.getContext('2d')
  canvas.width = 256
  canvas.height = 72

  if (context) {
    context.clearRect(0, 0, canvas.width, canvas.height)
    context.fillStyle = selected ? 'rgba(10, 18, 30, 0.88)' : 'rgba(10, 18, 30, 0.68)'
    context.strokeStyle = color
    context.lineWidth = selected ? 3 : 1.5
    context.beginPath()
    context.roundRect(8, 8, 240, 48, 10)
    context.fill()
    context.stroke()

    context.fillStyle = '#edf3fb'
    context.font = '600 22px Outfit, system-ui, sans-serif'
    context.textAlign = 'center'
    context.textBaseline = 'middle'
    context.fillText(label.slice(0, 18), 128, 32)
  }

  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  const material = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    opacity: selected ? 1 : 0.82,
    depthTest: false,
  })
  const sprite = new THREE.Sprite(material)
  sprite.scale.set(selected ? 1.42 : 1.18, selected ? 0.4 : 0.34, 1)
  sprite.userData = { texture, material }
  return sprite
}

function getNodePosition(node: ConceptNode, total: number) {
  const hash = hashString(node.label)
  const angle = node.index * 2.399963 + (hash % 64) * 0.012
  const radius = 2.35 + (hash % 4) * 0.28 + Math.min(node.count, 5) * 0.08
  const y = (((hash >> 4) % 9) - 4) * 0.18

  return new THREE.Vector3(
    Math.cos(angle) * radius,
    y + Math.sin((node.index / Math.max(total, 1)) * Math.PI * 2) * 0.34,
    Math.sin(angle) * radius,
  )
}

// Mapa 3D estilo Obsidian que transforma conceitos da conversa em nós e conexões.
export function BrainMap({ messages, knowledgeSources = [] }: BrainMapProps) {
  const mountRef = useRef<HTMLDivElement>(null)
  const learnedNodes = useMemo(() => getKnowledgeConcepts(knowledgeSources), [knowledgeSources])
  const [selectedConcept, setSelectedConcept] = useState(() => learnedNodes[0]?.label ?? 'Nexus')
  const concepts = useMemo(() => {
    const conversationNodes = getConcepts(messages)
    const merged = new Map<string, ConceptNode>()
    ;[...learnedNodes, ...conversationNodes].forEach(node => {
      if (!merged.has(node.label)) merged.set(node.label, node)
    })
    return [...merged.values()].slice(0, 14).map((node, index) => ({ ...node, index }))
  }, [messages, learnedNodes])
  const nodes = concepts.length
    ? concepts
    : [
        { id: 'memoria', label: 'memoria', count: 1, index: 0, senderMix: { user: 0, ia: 1 } },
        { id: 'voz', label: 'voz', count: 1, index: 1, senderMix: { user: 0, ia: 1 } },
        { id: 'modelo', label: 'modelo', count: 1, index: 2, senderMix: { user: 0, ia: 1 } },
        { id: 'contexto', label: 'contexto', count: 1, index: 3, senderMix: { user: 0, ia: 1 } },
        { id: 'codigo', label: 'codigo', count: 1, index: 4, senderMix: { user: 0, ia: 1 } },
        { id: 'resposta', label: 'resposta', count: 1, index: 5, senderMix: { user: 0, ia: 1 } },
        { id: 'frontend', label: 'frontend', count: 1, index: 6, senderMix: { user: 0, ia: 1 } },
        { id: 'sessao', label: 'sessao', count: 1, index: 7, senderMix: { user: 0, ia: 1 } },
      ]

  useEffect(() => {
    if (learnedNodes[0]?.label) setSelectedConcept(learnedNodes[0].label)
  }, [learnedNodes])

  const selectedNode = nodes.find(node => node.label === selectedConcept)
  const conceptSignature = nodes.map(node => `${node.id}:${node.count}:${node.senderMix.user}:${node.senderMix.ia}`).join('|')
  const activeMessages = messages.filter(message => message.text !== '__thinking__')
  const userMessages = activeMessages.filter(message => message.sender === 'user').length
  const aiMessages = activeMessages.filter(message => message.sender === 'ia').length
  const totalMentions = nodes.reduce((sum, node) => sum + node.count, 0)
  const memoryLoad = Math.min(100, Math.round((activeMessages.length / 12) * 100))
  const learnedLoad = Math.min(100, Math.round((knowledgeSources.length / 8) * 100))
  const totalMentionsLabel = totalMentions === 1 ? '1 menção mapeada' : `${totalMentions} menções mapeadas`
  const selectedUserLabel = selectedNode?.senderMix.user === 1 ? '1 citação sua' : `${selectedNode?.senderMix.user ?? 0} citações suas`
  const selectedIaLabel = selectedNode?.senderMix.ia === 1 ? '1 citação da IA' : `${selectedNode?.senderMix.ia ?? 0} citações da IA`

  useEffect(() => {
    const mount = mountRef.current
    if (!mount) return

    const style = getComputedStyle(document.documentElement)
    const colors = {
      surface: style.getPropertyValue('--surface-2').trim() || '#151b27',
      text: style.getPropertyValue('--text').trim() || '#edf3fb',
      cyan: style.getPropertyValue('--accent').trim() || '#06b6d4',
      violet: style.getPropertyValue('--accent-hot').trim() || '#8b5cf6',
      emerald: style.getPropertyValue('--emerald').trim() || '#22c55e',
      amber: style.getPropertyValue('--accent').trim() || '#f59e0b',
      rose: style.getPropertyValue('--rose').trim() || '#f43f5e',
    }

    const width = Math.max(mount.clientWidth, 260)
    const height = Math.max(mount.clientHeight, 260)
    const scene = new THREE.Scene()
    scene.fog = new THREE.Fog(colors.surface, 8, 17)

    const camera = new THREE.PerspectiveCamera(40, width / height, 0.1, 100)
    camera.position.set(0, 1.35, 8.6)

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.setSize(width, height)
    mount.appendChild(renderer.domElement)

    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true
    controls.dampingFactor = 0.08
    controls.minDistance = 4.6
    controls.maxDistance = 13
    controls.rotateSpeed = 0.62
    controls.autoRotate = activeMessages.length > 0
    controls.autoRotateSpeed = 0.45

    const root = new THREE.Group()
    scene.add(root)

    const ambient = new THREE.AmbientLight(colors.text, 0.58)
    const key = new THREE.PointLight(colors.cyan, 1.5, 18)
    key.position.set(4.5, 5, 5)
    const fill = new THREE.PointLight(colors.violet, 1.05, 14)
    fill.position.set(-4, -2, 4)
    scene.add(ambient, key, fill)

    const disposables: Array<{ dispose: () => void }> = []
    const selectable: THREE.Mesh[] = []
    const labelSprites: THREE.Sprite[] = []
    const pulseSignals: Array<{
      mesh: THREE.Mesh
      curve: THREE.CatmullRomCurve3
      offset: number
      speed: number
    }> = []
    const positionMap = new Map<string, THREE.Vector3>()
    const selectedLabel = selectedNode?.label

    const coreGeometry = new THREE.IcosahedronGeometry(0.38, 4)
    const coreMaterial = new THREE.MeshStandardMaterial({
      color: colors.cyan,
      emissive: colors.cyan,
      emissiveIntensity: 0.38,
      metalness: 0.42,
      roughness: 0.24,
      transparent: true,
      opacity: 0.88,
    })
    disposables.push(coreGeometry, coreMaterial)
    const core = new THREE.Mesh(coreGeometry, coreMaterial)
    core.name = 'Nexus core'
    root.add(core)

    const neuronCluster = new THREE.Group()
    const microGeometry = new THREE.SphereGeometry(0.045, 16, 16)
    const microMaterial = new THREE.MeshStandardMaterial({
      color: colors.cyan,
      emissive: colors.cyan,
      emissiveIntensity: 0.45,
      metalness: 0.2,
      roughness: 0.28,
    })
    disposables.push(microGeometry, microMaterial)
    const microLinkMaterial = new THREE.LineBasicMaterial({
      color: colors.cyan,
      transparent: true,
      opacity: 0.22,
    })
    disposables.push(microLinkMaterial)

    for (let index = 0; index < 44; index += 1) {
      const angle = index * 2.399963
      const radius = 0.58 + (index % 5) * 0.065
      const neuron = new THREE.Mesh(microGeometry, microMaterial)
      neuron.position.set(
        Math.cos(angle) * radius,
        Math.sin(index * 1.41) * 0.46,
        Math.sin(angle) * radius,
      )
      neuron.userData = { basePosition: neuron.position.clone(), index }
      neuronCluster.add(neuron)

      const linkGeometry = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), neuron.position])
      disposables.push(linkGeometry)
      neuronCluster.add(new THREE.Line(linkGeometry, microLinkMaterial))
    }
    root.add(neuronCluster)

    const coreHaloMaterial = new THREE.MeshBasicMaterial({
      color: colors.cyan,
      transparent: true,
      opacity: 0.12,
      side: THREE.DoubleSide,
    })
    disposables.push(coreHaloMaterial)
    const haloA = new THREE.Mesh(new THREE.TorusGeometry(1.34, 0.008, 10, 120), coreHaloMaterial)
    const haloB = new THREE.Mesh(new THREE.TorusGeometry(1.75, 0.006, 10, 120), coreHaloMaterial.clone())
    disposables.push(haloA.geometry, haloB.geometry, haloB.material as THREE.Material)
    haloA.rotation.x = Math.PI / 2.35
    haloB.rotation.y = Math.PI / 2.9
    root.add(haloA, haloB)

    const nodeGeometry = new THREE.SphereGeometry(0.15, 32, 32)
    const pulseGeometry = new THREE.SphereGeometry(0.045, 18, 18)
    disposables.push(nodeGeometry)
    disposables.push(pulseGeometry)

    const regions = [
      { label: 'memoria', color: colors.cyan, position: new THREE.Vector3(-2.9, 1.35, -1.4) },
      { label: 'codigo', color: colors.amber, position: new THREE.Vector3(2.9, 1.05, -1.1) },
      { label: 'contexto', color: colors.emerald, position: new THREE.Vector3(-2.65, -1.2, 1.2) },
      { label: 'resposta', color: colors.violet, position: new THREE.Vector3(2.65, -1.15, 1.35) },
    ]

    regions.forEach(region => {
      const sprite = makeLabelSprite(region.label, region.color, false)
      sprite.position.copy(region.position)
      sprite.scale.multiplyScalar(0.78)
      labelSprites.push(sprite)
      root.add(sprite)
    })

    nodes.forEach((node, index) => {
      const position = getNodePosition(node, nodes.length)
      positionMap.set(node.label, position)
      const isSelected = node.label === selectedLabel
      const color = node.senderMix.user > node.senderMix.ia
        ? colors.amber
        : index % 3 === 0 ? colors.emerald : index % 3 === 1 ? colors.violet : colors.cyan
      const nodeMaterial = new THREE.MeshStandardMaterial({
        color,
        emissive: color,
        emissiveIntensity: isSelected ? 0.52 : 0.18 + Math.min(node.count, 5) * 0.035,
        metalness: 0.22,
        roughness: 0.3,
      })
      disposables.push(nodeMaterial)

      const sphere = new THREE.Mesh(nodeGeometry, nodeMaterial)
      sphere.position.copy(position)
      sphere.scale.setScalar((isSelected ? 1.34 : 0.92) + Math.min(node.count, 5) * 0.11)
      sphere.userData = {
        label: node.label,
        count: node.count,
        baseScale: sphere.scale.x,
        material: nodeMaterial,
      }
      selectable.push(sphere)
      root.add(sphere)

      for (let satelliteIndex = 0; satelliteIndex < 4; satelliteIndex += 1) {
        const satelliteAngle = index * 1.17 + satelliteIndex * 2.08
        const satelliteOffset = new THREE.Vector3(
          Math.cos(satelliteAngle) * (0.36 + satelliteIndex * 0.05),
          Math.sin(satelliteAngle * 1.3) * 0.2,
          Math.sin(satelliteAngle) * (0.36 + satelliteIndex * 0.05),
        )
        const satellite = new THREE.Mesh(microGeometry, nodeMaterial)
        satellite.position.copy(position).add(satelliteOffset)
        satellite.userData = {
          basePosition: satellite.position.clone(),
          index: index + satelliteIndex,
        }
        root.add(satellite)

        const satelliteCurve = new THREE.CatmullRomCurve3([
          position,
          position.clone().lerp(satellite.position, 0.5).add(new THREE.Vector3(0, 0.12, 0)),
          satellite.position,
        ])
        const satelliteLinkGeometry = new THREE.BufferGeometry().setFromPoints(satelliteCurve.getPoints(18))
        const satelliteLinkMaterial = new THREE.LineBasicMaterial({
          color,
          transparent: true,
          opacity: 0.18,
        })
        disposables.push(satelliteLinkGeometry, satelliteLinkMaterial)
        root.add(new THREE.Line(satelliteLinkGeometry, satelliteLinkMaterial))
      }

      const labelSprite = makeLabelSprite(node.label, color, isSelected)
      labelSprite.position.copy(position).add(new THREE.Vector3(0, 0.45 + Math.min(node.count, 4) * 0.05, 0))
      labelSprites.push(labelSprite)
      root.add(labelSprite)

      const linkMaterial = new THREE.LineBasicMaterial({
        color: isSelected ? colors.violet : colors.cyan,
        transparent: true,
        opacity: isSelected ? 0.56 : 0.28,
      })
      const curve = new THREE.CatmullRomCurve3([
        new THREE.Vector3(0, 0, 0),
        position.clone().multiplyScalar(0.42).add(new THREE.Vector3(0, Math.sin(index + 1) * 0.7, 0)),
        position,
      ])
      const linkGeometry = new THREE.BufferGeometry().setFromPoints(curve.getPoints(34))
      disposables.push(linkMaterial, linkGeometry)
      root.add(new THREE.Line(linkGeometry, linkMaterial))

      const pulseMaterial = new THREE.MeshBasicMaterial({
        color: isSelected ? colors.violet : color,
        transparent: true,
        opacity: isSelected ? 0.95 : 0.72,
      })
      disposables.push(pulseMaterial)
      const pulse = new THREE.Mesh(pulseGeometry, pulseMaterial)
      pulseSignals.push({
        mesh: pulse,
        curve,
        offset: index / Math.max(nodes.length, 1),
        speed: 0.18 + (index % 4) * 0.035,
      })
      root.add(pulse)
    })

    nodes.forEach((node, index) => {
      if (index >= nodes.length - 1) return
      const from = positionMap.get(node.label)
      const to = positionMap.get(nodes[index + 1].label)
      if (!from || !to) return

      const relationMaterial = new THREE.LineBasicMaterial({
        color: colors.violet,
        transparent: true,
        opacity: 0.14 + Math.min(node.count, 4) * 0.025,
      })
      const relationCurve = new THREE.CatmullRomCurve3([
        from,
        from.clone().lerp(to, 0.5).add(new THREE.Vector3(0, 0.5 + (index % 2) * 0.2, 0)),
        to,
      ])
      const relationGeometry = new THREE.BufferGeometry().setFromPoints(relationCurve.getPoints(26))
      disposables.push(relationMaterial, relationGeometry)
      root.add(new THREE.Line(relationGeometry, relationMaterial))
    })

    const starGeometry = new THREE.BufferGeometry()
    const starPositions = new Float32Array(420 * 3)
    for (let index = 0; index < starPositions.length; index += 3) {
      const seed = index + nodes.length * 17
      starPositions[index] = (((seed * 37) % 100) / 100 - 0.5) * 9
      starPositions[index + 1] = (((seed * 53) % 100) / 100 - 0.5) * 5.4
      starPositions[index + 2] = (((seed * 71) % 100) / 100 - 0.5) * 9
    }
    starGeometry.setAttribute('position', new THREE.BufferAttribute(starPositions, 3))
    const starsMaterial = new THREE.PointsMaterial({
      color: colors.cyan,
      size: 0.018,
      transparent: true,
      opacity: 0.44,
    })
    disposables.push(starGeometry, starsMaterial)
    const stars = new THREE.Points(starGeometry, starsMaterial)
    scene.add(stars)

    const raycaster = new THREE.Raycaster()
    const pointer = new THREE.Vector2()
    const setPointer = (event: PointerEvent) => {
      const rect = renderer.domElement.getBoundingClientRect()
      pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1
      pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1
      raycaster.setFromCamera(pointer, camera)
    }
    const onPointerMove = (event: PointerEvent) => {
      setPointer(event)
      const [hit] = raycaster.intersectObjects(selectable)
      renderer.domElement.style.cursor = hit ? 'pointer' : 'grab'
    }
    const onPointerDown = (event: PointerEvent) => {
      setPointer(event)
      const [hit] = raycaster.intersectObjects(selectable)
      if (hit?.object.userData.label) {
        setSelectedConcept(hit.object.userData.label)
      }
    }
    renderer.domElement.addEventListener('pointermove', onPointerMove)
    renderer.domElement.addEventListener('pointerdown', onPointerDown)

    const resizeObserver = new ResizeObserver(([entry]) => {
      const nextWidth = Math.max(entry.contentRect.width, 260)
      const nextHeight = Math.max(entry.contentRect.height, 260)
      camera.aspect = nextWidth / nextHeight
      camera.updateProjectionMatrix()
      renderer.setSize(nextWidth, nextHeight)
    })
    resizeObserver.observe(mount)

    let frame = 0
    let animationId = 0
    const animate = () => {
      frame += 0.01
      core.rotation.x += 0.004
      core.rotation.y += 0.006
      neuronCluster.rotation.y -= 0.0025
      neuronCluster.rotation.x = Math.sin(frame * 0.8) * 0.08
      haloA.rotation.z += 0.004
      haloB.rotation.x -= 0.003
      stars.rotation.y -= 0.0008

      selectable.forEach((mesh, index) => {
        const baseScale = mesh.userData.baseScale || 1
        const activePulse = mesh.userData.label === selectedLabel ? 0.09 : 0.035
        const pulse = Math.sin(frame * 4 + index) * activePulse
        mesh.scale.setScalar(baseScale + pulse)
      })

      neuronCluster.children.forEach(child => {
        if (!(child instanceof THREE.Mesh) || !child.userData.basePosition) return
        const base = child.userData.basePosition as THREE.Vector3
        const index = child.userData.index as number
        child.position.copy(base).add(new THREE.Vector3(
          Math.sin(frame * 2.2 + index) * 0.025,
          Math.cos(frame * 1.8 + index) * 0.025,
          Math.sin(frame * 2.4 + index * 0.7) * 0.025,
        ))
      })

      pulseSignals.forEach(signal => {
        const t = (frame * signal.speed + signal.offset) % 1
        const point = signal.curve.getPointAt(t)
        signal.mesh.position.copy(point)
        const scale = 0.72 + Math.sin((t + frame) * Math.PI * 2) * 0.22
        signal.mesh.scale.setScalar(scale)
      })

      labelSprites.forEach(sprite => {
        sprite.quaternion.copy(camera.quaternion)
      })

      controls.update()
      renderer.render(scene, camera)
      animationId = window.requestAnimationFrame(animate)
    }
    animate()

    return () => {
      window.cancelAnimationFrame(animationId)
      resizeObserver.disconnect()
      renderer.domElement.removeEventListener('pointermove', onPointerMove)
      renderer.domElement.removeEventListener('pointerdown', onPointerDown)
      controls.dispose()
      renderer.dispose()
      labelSprites.forEach(sprite => {
        sprite.userData.texture?.dispose()
        sprite.userData.material?.dispose()
      })
      disposables.forEach(item => item.dispose())
      mount.removeChild(renderer.domElement)
    }
  }, [activeMessages.length, conceptSignature, selectedNode?.label])

  return (
    <div className="brain-card">
      <div className="brain-card-header">
        <div>
          <span className="eyebrow">Mapa Obsidian</span>
          <strong>Cérebro IA</strong>
        </div>
        <div className="brain-header-actions">
          <span><Radio size={12} /> ao vivo</span>
          <span><GitBranch size={12} /> {Math.max(0, nodes.length - 1)}</span>
          <BrainCircuit size={15} />
        </div>
      </div>

      <div className="brain-graph" aria-label="Mapa 3D de conceitos da conversa">
        <div ref={mountRef} className="brain-canvas" />
        <div className="brain-hud">
          <span>Selecionado</span>
          <strong>{selectedNode?.label ?? selectedConcept}</strong>
          <em>{selectedNode ? `${selectedNode.count} conexões` : `${nodes.length} nós ativos`}</em>
        </div>
        <div className="brain-vault-status">
          <Layers3 size={13} />
          <span>Aprendizado</span>
          <strong>{Math.max(memoryLoad, learnedLoad)}%</strong>
        </div>
      </div>

      <div className="brain-controls">
        <span><Rotate3D size={12} /> arraste</span>
        <span><ZoomIn size={12} /> zoom</span>
        <span><MousePointer2 size={12} /> selecione</span>
      </div>

      <div className="brain-stats">
        <div className="brain-stat-card">
          <span>Suas mensagens</span>
          <strong>{userMessages}</strong>
          <small>entradas usadas como contexto</small>
        </div>
        <div className="brain-stat-card">
          <span>Respostas da IA</span>
          <strong>{aiMessages}</strong>
          <small>respostas na conversa atual</small>
        </div>
        <div className="brain-stat-card">
          <span>Fontes aprendidas</span>
          <strong>{knowledgeSources.length}</strong>
          <small>PDFs, páginas ou pesquisas importadas</small>
        </div>
        <div className="brain-stat-card">
          <span>Carga da memória</span>
          <strong>{memoryLoad}%</strong>
          <small>{totalMentionsLabel}</small>
        </div>
      </div>

      <div className="brain-detail">
        <span>Nó ativo</span>
        <strong>{selectedNode?.label ?? 'Nexus'}</strong>
        <p>
          {selectedNode
            ? `Aparece ${selectedNode.count} ${selectedNode.count === 1 ? 'vez' : 'vezes'}, com ${selectedUserLabel} e ${selectedIaLabel}.`
            : knowledgeSources[0]
              ? `Assunto aprendido: ${knowledgeSources[0].title}.`
              : 'Núcleo da conversa atual, conectando contexto, memória e respostas do modelo.'}
        </p>
      </div>

      <div className="brain-signal-panel">
        <div>
          <Activity size={13} />
          <span>Sinapses</span>
          <strong>{Math.max(nodes.length * 3, totalMentions)}</strong>
        </div>
        <div>
          <Network size={13} />
          <span>Fontes</span>
          <strong>{knowledgeSources.length}</strong>
        </div>
        <div className="brain-signal-bars" aria-hidden="true">
          <span />
          <span />
          <span />
          <span />
          <span />
        </div>
      </div>

      <div className="concept-list">
        <div className="panel-heading compact">
          <span>Conceitos em tempo real</span>
          <ScanSearch size={13} />
        </div>
        {nodes.slice(0, 7).map(node => (
          <button
            key={node.id}
            type="button"
            className={selectedConcept === node.label ? 'is-active' : ''}
            onClick={() => setSelectedConcept(node.label)}
          >
            <span>{node.label}</span>
            <strong>{node.count}</strong>
          </button>
        ))}
      </div>
    </div>
  )
}
