import { useEffect, useMemo, useRef, useState } from 'react'
import { BrainCircuit, MousePointer2, Rotate3D, ScanSearch, ZoomIn } from 'lucide-react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import type { Message } from '../types'

interface BrainMapProps {
  messages: Message[]
}

const STOP_WORDS = new Set([
  'para', 'como', 'uma', 'com', 'que', 'por', 'mais', 'menos', 'isso', 'esse',
  'essa', 'aqui', 'voce', 'você', 'esta', 'está', 'ser', 'ter', 'das', 'dos',
  'nas', 'nos', 'sim', 'não', 'nao', 'meu', 'minha', 'seu', 'sua', 'ele',
  'ela', 'tem', 'vai', 'fazer', 'sobre', 'apenas', 'agora',
])

function normalize(text: string) {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
}

function getConcepts(messages: Message[]) {
  const counts = new Map<string, number>()

  messages.forEach(message => {
    if (message.text === '__thinking__') return
    normalize(message.text)
      .split(/\s+/)
      .filter(word => word.length > 3 && !STOP_WORDS.has(word))
      .forEach(word => counts.set(word, (counts.get(word) ?? 0) + 1))
  })

  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 9)
    .map(([label, count], index) => ({ id: label, label, count, index }))
}

export function BrainMap({ messages }: BrainMapProps) {
  const mountRef = useRef<HTMLDivElement>(null)
  const [selectedConcept, setSelectedConcept] = useState('Nexus')
  const concepts = useMemo(() => getConcepts(messages), [messages])
  const nodes = concepts.length
    ? concepts
    : [
        { id: 'memoria', label: 'memoria', count: 1, index: 0 },
        { id: 'voz', label: 'voz', count: 1, index: 1 },
        { id: 'modelo', label: 'modelo', count: 1, index: 2 },
        { id: 'contexto', label: 'contexto', count: 1, index: 3 },
      ]
  const conceptSignature = nodes.map(node => `${node.id}:${node.count}`).join('|')
  const activeMessages = messages.filter(message => message.text !== '__thinking__')
  const userMessages = activeMessages.filter(message => message.sender === 'user').length
  const aiMessages = activeMessages.filter(message => message.sender === 'ia').length

  useEffect(() => {
    const mount = mountRef.current
    if (!mount) return

    const style = getComputedStyle(document.documentElement)
    const colors = {
      surface: style.getPropertyValue('--surface-2').trim() || '#151b27',
      text: style.getPropertyValue('--text').trim() || '#edf3fb',
      cyan: style.getPropertyValue('--cyan').trim() || '#06b6d4',
      violet: style.getPropertyValue('--violet').trim() || '#8b5cf6',
      emerald: style.getPropertyValue('--emerald').trim() || '#22c55e',
      amber: style.getPropertyValue('--amber').trim() || '#f59e0b',
    }

    const width = Math.max(mount.clientWidth, 260)
    const height = Math.max(mount.clientHeight, 220)
    const scene = new THREE.Scene()
    scene.fog = new THREE.Fog(colors.surface, 7, 15)

    const camera = new THREE.PerspectiveCamera(42, width / height, 0.1, 100)
    camera.position.set(0, 1.2, 8.8)

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.setSize(width, height)
    mount.appendChild(renderer.domElement)

    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true
    controls.dampingFactor = 0.08
    controls.minDistance = 5
    controls.maxDistance = 13
    controls.rotateSpeed = 0.65

    const root = new THREE.Group()
    scene.add(root)

    const ambient = new THREE.AmbientLight(colors.text, 0.55)
    const key = new THREE.PointLight(colors.cyan, 1.35, 16)
    key.position.set(4, 5, 5)
    const fill = new THREE.PointLight(colors.violet, 0.9, 12)
    fill.position.set(-4, -2, 4)
    scene.add(ambient, key, fill)

    const coreGeometry = new THREE.IcosahedronGeometry(0.9, 3)
    const coreMaterial = new THREE.MeshStandardMaterial({
      color: colors.cyan,
      emissive: colors.cyan,
      emissiveIntensity: 0.18,
      metalness: 0.35,
      roughness: 0.28,
      transparent: true,
      opacity: 0.94,
    })
    const core = new THREE.Mesh(coreGeometry, coreMaterial)
    core.name = 'Nexus core'
    root.add(core)

    const ringMaterial = new THREE.MeshBasicMaterial({
      color: colors.violet,
      transparent: true,
      opacity: 0.24,
      side: THREE.DoubleSide,
    })
    const ring = new THREE.Mesh(new THREE.TorusGeometry(1.55, 0.008, 12, 96), ringMaterial)
    ring.rotation.x = Math.PI / 2.7
    root.add(ring)

    const sphereGeometry = new THREE.SphereGeometry(0.16, 28, 28)
    const selectable: THREE.Mesh[] = []
    const linkMaterial = new THREE.LineBasicMaterial({
      color: colors.cyan,
      transparent: true,
      opacity: 0.33,
    })

    nodes.forEach((node, index) => {
      const angle = (Math.PI * 2 * index) / nodes.length
      const layer = index % 3
      const radius = 2.2 + layer * 0.42 + Math.min(node.count, 4) * 0.08
      const position = new THREE.Vector3(
        Math.cos(angle) * radius,
        Math.sin(index * 1.7) * 0.78,
        Math.sin(angle) * radius,
      )

      const color = index % 3 === 0 ? colors.emerald : index % 3 === 1 ? colors.violet : colors.amber
      const nodeMaterial = new THREE.MeshStandardMaterial({
        color,
        emissive: color,
        emissiveIntensity: 0.14 + Math.min(node.count, 4) * 0.035,
        metalness: 0.22,
        roughness: 0.34,
      })
      const sphere = new THREE.Mesh(sphereGeometry, nodeMaterial)
      sphere.position.copy(position)
      sphere.scale.setScalar(0.82 + Math.min(node.count, 5) * 0.12)
      sphere.userData = { label: node.label, count: node.count, baseScale: sphere.scale.x }
      selectable.push(sphere)
      root.add(sphere)

      const lineGeometry = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), position])
      const line = new THREE.Line(lineGeometry, linkMaterial)
      root.add(line)
    })

    const starGeometry = new THREE.BufferGeometry()
    const starPositions = new Float32Array(180 * 3)
    for (let i = 0; i < starPositions.length; i += 3) {
      starPositions[i] = (Math.random() - 0.5) * 9
      starPositions[i + 1] = (Math.random() - 0.5) * 5
      starPositions[i + 2] = (Math.random() - 0.5) * 9
    }
    starGeometry.setAttribute('position', new THREE.BufferAttribute(starPositions, 3))
    const stars = new THREE.Points(
      starGeometry,
      new THREE.PointsMaterial({ color: colors.cyan, size: 0.018, transparent: true, opacity: 0.42 }),
    )
    scene.add(stars)

    const raycaster = new THREE.Raycaster()
    const pointer = new THREE.Vector2()
    const onPointerDown = (event: PointerEvent) => {
      const rect = renderer.domElement.getBoundingClientRect()
      pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1
      pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1
      raycaster.setFromCamera(pointer, camera)
      const [hit] = raycaster.intersectObjects(selectable)
      if (hit?.object.userData.label) {
        setSelectedConcept(hit.object.userData.label)
      }
    }
    renderer.domElement.addEventListener('pointerdown', onPointerDown)

    const resizeObserver = new ResizeObserver(([entry]) => {
      const nextWidth = Math.max(entry.contentRect.width, 260)
      const nextHeight = Math.max(entry.contentRect.height, 220)
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
      ring.rotation.z += 0.003
      root.rotation.y += 0.0018
      stars.rotation.y -= 0.0009

      selectable.forEach((mesh, index) => {
        const baseScale = mesh.userData.baseScale || 1
        const pulse = Math.sin(frame * 4 + index) * 0.045
        mesh.scale.setScalar(baseScale + pulse)
      })

      controls.update()
      renderer.render(scene, camera)
      animationId = window.requestAnimationFrame(animate)
    }
    animate()

    return () => {
      window.cancelAnimationFrame(animationId)
      resizeObserver.disconnect()
      renderer.domElement.removeEventListener('pointerdown', onPointerDown)
      controls.dispose()
      renderer.dispose()
      coreGeometry.dispose()
      sphereGeometry.dispose()
      starGeometry.dispose()
      coreMaterial.dispose()
      ringMaterial.dispose()
      linkMaterial.dispose()
      mount.removeChild(renderer.domElement)
    }
  }, [conceptSignature])

  return (
    <div className="brain-card">
      <div className="panel-heading">
        <span>Cérebro IA</span>
        <BrainCircuit size={14} />
      </div>

      <div className="brain-graph" aria-label="Mapa 3D de conceitos da conversa">
        <div ref={mountRef} className="brain-canvas" />
        <div className="brain-hud">
          <strong>{selectedConcept}</strong>
          <span>{nodes.length} nós ativos</span>
        </div>
      </div>

      <div className="brain-controls">
        <span><Rotate3D size={12} /> arraste</span>
        <span><ZoomIn size={12} /> zoom</span>
        <span><MousePointer2 size={12} /> clique</span>
      </div>

      <div className="brain-stats">
        <div>
          <span>Usuário</span>
          <strong>{userMessages}</strong>
        </div>
        <div>
          <span>IA</span>
          <strong>{aiMessages}</strong>
        </div>
        <div>
          <span>Conceitos</span>
          <strong>{nodes.length}</strong>
        </div>
      </div>

      <div className="concept-list">
        <div className="panel-heading compact">
          <span>Conceitos em tempo real</span>
          <ScanSearch size={13} />
        </div>
        {nodes.slice(0, 6).map(node => (
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
