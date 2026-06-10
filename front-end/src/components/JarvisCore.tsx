import { useEffect, useRef } from 'react'
import * as THREE from 'three'

// Núcleo 3D da tela inicial: anéis, partículas e varreduras inspiradas em interfaces Jarvis.
export function JarvisCore() {
  const mountRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const mount = mountRef.current
    if (!mount) return

    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(46, 1, 0.1, 100)
    camera.position.set(0, 0.1, 5.35)

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5))
    renderer.setClearColor(0x000000, 0)
    mount.appendChild(renderer.domElement)

    const root = new THREE.Group()
    const rings = new THREE.Group()
    const sparks = new THREE.Group()
    const cursorField = new THREE.Group()
    root.scale.setScalar(1.22)
    scene.add(root)
    root.add(rings, sparks, cursorField)

    const style = getComputedStyle(document.documentElement)
    const amber = new THREE.Color(style.getPropertyValue('--accent').trim() || '#f59e0b')
    const hot = new THREE.Color(style.getPropertyValue('--accent-hot').trim() || '#ffd166')
    const deep = new THREE.Color(style.getPropertyValue('--accent-deep').trim() || '#7c2d12')

    const disposables: Array<{ dispose: () => void }> = []

    const coreGeometry = new THREE.SphereGeometry(0.36, 48, 48)
    const coreMaterial = new THREE.MeshBasicMaterial({
      color: hot,
      transparent: true,
      opacity: 0.88,
      blending: THREE.AdditiveBlending,
    })
    disposables.push(coreGeometry, coreMaterial)
    const core = new THREE.Mesh(coreGeometry, coreMaterial)
    root.add(core)

    const haloGeometry = new THREE.SphereGeometry(0.78, 64, 64)
    const haloMaterial = new THREE.MeshBasicMaterial({
      color: amber,
      transparent: true,
      opacity: 0.14,
      blending: THREE.AdditiveBlending,
      wireframe: true,
    })
    disposables.push(haloGeometry, haloMaterial)
    root.add(new THREE.Mesh(haloGeometry, haloMaterial))

    const cursorGeometry = new THREE.TorusGeometry(0.34, 0.006, 8, 96)
    const cursorMaterial = new THREE.MeshBasicMaterial({
      color: hot,
      transparent: true,
      opacity: 0.28,
      blending: THREE.AdditiveBlending,
    })
    disposables.push(cursorGeometry, cursorMaterial)
    const cursorRing = new THREE.Mesh(cursorGeometry, cursorMaterial)
    cursorRing.position.z = 0.42
    cursorField.add(cursorRing)

    const cursorDotGeometry = new THREE.SphereGeometry(0.045, 24, 24)
    const cursorDotMaterial = new THREE.MeshBasicMaterial({
      color: hot,
      transparent: true,
      opacity: 0.72,
      blending: THREE.AdditiveBlending,
    })
    disposables.push(cursorDotGeometry, cursorDotMaterial)
    const cursorDot = new THREE.Mesh(cursorDotGeometry, cursorDotMaterial)
    cursorDot.position.z = 0.42
    cursorField.add(cursorDot)

    const ringMaterials = [
      new THREE.MeshBasicMaterial({ color: amber, transparent: true, opacity: 0.72, blending: THREE.AdditiveBlending }),
      new THREE.MeshBasicMaterial({ color: hot, transparent: true, opacity: 0.34, blending: THREE.AdditiveBlending }),
      new THREE.MeshBasicMaterial({ color: deep, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending }),
    ]
    ringMaterials.forEach(material => disposables.push(material))

    for (let index = 0; index < 9; index += 1) {
      const radius = 1.05 + index * 0.25
      const tube = index % 3 === 0 ? 0.01 : 0.006
      const geometry = new THREE.TorusGeometry(radius, tube, 8, 160)
      disposables.push(geometry)
      const ring = new THREE.Mesh(geometry, ringMaterials[index % ringMaterials.length])
      ring.rotation.x = Math.PI / 2 + (index % 2) * 0.22
      ring.rotation.y = index * 0.17
      ring.userData = { speed: 0.0018 + index * 0.00035, direction: index % 2 ? -1 : 1 }
      rings.add(ring)
    }

    const radialMaterial = new THREE.LineBasicMaterial({
      color: amber,
      transparent: true,
      opacity: 0.34,
      blending: THREE.AdditiveBlending,
    })
    disposables.push(radialMaterial)
    for (let index = 0; index < 78; index += 1) {
      const angle = index * 2.399963
      const inner = 0.62 + (index % 8) * 0.04
      const outer = 1.9 + (index % 11) * 0.14
      const z = ((index % 7) - 3) * 0.025
      const geometry = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(Math.cos(angle) * inner, Math.sin(angle) * inner, z),
        new THREE.Vector3(Math.cos(angle) * outer, Math.sin(angle) * outer, z),
      ])
      disposables.push(geometry)
      const line = new THREE.Line(geometry, radialMaterial)
      line.userData = { speed: 0.001 + (index % 5) * 0.0002 }
      sparks.add(line)
    }

    const particleCount = 760
    const positions = new Float32Array(particleCount * 3)
    const basePositions = new Float32Array(particleCount * 3)
    const sizes = new Float32Array(particleCount)
    for (let index = 0; index < particleCount; index += 1) {
      const angle = index * 2.399963
      const radius = 1.12 + Math.random() * 1.85
      const band = (Math.random() - 0.5) * 0.6
      positions[index * 3] = Math.cos(angle) * radius
      positions[index * 3 + 1] = Math.sin(angle) * radius
      positions[index * 3 + 2] = band
      basePositions[index * 3] = positions[index * 3]
      basePositions[index * 3 + 1] = positions[index * 3 + 1]
      basePositions[index * 3 + 2] = positions[index * 3 + 2]
      sizes[index] = Math.random()
    }
    const particleGeometry = new THREE.BufferGeometry()
    particleGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    particleGeometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1))
    const particleMaterial = new THREE.PointsMaterial({
      color: amber,
      size: 0.026,
      sizeAttenuation: true,
      transparent: true,
      opacity: 0.78,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    })
    disposables.push(particleGeometry, particleMaterial)
    const particles = new THREE.Points(particleGeometry, particleMaterial)
    root.add(particles)

    const ambient = new THREE.PointLight(hot, 1.5, 14)
    ambient.position.set(0, 0, 4)
    scene.add(ambient)

    const cursorLight = new THREE.PointLight(hot, 2.4, 5.4)
    cursorLight.position.set(0, 0, 2.8)
    scene.add(cursorLight)

    const resize = () => {
      const width = Math.max(mount.clientWidth, 280)
      const height = Math.max(mount.clientHeight, 280)
      camera.aspect = width / height
      camera.updateProjectionMatrix()
      renderer.setSize(width, height)
    }
    resize()
    const observer = new ResizeObserver(resize)
    observer.observe(mount)

    const pointerTarget = new THREE.Vector2(0, 0)
    const pointer = new THREE.Vector2(0, 0)
    const targetScale = new THREE.Vector3(1.22, 1.22, 1.22)
    let pointerPulse = 0

    const onPointerMove = (event: PointerEvent) => {
      const rect = mount.getBoundingClientRect()
      const x = ((event.clientX - rect.left) / rect.width) * 2 - 1
      const y = -(((event.clientY - rect.top) / rect.height) * 2 - 1)
      pointerTarget.set(Math.max(-1, Math.min(1, x)), Math.max(-1, Math.min(1, y)))
      pointerPulse = Math.min(1, pointerPulse + 0.18)
    }

    const onPointerLeave = () => {
      pointerTarget.set(0, 0)
    }

    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerleave', onPointerLeave)

    let frame = 0
    let animationId = 0
    const animate = () => {
      frame += 1
      pointer.lerp(pointerTarget, 0.075)
      pointerPulse *= 0.94

      const cursorX = pointer.x * 1.75
      const cursorY = pointer.y * 1.18

      root.rotation.y += 0.0024 + pointerPulse * 0.002
      root.rotation.x = THREE.MathUtils.lerp(root.rotation.x, pointer.y * 0.16, 0.06)
      root.rotation.z = Math.sin(frame * 0.008) * 0.04 - pointer.x * 0.1
      root.position.x = THREE.MathUtils.lerp(root.position.x, pointer.x * 0.18, 0.05)
      root.position.y = THREE.MathUtils.lerp(root.position.y, pointer.y * 0.12, 0.05)
      targetScale.setScalar(1.22 + pointerPulse * 0.08)
      root.scale.lerp(targetScale, 0.08)

      rings.children.forEach(child => {
        child.rotation.z += (child.userData.speed + pointerPulse * 0.002) * child.userData.direction
        child.rotation.x += pointer.y * 0.0004 * child.userData.direction
        child.rotation.y += pointer.x * 0.0004 * child.userData.direction
      })

      sparks.rotation.z -= 0.0022
      particles.rotation.z += 0.0014
      particles.rotation.x = Math.sin(frame * 0.006) * 0.16
      core.scale.setScalar(1 + Math.sin(frame * 0.05) * 0.08 + pointerPulse * 0.1)

      cursorField.position.x = THREE.MathUtils.lerp(cursorField.position.x, cursorX, 0.12)
      cursorField.position.y = THREE.MathUtils.lerp(cursorField.position.y, cursorY, 0.12)
      cursorField.rotation.z -= 0.025 + pointerPulse * 0.025
      cursorRing.scale.setScalar(1 + Math.sin(frame * 0.08) * 0.12 + pointerPulse * 0.42)
      cursorMaterial.opacity = 0.18 + pointerPulse * 0.38
      cursorDotMaterial.opacity = 0.48 + pointerPulse * 0.42
      cursorLight.position.set(cursorField.position.x, cursorField.position.y, 2.8)
      cursorLight.intensity = 1.6 + pointerPulse * 3.4

      for (let index = 0; index < particleCount; index += 1) {
        const offset = index * 3
        const baseX = basePositions[offset]
        const baseY = basePositions[offset + 1]
        const dx = baseX - cursorX
        const dy = baseY - cursorY
        const distance = Math.max(0.18, Math.sqrt(dx * dx + dy * dy))
        const pull = Math.max(0, 1.15 - distance) * (0.1 + pointerPulse * 0.36)
        positions[offset] = baseX + (dx / distance) * pull + Math.sin(frame * 0.012 + index) * 0.004
        positions[offset + 1] = baseY + (dy / distance) * pull + Math.cos(frame * 0.01 + index) * 0.004
        positions[offset + 2] = basePositions[offset + 2] + pull * 0.42
      }
      particleGeometry.attributes.position.needsUpdate = true

      renderer.render(scene, camera)
      animationId = window.requestAnimationFrame(animate)
    }
    animate()

    return () => {
      window.cancelAnimationFrame(animationId)
      observer.disconnect()
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerleave', onPointerLeave)
      renderer.dispose()
      disposables.forEach(item => item.dispose())
      mount.removeChild(renderer.domElement)
    }
  }, [])

  return <div ref={mountRef} className="jarvis-core-canvas" aria-label="Núcleo Jarvis 3D animado" />
}
