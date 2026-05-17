// Container-scoped liquid gradient. Adapted from Made By Beings' liquid gradient shader.
// Mounts a WebGL canvas inside `container` and animates a flowing gradient with cursor displacement.
//
// Usage:
//   const handle = initLiquidGradient(containerEl, { scheme: 1, speedScale: 1 });
//   handle.destroy();
//
// `container` MUST be position: relative. The canvas is positioned absolutely inside.

import * as THREE from "three"

type SchemeKey = 1 | 2 | 3

type Scheme = {
  bg: number
  base: [number, number, number]
  colors: [number, number, number][]
  gradientSize: number
  gradientCount: number
  speed: number
  w1: number
  w2: number
}

const SCHEMES: Record<SchemeKey, Scheme> = {
  // 1 — Orange + Navy
  1: {
    bg: 0x0a0e27,
    base: [0.039, 0.055, 0.153],
    colors: [
      [0.945, 0.353, 0.133], [0.039, 0.055, 0.153],
      [0.945, 0.353, 0.133], [0.039, 0.055, 0.153],
      [0.945, 0.353, 0.133], [0.039, 0.055, 0.153],
    ],
    gradientSize: 0.55, gradientCount: 12, speed: 1.4,
    w1: 0.65, w2: 1.6,
  },
  // 2 — Orange + Navy + Turquoise tri-tone
  2: {
    bg: 0x0a0e27,
    base: [0.039, 0.055, 0.153],
    colors: [
      [0.945, 0.353, 0.133], [0.039, 0.055, 0.153], [0.251, 0.878, 0.816],
      [0.945, 0.353, 0.133], [0.039, 0.055, 0.153], [0.251, 0.878, 0.816],
    ],
    gradientSize: 0.5, gradientCount: 12, speed: 1.3,
    w1: 0.75, w2: 1.4,
  },
  // 3 — Deep teal + Orange (ops feel)
  3: {
    bg: 0x031712,
    base: [0.0, 0.10, 0.09],
    colors: [
      [0.945, 0.353, 0.133], [0.0, 0.259, 0.22],
      [0.945, 0.353, 0.133], [0.0, 0.0, 0.0],
      [0.945, 0.353, 0.133], [0.0, 0.259, 0.22],
    ],
    gradientSize: 0.5, gradientCount: 12, speed: 1.5,
    w1: 0.55, w2: 1.7,
  },
}

type TouchPoint = { x: number; y: number; age: number; force: number; vx: number; vy: number }

class TouchTexture {
  size = 64
  width = 64
  height = 64
  maxAge = 64
  radius: number
  speed: number
  trail: TouchPoint[] = []
  last: { x: number; y: number } | null = null
  canvas: HTMLCanvasElement
  ctx: CanvasRenderingContext2D
  texture: THREE.Texture

  constructor() {
    this.radius = 0.25 * this.size
    this.speed = 1 / this.maxAge
    this.canvas = document.createElement("canvas")
    this.canvas.width = this.width
    this.canvas.height = this.height
    this.ctx = this.canvas.getContext("2d")!
    this.ctx.fillStyle = "black"
    this.ctx.fillRect(0, 0, this.width, this.height)
    this.texture = new THREE.Texture(this.canvas)
  }

  update() {
    this.ctx.fillStyle = "black"
    this.ctx.fillRect(0, 0, this.width, this.height)
    const speed = this.speed
    for (let i = this.trail.length - 1; i >= 0; i--) {
      const p = this.trail[i]
      const f = p.force * speed * (1 - p.age / this.maxAge)
      p.x += p.vx * f
      p.y += p.vy * f
      p.age++
      if (p.age > this.maxAge) this.trail.splice(i, 1)
      else this.drawPoint(p)
    }
    this.texture.needsUpdate = true
  }

  addTouch(point: { x: number; y: number }) {
    let force = 0, vx = 0, vy = 0
    const last = this.last
    if (last) {
      const dx = point.x - last.x, dy = point.y - last.y
      if (dx === 0 && dy === 0) return
      const dd = dx * dx + dy * dy
      const d = Math.sqrt(dd)
      vx = dx / d; vy = dy / d
      force = Math.min(dd * 20000, 2.0)
    }
    this.last = { x: point.x, y: point.y }
    this.trail.push({ x: point.x, y: point.y, age: 0, force, vx, vy })
  }

