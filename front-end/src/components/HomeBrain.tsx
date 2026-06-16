import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js'
import type { AiState, ThemeMode } from '../types'

interface HomeBrainProps {
  theme: ThemeMode
  aiState: AiState
  memoryCount: number
}

type NexusBridge = { assetBase?: string }

// Representação de cores Three.js baseadas no tema selecionado
function getThemeColors(theme: ThemeMode) {
  switch (theme) {
    case 'gold':
      return {
        primary: new THREE.Color('#fbbf24'),   // dourado
        secondary: new THREE.Color('#f57c00'), // âmbar/laranja
        accent: new THREE.Color('#fffbeb'),    // dourado muito claro
        glow: '#f59e0b',
        lines: '#fbbf24'
      }
    case 'white':
      return {
        primary: new THREE.Color('#0ea5e9'),   // ciano/azul
        secondary: new THREE.Color('#8b5cf6'), // violeta
        accent: new THREE.Color('#10b981'),    // esmeralda
        glow: '#0ea5e9',
        lines: '#94a3b8'
      }
    case 'silver':
      return {
        primary: new THREE.Color('#cbd5e1'),   // prata
        secondary: new THREE.Color('#64748b'), // slate
        accent: new THREE.Color('#38bdf8'),    // azul glacial
        glow: '#e2e8f0',
        lines: '#94a3b8'
      }
    case 'black':
    default:
      return {
        primary: new THREE.Color('#22d3ee'),   // ciano elétrico
        secondary: new THREE.Color('#3b82f6'), // azul profundo
        accent: new THREE.Color('#c084fc'),    // violeta claro
        glow: '#06b6d4',
        lines: '#1e40af'
      }
  }
}

// Textura de glow de fallback em memória (Canvas HTML)
function createFallbackGlowTexture(glowColorStr: string) {
  const canvas = document.createElement('canvas')
  canvas.width = 64
  canvas.height = 64
  const ctx = canvas.getContext('2d')
  if (!ctx) return null

  const grad = ctx.createRadialGradient(32, 32, 0, 32, 32, 32)
  grad.addColorStop(0, 'rgba(255, 255, 255, 1)')
  grad.addColorStop(0.2, 'rgba(255, 255, 255, 0.95)')
  grad.addColorStop(0.5, glowColorStr)
  grad.addColorStop(1, 'rgba(0, 0, 0, 0)')

  ctx.fillStyle = grad
  ctx.fillRect(0, 0, 64, 64)

  const texture = new THREE.CanvasTexture(canvas)
  return texture
}