  drawPoint(p: TouchPoint) {
    const pos = { x: p.x * this.width, y: (1 - p.y) * this.height }
    let intensity = 1
    if (p.age < this.maxAge * 0.3) intensity = Math.sin((p.age / (this.maxAge * 0.3)) * (Math.PI / 2))
    else {
      const t = 1 - (p.age - this.maxAge * 0.3) / (this.maxAge * 0.7)
      intensity = -t * (t - 2)
    }
    intensity *= p.force
    const radius = this.radius
    const color = `${((p.vx + 1) / 2) * 255}, ${((p.vy + 1) / 2) * 255}, ${intensity * 255}`
    const offset = this.size * 5
    this.ctx.shadowOffsetX = offset
    this.ctx.shadowOffsetY = offset
    this.ctx.shadowBlur = radius
    this.ctx.shadowColor = `rgba(${color},${0.2 * intensity})`
    this.ctx.beginPath()
    this.ctx.fillStyle = "rgba(255,0,0,1)"
    this.ctx.arc(pos.x - offset, pos.y - offset, radius, 0, Math.PI * 2)
    this.ctx.fill()
  }
}

const VERT = `
  varying vec2 vUv;
  void main() {
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    vUv = uv;
  }`

const FRAG = `
  uniform float uTime;
  uniform vec2 uResolution;
  uniform vec3 uColor1, uColor2, uColor3, uColor4, uColor5, uColor6;
  uniform float uSpeed, uIntensity;
  uniform sampler2D uTouchTexture;
  uniform float uGrainIntensity;
  uniform vec3 uDarkBase;
  uniform float uGradientSize, uGradientCount;
  uniform float uColor1Weight, uColor2Weight;
  varying vec2 vUv;

  float grain(vec2 uv, float t) {
    vec2 g = uv * uResolution * 0.5;
    return fract(sin(dot(g + t, vec2(12.9898, 78.233))) * 43758.5453) * 2.0 - 1.0;
  }

  vec3 getGradientColor(vec2 uv, float time) {
    float r = uGradientSize;
    vec2 c1 = vec2(0.5 + sin(time * uSpeed * 0.4) * 0.4, 0.5 + cos(time * uSpeed * 0.5) * 0.4);
    vec2 c2 = vec2(0.5 + cos(time * uSpeed * 0.6) * 0.5, 0.5 + sin(time * uSpeed * 0.45) * 0.5);
    vec2 c3 = vec2(0.5 + sin(time * uSpeed * 0.35) * 0.45, 0.5 + cos(time * uSpeed * 0.55) * 0.45);
    vec2 c4 = vec2(0.5 + cos(time * uSpeed * 0.5) * 0.4, 0.5 + sin(time * uSpeed * 0.4) * 0.4);
    vec2 c5 = vec2(0.5 + sin(time * uSpeed * 0.7) * 0.35, 0.5 + cos(time * uSpeed * 0.6) * 0.35);
    vec2 c6 = vec2(0.5 + cos(time * uSpeed * 0.45) * 0.5, 0.5 + sin(time * uSpeed * 0.65) * 0.5);
    vec2 c7 = vec2(0.5 + sin(time * uSpeed * 0.55) * 0.38, 0.5 + cos(time * uSpeed * 0.48) * 0.42);
    vec2 c8 = vec2(0.5 + cos(time * uSpeed * 0.65) * 0.36, 0.5 + sin(time * uSpeed * 0.52) * 0.44);
    vec2 c9 = vec2(0.5 + sin(time * uSpeed * 0.42) * 0.41, 0.5 + cos(time * uSpeed * 0.58) * 0.39);
    vec2 c10 = vec2(0.5 + cos(time * uSpeed * 0.48) * 0.37, 0.5 + sin(time * uSpeed * 0.62) * 0.43);
    vec2 c11 = vec2(0.5 + sin(time * uSpeed * 0.68) * 0.33, 0.5 + cos(time * uSpeed * 0.44) * 0.46);
    vec2 c12 = vec2(0.5 + cos(time * uSpeed * 0.38) * 0.39, 0.5 + sin(time * uSpeed * 0.56) * 0.41);

    float i1 = 1.0 - smoothstep(0.0, r, length(uv - c1));
    float i2 = 1.0 - smoothstep(0.0, r, length(uv - c2));
    float i3 = 1.0 - smoothstep(0.0, r, length(uv - c3));
    float i4 = 1.0 - smoothstep(0.0, r, length(uv - c4));
    float i5 = 1.0 - smoothstep(0.0, r, length(uv - c5));
    float i6 = 1.0 - smoothstep(0.0, r, length(uv - c6));
    float i7 = 1.0 - smoothstep(0.0, r, length(uv - c7));
    float i8 = 1.0 - smoothstep(0.0, r, length(uv - c8));
    float i9 = 1.0 - smoothstep(0.0, r, length(uv - c9));
    float i10 = 1.0 - smoothstep(0.0, r, length(uv - c10));
    float i11 = 1.0 - smoothstep(0.0, r, length(uv - c11));
    float i12 = 1.0 - smoothstep(0.0, r, length(uv - c12));

    vec2 ru1 = uv - 0.5;
    float a1 = time * uSpeed * 0.15;
    ru1 = vec2(ru1.x * cos(a1) - ru1.y * sin(a1), ru1.x * sin(a1) + ru1.y * cos(a1)) + 0.5;
    vec2 ru2 = uv - 0.5;
    float a2 = -time * uSpeed * 0.12;
    ru2 = vec2(ru2.x * cos(a2) - ru2.y * sin(a2), ru2.x * sin(a2) + ru2.y * cos(a2)) + 0.5;
    float ri1 = 1.0 - smoothstep(0.0, 0.8, length(ru1 - 0.5));
    float ri2 = 1.0 - smoothstep(0.0, 0.8, length(ru2 - 0.5));

    vec3 col = vec3(0.0);
    col += uColor1 * i1 * (0.55 + 0.45 * sin(time * uSpeed)) * uColor1Weight;
    col += uColor2 * i2 * (0.55 + 0.45 * cos(time * uSpeed * 1.2)) * uColor2Weight;
    col += uColor3 * i3 * (0.55 + 0.45 * sin(time * uSpeed * 0.8)) * uColor1Weight;
    col += uColor4 * i4 * (0.55 + 0.45 * cos(time * uSpeed * 1.3)) * uColor2Weight;
    col += uColor5 * i5 * (0.55 + 0.45 * sin(time * uSpeed * 1.1)) * uColor1Weight;
    col += uColor6 * i6 * (0.55 + 0.45 * cos(time * uSpeed * 0.9)) * uColor2Weight;
    if (uGradientCount > 6.0) {
      col += uColor1 * i7 * (0.55 + 0.45 * sin(time * uSpeed * 1.4)) * uColor1Weight;
      col += uColor2 * i8 * (0.55 + 0.45 * cos(time * uSpeed * 1.5)) * uColor2Weight;
      col += uColor3 * i9 * (0.55 + 0.45 * sin(time * uSpeed * 1.6)) * uColor1Weight;
      col += uColor4 * i10 * (0.55 + 0.45 * cos(time * uSpeed * 1.7)) * uColor2Weight;
    }
    if (uGradientCount > 10.0) {
      col += uColor5 * i11 * (0.55 + 0.45 * sin(time * uSpeed * 1.8)) * uColor1Weight;
      col += uColor6 * i12 * (0.55 + 0.45 * cos(time * uSpeed * 1.9)) * uColor2Weight;
    }
    col += mix(uColor1, uColor3, ri1) * 0.45 * uColor1Weight;
    col += mix(uColor2, uColor4, ri2) * 0.4 * uColor2Weight;

    col = clamp(col, vec3(0.0), vec3(1.0)) * uIntensity;
    float lum = dot(col, vec3(0.299, 0.587, 0.114));
    col = mix(vec3(lum), col, 1.35);
    col = pow(col, vec3(0.92));
    float b1 = length(col);
    col = mix(uDarkBase, col, max(b1 * 1.2, 0.15));
    float bMax = 1.0, b = length(col);
    if (b > bMax) col = col * (bMax / b);
    return col;
  }

  void main() {
    vec2 uv = vUv;
    vec4 t = texture2D(uTouchTexture, uv);
    float vx = -(t.r * 2.0 - 1.0), vy = -(t.g * 2.0 - 1.0), inten = t.b;
    uv.x += vx * 0.8 * inten;
    uv.y += vy * 0.8 * inten;
    vec2 ctr = vec2(0.5);
    float dist = length(uv - ctr);
    uv += vec2(sin(dist * 20.0 - uTime * 3.0) * 0.04 * inten + sin(dist * 15.0 - uTime * 2.0) * 0.03 * inten);

    vec3 c = getGradientColor(uv, uTime);
    c += grain(uv, uTime) * uGrainIntensity;
    float ts = uTime * 0.5;
    c.r += sin(ts) * 0.02; c.g += cos(ts * 1.4) * 0.02; c.b += sin(ts * 1.2) * 0.02;
    float b2 = length(c);
    c = mix(uDarkBase, c, max(b2 * 1.2, 0.15));
    c = clamp(c, vec3(0.0), vec3(1.0));
    float bMax = 1.0, b = length(c);
    if (b > bMax) c = c * (bMax / b);
    gl_FragColor = vec4(c, 1.0);
  }`

export type LiquidGradientOptions = {
  scheme?: SchemeKey
  speedScale?: number
}

export type LiquidGradientHandle = {
  destroy: () => void
}

export function initLiquidGradient(
  container: HTMLElement,
  opts: LiquidGradientOptions = {}
): LiquidGradientHandle {
  const scheme = SCHEMES[opts.scheme || 1] || SCHEMES[1]

  const w = container.clientWidth || 600
  const h = container.clientHeight || 600

  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    powerPreference: "high-performance",
    alpha: false,
    stencil: false,
    depth: false,
  })
  renderer.setSize(w, h)
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  const canvas = renderer.domElement
  canvas.style.position = "absolute"
  canvas.style.inset = "0"
  canvas.style.width = "100%"
  canvas.style.height = "100%"
  canvas.style.display = "block"
  container.appendChild(canvas)

  const camera = new THREE.PerspectiveCamera(45, w / h, 0.1, 10000)
  camera.position.z = 50
  const scene = new THREE.Scene()
  scene.background = new THREE.Color(scheme.bg)
  const clock = new THREE.Clock()
  const touchTex = new TouchTexture()

  const uniforms: Record<string, { value: any }> = {
    uTime: { value: 0 },
    uResolution: { value: new THREE.Vector2(w, h) },
    uColor1: { value: new THREE.Vector3(...scheme.colors[0]) },
    uColor2: { value: new THREE.Vector3(...scheme.colors[1]) },
    uColor3: { value: new THREE.Vector3(...scheme.colors[2]) },
    uColor4: { value: new THREE.Vector3(...scheme.colors[3]) },
    uColor5: { value: new THREE.Vector3(...scheme.colors[4]) },
    uColor6: { value: new THREE.Vector3(...scheme.colors[5]) },
    uSpeed: { value: scheme.speed * (opts.speedScale ?? 1) },
    uIntensity: { value: 1.8 },
    uTouchTexture: { value: touchTex.texture },
    uGrainIntensity: { value: 0.08 },
    uDarkBase: { value: new THREE.Vector3(...scheme.base) },
    uGradientSize: { value: scheme.gradientSize },
    uGradientCount: { value: scheme.gradientCount },
    uColor1Weight: { value: scheme.w1 },
    uColor2Weight: { value: scheme.w2 },
  }

  function viewSize() {
    const fov = (camera.fov * Math.PI) / 180
    const height = Math.abs(camera.position.z * Math.tan(fov / 2) * 2)
    return { width: height * camera.aspect, height }
  }
  const vs = viewSize()
  const geo = new THREE.PlaneGeometry(vs.width, vs.height, 1, 1)
  const mat = new THREE.ShaderMaterial({ uniforms, vertexShader: VERT, fragmentShader: FRAG })
  const mesh = new THREE.Mesh(geo, mat)
  scene.add(mesh)

  function onPointerMove(ev: MouseEvent) {
    const rect = canvas.getBoundingClientRect()
    const x = (ev.clientX - rect.left) / rect.width
    const y = 1 - (ev.clientY - rect.top) / rect.height
    if (x >= 0 && x <= 1 && y >= 0 && y <= 1) touchTex.addTouch({ x, y })
  }
  window.addEventListener("mousemove", onPointerMove)

  let ro: ResizeObserver | null = null
  function resize() {
    const W = container.clientWidth, H = container.clientHeight
    renderer.setSize(W, H)
    camera.aspect = W / H
    camera.updateProjectionMatrix()
    uniforms.uResolution.value.set(W, H)
    const vs2 = viewSize()
    mesh.geometry.dispose()
    mesh.geometry = new THREE.PlaneGeometry(vs2.width, vs2.height, 1, 1)
  }
  if (typeof ResizeObserver !== "undefined") {
    ro = new ResizeObserver(resize)
    ro.observe(container)
  } else {
    window.addEventListener("resize", resize)
  }

  let raf = 0
  let alive = true
  function tick() {
    if (!alive) return
    const dt = Math.min(clock.getDelta(), 0.1)
    uniforms.uTime.value += dt
    touchTex.update()
    renderer.render(scene, camera)
    raf = requestAnimationFrame(tick)
  }
  tick()

  return {
    destroy() {
      alive = false
      cancelAnimationFrame(raf)
      window.removeEventListener("mousemove", onPointerMove)
      if (ro) ro.disconnect()
      renderer.dispose()
      if (canvas.parentNode) canvas.parentNode.removeChild(canvas)
    },
  }
}