// Resolve assets em dev, web build e Electron empacotado com base relativa.
function getPublicAssetPath(path: string) {
  const normalizedPath = path.replace(/^\//, '')
  const bridge = (window as unknown as { nexus?: NexusBridge }).nexus

  if (bridge?.assetBase) {
    return `${bridge.assetBase}${normalizedPath}`
  }

  if (window.location.protocol === 'file:') {
    return new URL(normalizedPath, window.location.href).href
  }

  return `${import.meta.env.BASE_URL}${normalizedPath}`
}

// Cria um cérebro procedural denso quando o modelo 3D não estiver disponível.
function createFallbackBrainPoints() {
  const points: THREE.Vector3[] = []

  const addLobe = (centerX: number, centerY: number, centerZ: number, scaleX: number, scaleY: number, scaleZ: number, amount: number) => {
    for (let i = 0; i < amount; i++) {
      const theta = Math.acos(1 - 2 * Math.random())
      const phi = Math.random() * Math.PI * 2
      const r = 0.72 + Math.random() * 0.3
      const wrinkle = 1 + Math.sin(phi * 7 + theta * 5) * 0.08

      points.push(new THREE.Vector3(
        centerX + r * Math.sin(theta) * Math.cos(phi) * scaleX * wrinkle,
        centerY + r * Math.cos(theta) * scaleY,
        centerZ + r * Math.sin(theta) * Math.sin(phi) * scaleZ * wrinkle
      ))
    }
  }

  addLobe(-0.36, 0.05, 0, 0.82, 0.72, 0.58, 1250)
  addLobe(0.36, 0.05, 0, 0.82, 0.72, 0.58, 1250)
  addLobe(0, -0.38, -0.02, 0.42, 0.32, 0.34, 420)

  for (let i = 0; i < 280; i++) {
    const t = i / 280
    const angle = t * Math.PI * 5.5
    points.push(new THREE.Vector3(
      Math.sin(angle) * (0.09 + t * 0.08),
      -0.72 - t * 0.42,
      Math.cos(angle) * (0.08 + t * 0.06)
    ))
  }

  return points
}

// Libera recursos carregados de forma assíncrona quando a tela já foi desmontada
function disposeObject3D(object: THREE.Object3D) {
  object.traverse((child) => {
    if (child instanceof THREE.Mesh) {
      child.geometry?.dispose()
      const materials = Array.isArray(child.material) ? child.material : [child.material]
      materials.forEach((material) => material?.dispose())
    }
  })
}

export function HomeBrain({ theme, aiState, memoryCount }: HomeBrainProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [loading, setLoading] = useState(true)

  // Refs mutáveis para controle no render loop
  const aiStateRef = useRef<AiState>(aiState)
  const themeRef = useRef<ThemeMode>(theme)
  const memoryCountRef = useRef<number>(memoryCount)
  const triggerBurstRef = useRef<(() => void) | null>(null)

  useEffect(() => {
    aiStateRef.current = aiState
    themeRef.current = theme
  }, [aiState, theme])

  useEffect(() => {
    if (memoryCount > memoryCountRef.current) {
      if (triggerBurstRef.current) {
        triggerBurstRef.current()
      }
    }
    memoryCountRef.current = memoryCount
  }, [memoryCount])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    let disposed = false
    let isPageVisible = document.visibilityState === 'visible'
    let isCanvasVisible = true

    const width = container.clientWidth || 400
    const height = container.clientHeight || 400

    // 1. Scene & Camera
    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 100)
    camera.position.z = 3.15

    // 2. Renderer
    const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5))
    renderer.setSize(width, height)
    container.appendChild(renderer.domElement)

    // 3. Grupo principal para rotação/tilt
    const brainGroup = new THREE.Group()
    scene.add(brainGroup)

    let brainGeometry: THREE.BufferGeometry | null = null
    let brainMaterial: THREE.PointsMaterial | null = null
    let brainPointsMesh: THREE.Points | null = null

    let linesGeometry: THREE.BufferGeometry | null = null
    let linesMaterial: THREE.LineBasicMaterial | null = null
    let linesMesh: THREE.LineSegments | null = null

    let sparksGeometry: THREE.BufferGeometry | null = null
    let sparksMaterial: THREE.PointsMaterial | null = null
    let sparksMesh: THREE.Points | null = null

    let burstGeometry: THREE.BufferGeometry | null = null
    let burstMaterial: THREE.PointsMaterial | null = null
    let burstMesh: THREE.Points | null = null

    // Arrays para guardar as coordenadas finais
    const brainPoints: THREE.Vector3[] = []
    const initialPositions: Float32Array[] = []
    let totalPoints = 0
    let modelBuilt = false
    let sparkPaths: Array<{ startIdx: number; endIdx: number; progress: number; speed: number }> = []
    const linePairs: number[] = []

    // 4. Instancia loaders
    const textureLoader = new THREE.TextureLoader()
    const objLoader = new OBJLoader()

    const currentColors = getThemeColors(themeRef.current)
    const fallbackSparkTexture = createFallbackGlowTexture(currentColors.glow)
    let sparkTexture: THREE.Texture | null = fallbackSparkTexture

    // Tenta carregar a textura spark1
    textureLoader.load(
      getPublicAssetPath('/textures/spark1.png'),
      (tex) => {
        if (disposed) {
          tex.dispose()
          return
        }
        if (sparkTexture && sparkTexture !== tex) {
          sparkTexture.dispose()
        }
        sparkTexture = tex
        if (brainMaterial) {
          brainMaterial.map = tex
          brainMaterial.needsUpdate = true
        }
        if (sparksMaterial) {
          sparksMaterial.map = tex
          sparksMaterial.needsUpdate = true
        }
        if (burstMaterial) {
          burstMaterial.map = tex
          burstMaterial.needsUpdate = true
        }
      },
      undefined,
      (err) => console.warn('Usando fallback de textura canvas local.', err)
    )

    const handleModelReady = (obj: THREE.Group) => {
        if (disposed || modelBuilt) {
          disposeObject3D(obj)
          return
        }
        modelBuilt = true
        setLoading(false)
        const tempPositions: THREE.Vector3[] = []

        // Extrai vértices de todas as malhas do modelo
        obj.traverse((child: THREE.Object3D) => {
          if (child instanceof THREE.Mesh) {
            const posAttr = child.geometry.attributes.position
            if (posAttr) {
              const arr = posAttr.array
              // Downsample para manter a performance alta (miramos em ~2200 partículas)
              const step = Math.max(1, Math.floor((arr.length / 3) / 2200))
              for (let i = 0; i < arr.length; i += 3 * step) {
                tempPositions.push(new THREE.Vector3(arr[i], arr[i + 1], arr[i + 2]))
              }
            }
          }
        })

        // Se falhar no carregamento de vértices, cria uma esfera padrão de fallback
        if (tempPositions.length === 0) {
          console.warn('Nenhum vértice encontrado no OBJ, usando fallback procedimental.')
          tempPositions.push(...createFallbackBrainPoints())
        }

        // Centraliza e normaliza escala do cérebro carregado
        const tempGeom = new THREE.BufferGeometry().setFromPoints(tempPositions)
        tempGeom.computeBoundingBox()
        const box = tempGeom.boundingBox
        if (box) {
          const size = new THREE.Vector3()
          box.getSize(size)
          const center = new THREE.Vector3()
          box.getCenter(center)

          const maxDim = Math.max(size.x, size.y, size.z)
          const scaleFactor = 2.05 / maxDim // tamanho final aproximado, com respiro para não cortar no enquadramento

          for (let i = 0; i < tempPositions.length; i++) {
            const p = tempPositions[i]
            p.sub(center).multiplyScalar(scaleFactor)
            
            // Corrige orientação se necessário (gira 90 graus no Y se o modelo estiver de lado)
            // O modelo original BrainUVs.obj geralmente vem em pé
            brainPoints.push(p)
          }
        }

        totalPoints = brainPoints.length

        // 6. Prepara buffers das partículas do cérebro
        const positions = new Float32Array(totalPoints * 3)
        const colors = new Float32Array(totalPoints * 3)

        const cCols = getThemeColors(themeRef.current)

        for (let i = 0; i < totalPoints; i++) {
          const p = brainPoints[i]
          positions[i * 3 + 0] = p.x
          positions[i * 3 + 1] = p.y
          positions[i * 3 + 2] = p.z

          initialPositions.push(new Float32Array([p.x, p.y, p.z]))

          // Color-coding inteligente baseado em hemisférios (Vision Pro style)
          let col = cCols.primary // esquerdo
          if (Math.abs(p.x) < 0.15) {
            col = cCols.accent // fenda/núcleo central
          } else if (p.x > 0) {
            col = cCols.secondary // direito
          }

          colors[i * 3 + 0] = col.r
          colors[i * 3 + 1] = col.g
          colors[i * 3 + 2] = col.b
        }

        brainGeometry = new THREE.BufferGeometry()
        brainGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
        brainGeometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))

        brainMaterial = new THREE.PointsMaterial({
          size: 0.038,
          vertexColors: true,
          map: sparkTexture || undefined,
          transparent: true,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          sizeAttenuation: true
        })

        brainPointsMesh = new THREE.Points(brainGeometry, brainMaterial)
        brainGroup.add(brainPointsMesh)

        // 7. Cria as linhas de conexões sinápticas (Synapses)
        const maxLines = 650
        let linesCreated = 0

        for (let i = 0; i < totalPoints; i += 2) {
          if (linesCreated >= maxLines) break
          const p1 = brainPoints[i]

          for (let j = i + 1; j < Math.min(i + 160, totalPoints); j++) {
            const p2 = brainPoints[j]
            const dSq = p1.distanceToSquared(p2)

            // Se a distância quadrada for menor que ~0.045
            if (dSq < 0.045) {
              linePairs.push(i, j)
              linesCreated++
              if (linesCreated >= maxLines) break
            }
          }
        }

        const linePositions = new Float32Array(linePairs.length * 3)
        const lineColors = new Float32Array(linePairs.length * 3)
        const lineCol = new THREE.Color(cCols.lines)

        for (let k = 0; k < linePairs.length; k++) {
          const idx = linePairs[k]
          const p = brainPoints[idx]
          linePositions[k * 3 + 0] = p.x
          linePositions[k * 3 + 1] = p.y
          linePositions[k * 3 + 2] = p.z

          lineColors[k * 3 + 0] = lineCol.r * 0.4
          lineColors[k * 3 + 1] = lineCol.g * 0.4
          lineColors[k * 3 + 2] = lineCol.b * 0.4
        }

        linesGeometry = new THREE.BufferGeometry()
        linesGeometry.setAttribute('position', new THREE.BufferAttribute(linePositions, 3))
        linesGeometry.setAttribute('color', new THREE.BufferAttribute(lineColors, 3))

        linesMaterial = new THREE.LineBasicMaterial({
          vertexColors: true,
          transparent: true,
          opacity: 0.15,
          blending: THREE.AdditiveBlending,
          depthWrite: false
        })

        linesMesh = new THREE.LineSegments(linesGeometry, linesMaterial)
        brainGroup.add(linesMesh)

        // 8. Cria os fluxos de partículas de energia
        const numSparks = 24
        const sparksPositions = new Float32Array(numSparks * 3)
        const sparksColors = new Float32Array(numSparks * 3)

        sparkPaths = Array.from({ length: numSparks }, () => {
          const lineIdx = Math.floor(Math.random() * (linePairs.length / 2)) * 2
          return {
            startIdx: linePairs[lineIdx] || 0,
            endIdx: linePairs[lineIdx + 1] || 0,
            progress: Math.random(),
            speed: 0.005 + Math.random() * 0.009
          }
        })

        sparksGeometry = new THREE.BufferGeometry()
        sparksGeometry.setAttribute('position', new THREE.BufferAttribute(sparksPositions, 3))
        sparksGeometry.setAttribute('color', new THREE.BufferAttribute(sparksColors, 3))

        sparksMaterial = new THREE.PointsMaterial({
          size: 0.065,
          vertexColors: true,
          map: sparkTexture || undefined,
          transparent: true,
          blending: THREE.AdditiveBlending,
          depthWrite: false
        })

        sparksMesh = new THREE.Points(sparksGeometry, sparksMaterial)
        brainGroup.add(sparksMesh)

        disposeObject3D(obj)
    }

    const buildFallbackModel = () => {
      if (disposed || modelBuilt) return
      console.warn('Modelo BrainUVs.obj demorou para carregar, usando fallback procedimental.')
      const fallbackObject = new THREE.Group()
      const fallbackGeometry = new THREE.BufferGeometry().setFromPoints(createFallbackBrainPoints())
      fallbackObject.add(new THREE.Mesh(fallbackGeometry))
      handleModelReady(fallbackObject)
    }

    // 5. Carrega o modelo OBJ
    const fallbackTimer = window.setTimeout(buildFallbackModel, 9000)
    objLoader.load(
      getPublicAssetPath('/models/BrainUVs.obj'),
      handleModelReady,
      undefined,
      (err: any) => {
        if (disposed) return
        console.error('Erro ao carregar modelo BrainUVs.obj, usando fallback.', err)
        buildFallbackModel()
      }
    )

    // 9. Configura sistema de explosões de memória (Bursts)
    const maxBurstParticles = 120
    const burstPositions = new Float32Array(maxBurstParticles * 3)
    const burstColors = new Float32Array(maxBurstParticles * 3)

    // Coloca longe da visão
    for (let i = 0; i < maxBurstParticles; i++) {
      burstPositions[i * 3 + 0] = 999
    }

    burstGeometry = new THREE.BufferGeometry()
    const burstPosAttr = new THREE.BufferAttribute(burstPositions, 3)
    burstGeometry.setAttribute('position', burstPosAttr)
    burstGeometry.setAttribute('color', new THREE.BufferAttribute(burstColors, 3))

    burstMaterial = new THREE.PointsMaterial({
      size: 0.06,
      vertexColors: true,
      map: sparkTexture || undefined,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    })

    burstMesh = new THREE.Points(burstGeometry, burstMaterial)
    brainGroup.add(burstMesh)

    const activeBurstParticles: Array<{
      pos: THREE.Vector3
      vel: THREE.Vector3
      color: THREE.Color
      age: number
      maxAge: number
    }> = []

    triggerBurstRef.current = () => {
      const cCols = getThemeColors(themeRef.current)
      for (let i = 0; i < 75; i++) {
        const theta = Math.random() * Math.PI * 2
        const phi = Math.acos(2 * Math.random() - 1)
        const speed = 0.016 + Math.random() * 0.032

        const vel = new THREE.Vector3(
          Math.sin(phi) * Math.cos(theta) * speed,
          Math.sin(phi) * Math.sin(theta) * speed,
          Math.cos(phi) * speed
        )

        const col = Math.random() > 0.45 ? cCols.accent : cCols.primary

        activeBurstParticles.push({
          pos: new THREE.Vector3(
            (Math.random() - 0.5) * 0.12,
            (Math.random() - 0.5) * 0.12,
            (Math.random() - 0.5) * 0.12
          ),
          vel,
          color: new THREE.Color(col),
          age: 0,
          maxAge: 35 + Math.random() * 45
        })

        if (activeBurstParticles.length > maxBurstParticles) {
          activeBurstParticles.shift()
        }
      }
    }

    // 10. Interação suave do mouse dentro da área do cérebro
    const mouse = { x: 0, y: 0, targetX: 0, targetY: 0 }
    let mouseActive = false
    const localMouseCurrent = new THREE.Vector3(999, 999, 999)
    const localMouseTarget = new THREE.Vector3(999, 999, 999)
    const parkedMouse = new THREE.Vector3(999, 999, 999)

    const handlePointerMove = (event: PointerEvent) => {
      const rect = container.getBoundingClientRect()
      const mx = ((event.clientX - rect.left) / rect.width) * 2 - 1
      const my = -((event.clientY - rect.top) / rect.height) * 2 + 1

      mouse.targetX = THREE.MathUtils.clamp(mx, -1, 1)
      mouse.targetY = THREE.MathUtils.clamp(my, -1, 1)

      // Projeta o mouse da tela para o plano 3D do cérebro.
      const projected = new THREE.Vector3(mouse.targetX, mouse.targetY, 0.5)
      projected.unproject(camera)
      const direction = projected.sub(camera.position).normalize()
      const distanceToPlane = -camera.position.z / direction.z
      const mouseWorld = camera.position.clone().add(direction.multiplyScalar(distanceToPlane))

      localMouseTarget.copy(mouseWorld)
      brainGroup.worldToLocal(localMouseTarget)
    }

    const handlePointerEnter = () => {
      mouseActive = true
    }

    const handlePointerLeave = () => {
      mouseActive = false
    }

    const handleVisibilityChange = () => {
      isPageVisible = document.visibilityState === 'visible'
    }

    container.addEventListener('pointermove', handlePointerMove)
    container.addEventListener('pointerenter', handlePointerEnter)
    container.addEventListener('pointerleave', handlePointerLeave)
    document.addEventListener('visibilitychange', handleVisibilityChange)

    // 11. Render Loop
    let clock = new THREE.Clock()
    let frameId: number

    const animate = () => {
      frameId = requestAnimationFrame(animate)
      if (!isPageVisible || !isCanvasVisible || disposed) {
        return
      }

      const time = clock.getElapsedTime()
      const state = aiStateRef.current
      const currentTheme = themeRef.current
      const cCols = getThemeColors(currentTheme)

      const isThinking = state === 'thinking' || state === 'speaking'
      const pulseFrequency = isThinking ? 3.6 : 1.5
      const pulseIntensity = isThinking ? 0.03 : 0.01

      // Rotação automática lenta, com tilt suave quando o mouse está no cérebro.
      brainGroup.rotation.y += isThinking ? 0.0022 : 0.0012
      mouse.x += ((mouseActive ? mouse.targetX : 0) - mouse.x) * 0.08
      mouse.y += ((mouseActive ? mouse.targetY : 0) - mouse.y) * 0.08
      brainGroup.rotation.x = Math.sin(time * 0.18) * 0.035 + mouse.y * 0.08
      brainGroup.rotation.z = Math.cos(time * 0.14) * 0.018 - mouse.x * 0.12

      // Pulsação senoidal
      const scale = 1.0 + Math.sin(time * pulseFrequency) * pulseIntensity
      brainGroup.scale.set(scale, scale, scale)

      if (mouseActive) {
        localMouseCurrent.lerp(localMouseTarget, 0.08)
      } else {
        localMouseCurrent.lerp(parkedMouse, 0.08)
      }

      // Atualiza drift local senoidal individual das partículas do cérebro (se já carregado)
      if (brainGeometry && brainPointsMesh) {
        const posAttr = brainGeometry.getAttribute('position') as THREE.BufferAttribute
        for (let i = 0; i < totalPoints; i++) {
          const initPos = initialPositions[i]
          if (initPos) {
            const px = initPos[0]
            const py = initPos[1]
            const pz = initPos[2]

            // Drift senoidal orgânico local
            const drift = 1.0 + Math.sin(time * 1.4 + px * 3.5) * 0.01
            
            const baseX = px * drift
            const baseY = py * drift
            const baseZ = pz * drift

            const dx = baseX - localMouseCurrent.x
            const dy = baseY - localMouseCurrent.y
            const dz = baseZ - localMouseCurrent.z
            const dist = Math.sqrt(dx * dx + dy * dy + dz * dz)
            const radius = 0.62

            let finalX = baseX
            let finalY = baseY
            let finalZ = baseZ

            if (dist < radius) {
              const force = (1.0 - dist / radius) * 0.34
              const dirX = dist > 0.001 ? dx / dist : 0
              const dirY = dist > 0.001 ? dy / dist : 0
              const dirZ = dist > 0.001 ? dz / dist : 0

              finalX += dirX * force
              finalY += dirY * force
              finalZ += dirZ * force
            }

            posAttr.setXYZ(i, finalX, finalY, finalZ)
          }
        }
        posAttr.needsUpdate = true

        // Atualiza cores de forma gradual se o tema mudar
        const colorsAttr = brainGeometry.getAttribute('color') as THREE.BufferAttribute
        for (let i = 0; i < totalPoints; i++) {
          const p = brainPoints[i]
          let targetCol = cCols.primary
          if (Math.abs(p.x) < 0.15) {
            targetCol = cCols.accent
          } else if (p.x > 0) {
            targetCol = cCols.secondary
          }

          const cr = colorsAttr.getX(i)
          const cg = colorsAttr.getY(i)
          const cb = colorsAttr.getZ(i)

          colorsAttr.setXYZ(
            i,
            cr + (targetCol.r - cr) * 0.08,
            cg + (targetCol.g - cg) * 0.08,
            cb + (targetCol.b - cb) * 0.08
          )
        }
        colorsAttr.needsUpdate = true
      }

      // Atualiza as centelhas de energia (correndo sobre as conexões deformadas dinamicamente)
      if (sparksGeometry && sparksMesh && sparkPaths.length > 0 && brainGeometry) {
        const sparksPosAttr = sparksGeometry.getAttribute('position') as THREE.BufferAttribute
        const sparksColorsAttr = sparksGeometry.getAttribute('color') as THREE.BufferAttribute
        const brainPosAttr = brainGeometry.getAttribute('position') as THREE.BufferAttribute

        for (let i = 0; i < sparkPaths.length; i++) {
          const path = sparkPaths[i]
          path.progress += path.speed * (isThinking ? 1.7 : 1.0)

          if (path.progress >= 1.0) {
            path.progress = 0
            const lineIdx = Math.floor(Math.random() * (linePairs.length / 2)) * 2
            path.startIdx = linePairs[lineIdx] || 0
            path.endIdx = linePairs[lineIdx + 1] || 0
          }

          // Posiciona as centelhas com base nos pontos deformados locais das partículas
          const x1 = brainPosAttr.getX(path.startIdx)
          const y1 = brainPosAttr.getY(path.startIdx)
          const z1 = brainPosAttr.getZ(path.startIdx)

          const x2 = brainPosAttr.getX(path.endIdx)
          const y2 = brainPosAttr.getY(path.endIdx)
          const z2 = brainPosAttr.getZ(path.endIdx)

          const sx = x1 + (x2 - x1) * path.progress
          const sy = y1 + (y2 - y1) * path.progress
          const sz = z1 + (z2 - z1) * path.progress

          sparksPosAttr.setXYZ(i, sx, sy, sz)

          const col = Math.random() > 0.5 ? cCols.primary : cCols.accent
          const alpha = Math.sin(path.progress * Math.PI) * (isThinking ? 1.0 : 0.6)
          sparksColorsAttr.setXYZ(i, col.r * alpha, col.g * alpha, col.b * alpha)
        }
        sparksPosAttr.needsUpdate = true
        sparksColorsAttr.needsUpdate = true
      }

      // Atualiza posições e cores das conexões sinápticas (deformadas dinamicamente)
      if (linesGeometry && linesMesh && brainGeometry) {
        const linePosAttr = linesGeometry.getAttribute('position') as THREE.BufferAttribute
        const brainPosAttr = brainGeometry.getAttribute('position') as THREE.BufferAttribute

        for (let k = 0; k < linePairs.length / 2; k++) {
          const idx1 = linePairs[k * 2]
          const idx2 = linePairs[k * 2 + 1]

          const x1 = brainPosAttr.getX(idx1)
          const y1 = brainPosAttr.getY(idx1)
          const z1 = brainPosAttr.getZ(idx1)

          const x2 = brainPosAttr.getX(idx2)
          const y2 = brainPosAttr.getY(idx2)
          const z2 = brainPosAttr.getZ(idx2)

          linePosAttr.setXYZ(k * 2, x1, y1, z1)
          linePosAttr.setXYZ(k * 2 + 1, x2, y2, z2)
        }
        linePosAttr.needsUpdate = true

        const lineColorsAttr = linesGeometry.getAttribute('color') as THREE.BufferAttribute
        const currentLines = new THREE.Color(cCols.lines)

        for (let k = 0; k < lineColorsAttr.count; k++) {
          const lr = lineColorsAttr.getX(k)
          const lg = lineColorsAttr.getY(k)
          const lb = lineColorsAttr.getZ(k)

          lineColorsAttr.setXYZ(
            k,
            lr + (currentLines.r * 0.4 - lr) * 0.08,
            lg + (currentLines.g * 0.4 - lg) * 0.08,
            lb + (currentLines.b * 0.4 - lb) * 0.08
          )
        }
        lineColorsAttr.needsUpdate = true
      }

      // Atualiza explosão de memórias
      if (burstGeometry && burstMesh) {
        const burstColorsAttr = burstGeometry.getAttribute('color') as THREE.BufferAttribute

        for (let i = 0; i < maxBurstParticles; i++) {
          burstPosAttr.setXYZ(i, 999, 999, 999)
        }

        for (let i = activeBurstParticles.length - 1; i >= 0; i--) {
          const p = activeBurstParticles[i]
          p.age++

          if (p.age >= p.maxAge) {
            activeBurstParticles.splice(i, 1)
            continue
          }

          p.pos.add(p.vel)
          p.vel.multiplyScalar(0.96) // fricção

          if (i < maxBurstParticles) {
            burstPosAttr.setXYZ(i, p.pos.x, p.pos.y, p.pos.z)
            const ratio = 1.0 - p.age / p.maxAge
            burstColorsAttr.setXYZ(i, p.color.r * ratio, p.color.g * ratio, p.color.b * ratio)
          }
        }
        burstPosAttr.needsUpdate = true
        burstColorsAttr.needsUpdate = true
      }

      // Brilho do material
      if (brainMaterial) {
        brainMaterial.color.set(isThinking ? '#ffffff' : '#f1f5f9')
      }

      renderer.render(scene, camera)
    }

    animate()

    // 12. Resize Observer
    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const w = entry.contentRect.width || 400
        const h = entry.contentRect.height || 400
        camera.aspect = w / h
        camera.updateProjectionMatrix()
        renderer.setSize(w, h)
      }
    })
    resizeObserver.observe(container)

    const intersectionObserver = new IntersectionObserver(([entry]) => {
      isCanvasVisible = entry.isIntersecting
    }, { threshold: 0.01 })
    intersectionObserver.observe(container)

    // 13. Cleanup
    return () => {
      disposed = true
      cancelAnimationFrame(frameId)
      window.clearTimeout(fallbackTimer)
      container.removeEventListener('pointermove', handlePointerMove)
      container.removeEventListener('pointerenter', handlePointerEnter)
      container.removeEventListener('pointerleave', handlePointerLeave)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      resizeObserver.disconnect()
      intersectionObserver.disconnect()

      if (container.contains(renderer.domElement)) {
        container.removeChild(renderer.domElement)
      }

      if (brainGeometry) brainGeometry.dispose()
      if (brainMaterial) brainMaterial.dispose()
      if (linesGeometry) linesGeometry.dispose()
      if (linesMaterial) linesMaterial.dispose()
      if (sparksGeometry) sparksGeometry.dispose()
      if (sparksMaterial) sparksMaterial.dispose()
      if (burstGeometry) burstGeometry.dispose()
      if (burstMaterial) burstMaterial.dispose()
      if (sparkTexture) sparkTexture.dispose()

      renderer.dispose()
    }
  }, [])

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative', overflow: 'visible' }}>
      {loading && (
        <div style={{
          position: 'absolute',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          color: 'var(--muted)',
          fontSize: '12px',
          fontWeight: 500,
          letterSpacing: '1px',
          textTransform: 'uppercase',
          animation: 'pulse 1.5s infinite ease-in-out'
        }}>
          Inicializando Cérebro...
        </div>
      )}
      <div ref={containerRef} className="home-brain-canvas-container" style={{ width: '100%', height: '100%', opacity: loading ? 0 : 1, transition: 'opacity 0.5s ease', overflow: 'visible' }} />
    </div>
  )
}
