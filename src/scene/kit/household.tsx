import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { deviceClass, domainOf, isActive, num } from '@/ha/derive'
import type { HassEntity } from '@/ha/types'
import { WALL_H } from '@/model/geometry'
import { assistRing, clockText, distanceM, parkingBar } from '@/model/household'
import { markShadows } from '../frame'
import { Airflow, Glow, MusicNotes, Spin, useAmbient, useLitMaterial } from './effects'
import { C } from './palette'
import { Ball, Box, Cyl, mat } from './primitives'
import { Flames } from './smart'
import type { Visual } from './visual'

/*
 * Household items: lights, climate, media, security, sensors, smart devices, kitchen, bath, furniture, decor, pets, garden,
 * garage and structure items that complete the catalog. Same local convention as kit/smart.tsx: origin at the center of the
 * footprint on the floor, front at +z, width along x; wall items have their back at local z = -depth/2 and are drawn at
 * their real height (rules.ts > WALL_SPAN); ceiling items hang from WALL_H; items on a surface start at y = 0 (ItemNode lifts
 * them onto the surface). Animations request frames only while active (useAmbient); geometries and transparent materials
 * are cached at module level. State logic that the checks test lives in model/household.ts.
 */

type P = { v: Visual }

const TAU = Math.PI * 2

const MONO = '"JetBrains Mono", ui-monospace, monospace'

/** Body color: pale gray when unavailable, otherwise the color picked on the card (Item.body) or the default. */
const bodyOf = (v: Visual, def: string) => (v.unavailable ? '#9aa0b8' : (v.opts.body ?? def))

/** Glowing part: emissive in its own color while lit, plain otherwise (cached by value). */
const glowing = (color: string, lit: boolean, k = 1.6) => (lit ? mat(color, { emissive: color, emissiveIntensity: Math.round(k * 10) / 10 }) : mat('#4a4e5a'))

/** The bound entities as records: the main one first, then the extras (for items whose state comes from several) */
const entitiesOf = (v: Visual): HassEntity[] => [...(v.bound ? [{ entity_id: `${v.domain}.main`, state: v.state, attributes: v.attrs } as unknown as HassEntity] : []), ...v.related]

const relatedOf = (v: Visual, domain: string) => (v.domain === domain ? { state: v.state, attributes: v.attrs } : v.related.find((e) => domainOf(e.entity_id) === domain))

const geos = new Map<string, THREE.BufferGeometry>()

function geo<T extends THREE.BufferGeometry>(key: string, make: () => T) {
  let g = geos.get(key) as T | undefined
  if (!g) {
    g = make()
    geos.set(key, g)
  }
  return g
}

const torus = (r: number, tube: number, seg = 32) => geo(`t${r},${tube},${seg}`, () => new THREE.TorusGeometry(r, tube, 8, seg))

const disc = (r: number, seg = 32) => geo(`d${r},${seg}`, () => new THREE.CircleGeometry(r, seg))

const plane = (w: number, h: number) => geo(`p${w},${h}`, () => new THREE.PlaneGeometry(w, h))

/** Transparent surface (glass, water): one material per color and opacity; no depth write, the contents stay visible. */
const clears = new Map<string, THREE.MeshStandardMaterial>()

function clear(color: string, opacity: number, roughness = 0.08) {
  const key = `${color},${opacity},${roughness}`
  let m = clears.get(key)
  if (!m) {
    m = new THREE.MeshStandardMaterial({ color, transparent: true, opacity, roughness, metalness: 0.1, depthWrite: false })
    clears.set(key, m)
  }
  return m
}

/** Small display textures with text (clock, scale, inverter): cached by key, the least recently used disposed. */
const texts = new Map<string, THREE.CanvasTexture>()

function textTexture(key: string, w: number, h: number, draw: (g: CanvasRenderingContext2D) => void) {
  let t = texts.get(key)
  if (t) {
    texts.delete(key)
    texts.set(key, t)
    return t
  }
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  draw(c.getContext('2d')!)
  t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  t.anisotropy = 4
  texts.set(key, t)
  if (texts.size > 48) {
    const [oldKey, old] = texts.entries().next().value!
    texts.delete(oldKey)
    old.dispose()
  }
  return t
}

/** Display with one line of text, centered: green LCD, white screen or dim when off */
function lcdTexture(text: string, style: 'lcd' | 'screen' | 'off') {
  return textTexture(`lcd-${style}-${text}`, 256, 96, (g) => {
    g.fillStyle = style === 'lcd' ? '#0e2a1e' : style === 'screen' ? '#202a4a' : '#1b2036'
    g.fillRect(0, 0, 256, 96)
    g.fillStyle = style === 'lcd' ? '#7dffb2' : style === 'screen' ? '#ffffff' : 'rgba(255, 255, 255, 0.35)'
    g.textAlign = 'center'
    g.textBaseline = 'middle'
    g.font = `600 52px ${MONO}`
    const w = g.measureText(text).width
    if (w > 236) g.font = `600 ${Math.floor((52 * 236) / w)}px ${MONO}`
    g.fillText(text, 128, 52)
  })
}

/** A display material on a text texture (disposed with its component; the texture stays in the cache) */
function useDisplay(text: string, style: 'lcd' | 'screen' | 'off') {
  const tex = lcdTexture(text, style)
  const m = useMemo(() => new THREE.MeshBasicMaterial({ map: tex, toneMapped: false }), [tex])
  useEffect(() => () => m.dispose(), [m])
  return m
}

/** The current time, refreshed every half minute (clocks); requests a frame when it changes. */
function useNow(ms = 30_000) {
  const [now, setNow] = useState(() => new Date())
  const invalidate = useThree((s) => s.invalidate)
  useEffect(() => {
    const id = setInterval(() => {
      setNow(new Date())
      invalidate()
    }, ms)
    return () => clearInterval(id)
  }, [ms, invalidate])
  return now
}

/** Eases a value toward target and applies it each frame until it arrives (a flap, a lid, a door). */
function useEase(target: number, apply: (v: number) => void, speed = 6) {
  const cur = useRef<number | null>(null)
  const invalidate = useThree((s) => s.invalidate)
  useEffect(() => invalidate(), [target, invalidate])
  useFrame((state, dt) => {
    if (cur.current === null) {
      cur.current = target
      apply(target)
      return
    }
    const d = target - cur.current
    if (Math.abs(d) < 0.0005) return
    cur.current = Math.abs(d) < 0.002 ? target : cur.current + d * Math.min(1, dt * speed)
    apply(cur.current)
    markShadows(1)
    state.invalidate()
  })
}

/** Pulses the scale of a mesh while active (a ring, a status light). */
function usePulse(active: boolean, speed = 6, amount = 0.12) {
  const ref = useRef<THREE.Mesh>(null)
  useAmbient(active)
  useFrame(({ clock }) => {
    const m = ref.current
    if (!m) return
    const s = active ? 1 + amount * Math.sin(clock.elapsedTime * speed) : 1
    m.scale.set(s, s, s)
  })
  return ref
}

/** Whether a timestamp state (an event entity) is less than ms old; re-renders when it gets old. */
function useRecent(stamp: string, ms: number) {
  const at = Date.parse(stamp)
  const [, tick] = useState(0)
  const fresh = Number.isFinite(at) && Date.now() - at < ms
  useEffect(() => {
    if (!fresh) return
    const id = setTimeout(() => tick((n) => n + 1), ms - (Date.now() - at) + 50)
    return () => clearTimeout(id)
  }, [fresh, at, ms])
  return fresh
}

/* ---------- lights ---------- */

/**
 * Plug-in night light (in an outlet, 30 cm up): a small dome that glows warm when on, brighter while a bound motion or
 * occupancy sensor sees someone (or when the sensor itself is the main entity).
 */
export function NightLight({ v }: P) {
  const motion = v.related.some((e) => domainOf(e.entity_id) === 'binary_sensor' && ['motion', 'occupancy', 'presence'].includes(deviceClass(e)) && isActive(e))
  const lit = v.on || motion
  const k = lit ? (motion || v.domain === 'binary_sensor' ? 1 : 0.55) : 0
  const lens = useLitMaterial('#f1ede4', lit, v.color, Math.max(k, 0.3), 2.2)
  const Y = 0.3
  return (
    <group>
      <Box size={[0.07, 0.1, 0.03]} position={[0, Y, -0.01]} color={C.white} radius={0.012} />
      <Cyl r={0.027} h={0.014} position={[0, Y - 0.012, 0.008]} rotation={[Math.PI / 2, 0, 0]} material={lens} segments={20} shadow={false} />
      {lit && <Glow position={[0, Y - 0.05, 0.05]} color={v.color} opacity={(v.night ? 0.8 : 0.35) * k} size={0.6} />}
    </group>
  )
}

/**
 * Twin floodlight (outdoors on the house wall, 2.45 m): a wall box with two angled heads; when on the lenses light and a
 * wide halo falls below. With a camera bound as an extra a small dome camera sits between the heads, its lens dot lit
 * while the camera records or streams.
 */
export function Floodlight({ v }: P) {
  const lens = useLitMaterial('#dfe3ea', v.on, v.color, v.level || 1, 2.6)
  const cam = relatedOf(v, 'camera')
  const live = Boolean(cam && ['recording', 'streaming'].includes(cam.state))
  const Y = 2.45
  return (
    <group>
      <Box size={[0.12, 0.08, 0.05]} position={[0, Y + 0.02, -0.075]} color="#2a2c33" radius={0.01} />
      {[-0.08, 0.08].map((x) => (
        <group key={x} position={[x, Y - 0.02, -0.02]} rotation={[0.55, x > 0 ? -0.3 : 0.3, 0]}>
          <Box size={[0.13, 0.09, 0.06]} color="#2a2c33" radius={0.01} />
          <Box size={[0.11, 0.07, 0.006]} position={[0, 0, 0.031]} material={lens} shadow={false} />
        </group>
      ))}
      {cam && <Ball r={0.022} position={[0, Y - 0.07, -0.02]} color="#15171d" />}
      {cam && <Ball r={0.006} position={[0, Y - 0.08, 0.0]} material={glowing(C.alarm, live)} shadow={false} />}
      {v.on && <Glow position={[0, Y - 0.12, 0.2]} color={v.color} opacity={v.night ? 0.9 : 0.35} size={1.2} />}
    </group>
  )
}

/** Honeycomb of seven hexagonal light panels on the wall, a center height of 1.62 m. */
const HEX_TILES: [number, number][] = [
  [0, 0],
  [0.15, 0.087],
  [0.15, -0.087],
  [-0.15, 0.087],
  [-0.15, -0.087],
  [0.3, 0],
  [-0.3, 0],
]
const hexTile = () => geo('hex-tile', () => new THREE.CylinderGeometry(0.096, 0.096, 0.016, 6))

/**
 * Light panels (hexagon tiles on the wall): white tiles when off; when on each tile glows in the light's color, shifted a
 * little in hue tile by tile, brighter with the brightness.
 */
export function LightPanels({ v }: P) {
  const Y = 1.62
  const tiles = useMemo(
    () =>
      HEX_TILES.map((_, i) => {
        const c = new THREE.Color(v.color)
        c.offsetHSL((i - 3) * 0.03, 0, 0)
        return `#${c.getHexString()}`
      }),
    [v.color],
  )
  const k = v.on ? 0.6 + v.level : 0
  return (
    <group>
      {HEX_TILES.map(([x, y], i) => (
        <mesh key={i} position={[x, Y + y, -0.012]} rotation={[Math.PI / 2, 0, 0]} geometry={hexTile()} material={v.on ? glowing(tiles[i], true, k) : mat('#eceef4')} castShadow />
      ))}
      {v.on && <Glow position={[0, Y, 0.1]} color={v.color} opacity={v.night ? 0.7 : 0.3} size={1.4} />}
    </group>
  )
}

/** Neon sign tube shapes in the sign's plane (x right, y up, about 0.45 m wide) */
const NEON_SHAPES: Record<string, { pts: [number, number][]; closed: boolean }> = {
  heart: {
    pts: Array.from({ length: 24 }, (_, i) => {
      const a = (i / 24) * TAU
      return [0.011 * 16 * Math.sin(a) ** 3, 0.011 * (13 * Math.cos(a) - 5 * Math.cos(2 * a) - 2 * Math.cos(3 * a) - Math.cos(4 * a)) + 0.02] as [number, number]
    }),
    closed: true,
  },
  wave: { pts: Array.from({ length: 16 }, (_, i) => [-0.24 + (i / 15) * 0.48, 0.07 * Math.sin((i / 15) * TAU * 1.5)] as [number, number]), closed: false },
  bolt: {
    pts: [
      [0.06, 0.19],
      [-0.09, 0.0],
      [0.02, 0.0],
      [-0.06, -0.19],
      [0.1, 0.03],
      [-0.01, 0.03],
      [0.06, 0.19],
    ],
    closed: true,
  },
}
const neonTube = (kind: string) =>
  geo(`neon-${kind}`, () => {
    const s = NEON_SHAPES[kind]
    const curve = new THREE.CatmullRomCurve3(
      s.pts.map(([x, y]) => new THREE.Vector3(x, y, 0)),
      s.closed,
      'catmullrom',
      kind === 'bolt' ? 0.05 : 0.5,
    )
    return new THREE.TubeGeometry(curve, 96, 0.009, 8, s.closed)
  })

/**
 * Neon sign on a clear acrylic backboard (wall, 1.7 m): a tube shape (heart, wave or bolt, Item.variant) in its color
 * (Item.body; a bound color light gives its own). Pale glass tube when off, a strong glow and halo when on.
 */
export function NeonSign({ v }: P) {
  const kind = v.opts.variant && NEON_SHAPES[v.opts.variant] ? v.opts.variant : 'heart'
  const color = v.domain === 'light' && v.on ? v.color : (v.opts.body ?? '#e2564b')
  const Y = 1.7
  return (
    <group position={[0, Y, -0.012]}>
      <Box size={[0.6, 0.46, 0.008]} position={[0, 0, -0.008]} material={clear('#ffffff', 0.16, 0.2)} shadow={false} />
      <mesh geometry={neonTube(kind)} material={v.on ? glowing(color, true, 2.4) : mat('#dcdde6', { roughness: 0.3 })} />
      {v.on && <Glow position={[0, 0, 0.06]} color={color} opacity={v.night ? 0.95 : 0.45} size={1.1} />}
    </group>
  )
}

/* ---------- climate ---------- */

/**
 * Portable air conditioner (on the floor by a wall, 0.75 m): a tower on casters with a display and a top flap, the exhaust
 * hose into the wall behind it. While it cools the flap opens and cool air streams out.
 */
export function PortableAc({ v }: P) {
  const body = bodyOf(v, '#f4f5f8')
  const cooling = v.on && (v.domain !== 'climate' || ['cool', 'dry', 'fan_only', 'auto', 'heat_cool'].includes(v.state))
  const disp = useLitMaterial(C.screenOff, v.on, C.cool, 0.9, 1.6)
  const flap = useRef<THREE.Group>(null)
  useEase(cooling ? -0.9 : 0, (a) => {
    if (flap.current) flap.current.rotation.x = a
  })
  return (
    <group>
      <Box size={[0.4, 0.7, 0.34]} position={[0, 0.39, 0]} color={body} radius={0.04} />
      {[-0.14, 0.14].flatMap((x) => [-0.12, 0.12].map((z) => <Cyl key={`${x}${z}`} r={0.022} h={0.035} position={[x, 0.018, z]} color={C.inkSoft} segments={12} />))}
      <group ref={flap} position={[0, 0.745, 0.15]}>
        <Box size={[0.32, 0.012, 0.12]} position={[0, 0, -0.06]} color={body} shadow={false} />
      </group>
      <Box size={[0.11, 0.035, 0.006]} position={[0, 0.62, 0.171]} material={disp} shadow={false} />
      <Cyl r={0.055} h={0.12} position={[0, 0.5, -0.2]} rotation={[Math.PI / 2, 0, 0]} color="#d8dbe3" segments={16} />
      <Airflow active={cooling} color={C.cool} y={0.76} />
    </group>
  )
}

/**
 * Wood or pellet stove (on the floor by a wall): a black stove on legs with a glass door and a flue pipe up to the ceiling.
 * While it heats flames flicker behind the glass and a warm halo spreads into the room.
 */
export function WoodStove({ v }: P) {
  const body = bodyOf(v, '#2b2d33')
  const heating = v.on && (v.domain !== 'climate' || v.state !== 'off')
  return (
    <group>
      {[-0.23, 0.23].flatMap((x) => [-0.18, 0.18].map((z) => <Box key={`${x}${z}`} size={[0.04, 0.14, 0.04]} position={[x, 0.07, z]} color={body} />))}
      <Box size={[0.56, 0.52, 0.36]} position={[0, 0.4, -0.06]} color={body} radius={0.02} />
      {/* front frame around the firebox: open behind the glass, so the flames show inside */}
      <Box size={[0.56, 0.12, 0.12]} position={[0, 0.6, 0.18]} color={body} />
      <Box size={[0.56, 0.12, 0.12]} position={[0, 0.2, 0.18]} color={body} />
      {[-1, 1].map((s) => (
        <Box key={s} size={[0.1, 0.28, 0.12]} position={[s * 0.23, 0.4, 0.18]} color={body} />
      ))}
      <Box size={[0.36, 0.28, 0.01]} position={[0, 0.4, 0.125]} color="#15161a" shadow={false} />
      {[-0.06, 0.06].map((x) => (
        <Cyl key={x} r={0.025} h={0.3} position={[x, 0.29, 0.18]} rotation={[0, 0, Math.PI / 2 + x * 2]} color="#6b4a34" segments={8} />
      ))}
      <Box size={[0.36, 0.28, 0.006]} position={[0, 0.4, 0.237]} material={clear(heating ? '#ffb27a' : '#9aa0b8', heating ? 0.25 : 0.22, 0.1)} shadow={false} />
      <Cyl r={0.07} h={WALL_H - 0.66} position={[0, 0.66 + (WALL_H - 0.66) / 2, -0.08]} color={body} segments={16} />
      {heating && (
        <group position={[0, 0, 0.17]} scale={0.75}>
          <Flames y={0.38} night={v.night} />
        </group>
      )}
    </group>
  )
}

/**
 * Extractor fan (high on the wall, 2.2 m): a square grille with blades behind it that spin while the fan runs, faster
 * with the speed (percentage).
 */
export function ExhaustFan({ v }: P) {
  const pct = num(v.attrs.percentage)
  const speed = v.on ? 6 + ((pct ?? 60) / 100) * 18 : 0
  const Y = 2.2
  return (
    <group position={[0, Y, -0.025]}>
      <Box size={[0.28, 0.28, 0.04]} color={C.white} radius={0.02} />
      <mesh position={[0, 0, 0.021]} geometry={disc(0.11, 28)} material={mat('#2a2d38')} />
      <group position={[0, 0, 0.024]}>
        <Spin speed={speed} axis="z">
          {[0, 1, 2, 3].map((i) => (
            <Box key={i} size={[0.03, 0.1, 0.004]} position={[Math.sin((i / 4) * TAU) * 0.05, Math.cos((i / 4) * TAU) * 0.05, 0]} rotation={[0, 0, -(i / 4) * TAU]} color={C.steel} shadow={false} />
          ))}
        </Spin>
      </group>
      {[-0.08, -0.04, 0, 0.04, 0.08].map((y) => (
        <Box key={y} size={[0.24, 0.008, 0.006]} position={[0, y, 0.03]} color={C.white} shadow={false} />
      ))}
    </group>
  )
}

/* ---------- media ---------- */

/**
 * Turntable (on a surface): a wooden plinth, a black platter with a red label, the tonearm at the back right. While the
 * bound player plays the record spins, the arm swings onto it and notes rise.
 */
export function Turntable({ v }: P) {
  const playing = v.domain === 'media_player' ? v.state === 'playing' : v.on
  const arm = useRef<THREE.Group>(null)
  useEase(playing ? 0.45 : 0, (a) => {
    if (arm.current) arm.current.rotation.y = a
  })
  return (
    <group>
      <Box size={[0.44, 0.08, 0.34]} position={[0, 0.04, 0]} color={bodyOf(v, '#6b4a34')} radius={0.01} />
      <Box size={[0.42, 0.004, 0.32]} position={[0, 0.082, 0]} color="#1f2024" shadow={false} />
      <group position={[-0.05, 0.088, 0]}>
        <Spin speed={playing ? 3.5 : 0} axis="y">
          <Cyl r={0.15} h={0.006} color="#141416" segments={40} />
          <Cyl r={0.05} h={0.007} position={[0.01, 0.0005, 0]} color="#e2564b" segments={24} shadow={false} />
        </Spin>
      </group>
      <group ref={arm} position={[0.17, 0.1, -0.12]}>
        <Cyl r={0.018} h={0.03} color={C.steel} segments={12} />
        <Box size={[0.012, 0.01, 0.21]} position={[-0.03, 0.012, 0.1]} rotation={[0, 0.25, 0]} color={C.steel} shadow={false} />
      </group>
      <MusicNotes active={playing} y={0.16} size={0.05} />
    </group>
  )
}

/**
 * Floor-standing speaker (about 1 m): a tall cabinet with two woofers and a tweeter. While the bound player plays the
 * woofers pulse, harder with the volume, and notes rise above it.
 */
export function FloorSpeaker({ v }: P) {
  const playing = v.domain === 'media_player' && v.state === 'playing'
  const vol = num(v.attrs.volume_level) ?? 0.5
  const cones = useRef<THREE.Group>(null)
  useAmbient(playing)
  useFrame(({ clock }) => {
    const g = cones.current
    if (!g) return
    const s = playing ? 1 + 0.07 * vol * Math.max(0, Math.sin(clock.elapsedTime * 14)) : 1
    for (const c of g.children) c.scale.set(s, s, 1)
  })
  return (
    <group>
      <Box size={[0.24, 1.0, 0.28]} position={[0, 0.52, 0]} color={bodyOf(v, '#2a2c33')} radius={0.015} />
      {[-0.08, 0.08].map((x) => (
        <Cyl key={x} r={0.02} h={0.02} position={[x, 0.01, 0]} color={C.inkSoft} segments={10} />
      ))}
      <group ref={cones} position={[0, 0, 0.141]}>
        {[0.32, 0.56].map((y) => (
          <mesh key={y} position={[0, y, 0]} geometry={disc(0.075)} material={mat('#141518')} />
        ))}
      </group>
      <mesh position={[0, 0.82, 0.141]} geometry={disc(0.028)} material={mat('#3a3d47')} />
      <MusicNotes active={playing} y={1.08} size={0.07} />
    </group>
  )
}

/** Streaming box (on a surface): a small rounded box with a status light that glows while on and pulses while it plays. */
export function StreamingBox({ v }: P) {
  const playing = v.state === 'playing'
  const led = useLitMaterial('#3a3d47', v.on, '#ffffff', 1, 2.2)
  const ref = usePulse(playing, 4, 0.3)
  return (
    <group>
      <Box size={[0.098, 0.035, 0.098]} position={[0, 0.0175, 0]} color={bodyOf(v, '#16171b')} radius={0.014} />
      <mesh ref={ref} position={[0.03, 0.02, 0.0495]} geometry={disc(0.004, 12)} material={led} />
    </group>
  )
}

/**
 * Smart display (on a surface): a screen tilted back on a speaker base. With a bound entity the screen shows the time
 * while idle and a bright tint while it plays; dark when unbound or unavailable.
 */
export function SmartDisplay({ v }: P) {
  const now = useNow()
  const live = v.bound && !v.unavailable
  const playing = v.domain === 'media_player' && v.state === 'playing'
  const screen = useDisplay(live ? clockText(now) : '', live ? 'screen' : 'off')
  return (
    <group>
      <Box size={[0.2, 0.05, 0.1]} position={[0, 0.025, -0.01]} color={bodyOf(v, '#e9e6e1')} radius={0.02} />
      <group position={[0, 0.1, 0.02]} rotation={[-0.3, 0, 0]}>
        <Box size={[0.19, 0.13, 0.012]} color="#1d1f24" radius={0.008} />
        <mesh position={[0, 0, 0.0065]} geometry={plane(0.17, 0.11)} material={playing ? mat('#8f7cff', { emissive: '#8f7cff', emissiveIntensity: 0.9 }) : screen} />
      </group>
    </group>
  )
}

/**
 * Voice assistant (a speaker puck on a surface): its LED ring follows the assist_satellite state, steady blue while
 * listening, a spinning light while processing, pulsing while responding (model/household.ts > assistRing).
 */
export function VoiceAssistant({ v }: P) {
  const ring = assistRing(v.domain, v.state)
  const lit = ring !== 'off'
  const color = ring === 'listen' ? '#4f9dff' : ring === 'spin' ? '#8f7cff' : '#4fc3ff'
  const led = useLitMaterial('#3a3d47', lit, color, 1, 2.6)
  const spin = useRef<THREE.Group>(null)
  const pulse = usePulse(ring === 'pulse', 8, 0.08)
  useAmbient(ring === 'spin')
  useFrame((_, dt) => {
    if (spin.current && ring === 'spin') spin.current.rotation.y += Math.min(dt, 0.1) * 6
  })
  return (
    <group>
      <Cyl r={0.043} h={0.03} position={[0, 0.015, 0]} color={bodyOf(v, '#1d1f24')} segments={32} />
      <group ref={spin} position={[0, 0.031, 0]}>
        <mesh ref={pulse} rotation-x={Math.PI / 2} geometry={torus(0.036, 0.004, 32)} material={led} />
        {ring === 'spin' && <Ball r={0.006} position={[0.036, 0.002, 0]} color="#ffffff" shadow={false} />}
      </group>
      {lit && <Glow position={[0, 0.04, 0]} color={color} opacity={v.night ? 0.6 : 0.3} size={0.25} />}
    </group>
  )
}

/* ---------- security ---------- */

/**
 * Safe (on the floor): a steel box with a dial on the door. Bound to a lock, a light on the door is red while locked and
 * green while unlocked; the door swings open while a bound door sensor is open (or the lock reports open).
 */
export function Safe({ v }: P) {
  const lock = relatedOf(v, 'lock')
  const sensed = (v.domain === 'binary_sensor' && v.on) || v.related.some((e) => domainOf(e.entity_id) === 'binary_sensor' && isActive(e))
  const open = sensed || lock?.state === 'open'
  const unlocked = lock ? lock.state === 'unlocked' || lock.state === 'open' : false
  const door = useRef<THREE.Group>(null)
  useEase(open ? -1.2 : 0, (a) => {
    if (door.current) door.current.rotation.y = a
  })
  const light = lock ? (unlocked ? C.ok : C.alarm) : '#5a5e6b'
  return (
    <group>
      <Box size={[0.44, 0.5, 0.4]} position={[0, 0.25, -0.02]} color={bodyOf(v, '#3a3d47')} radius={0.01} />
      <group ref={door} position={[-0.2, 0, 0.18]}>
        <Box size={[0.4, 0.46, 0.03]} position={[0.2, 0.25, 0.015]} color="#4a4e5a" radius={0.008} />
        <Cyl r={0.045} h={0.02} position={[0.24, 0.27, 0.04]} rotation={[Math.PI / 2, 0, 0]} color={C.steel} segments={20} />
        <Box size={[0.012, 0.08, 0.02]} position={[0.36, 0.25, 0.04]} color={C.steel} shadow={false} />
        <Ball r={0.008} position={[0.33, 0.42, 0.034]} material={glowing(light, Boolean(lock), 1.4)} shadow={false} />
      </group>
    </group>
  )
}

/** Fire extinguisher on its wall bracket (low on the wall, 0.3 to 0.83 m): red cylinder, valve, handle and hose. */
export function FireExtinguisher() {
  return (
    <group>
      <Box size={[0.08, 0.08, 0.02]} position={[0, 0.6, -0.07]} color={C.inkSoft} />
      <Cyl r={0.06} h={0.45} position={[0, 0.52, 0]} color="#d8322c" segments={20} />
      <Cyl r={0.022} h={0.06} position={[0, 0.775, 0]} color="#2a2c33" segments={12} />
      <Box size={[0.1, 0.012, 0.025]} position={[0.03, 0.81, 0]} color="#2a2c33" />
      <Cyl r={0.008} h={0.24} position={[0.075, 0.64, 0.02]} rotation={[0, 0, 0.12]} color="#1d1f24" segments={8} />
      <Box size={[0.06, 0.1, 0.002]} position={[0, 0.5, 0.061]} color={C.white} shadow={false} />
    </group>
  )
}

/**
 * Doorbell chime (on the wall, 1.85 m): a round white unit with a light ring. The ring flashes while a bound siren or
 * switch is on, and for a few seconds after a bound doorbell event fires.
 */
export function Chime({ v }: P) {
  const recent = useRecent(v.domain === 'event' ? v.state : '', 12_000)
  const ringing = (v.domain !== 'event' && v.on) || recent
  const ring = useLitMaterial('#d5d8e2', ringing, '#4fc3ff', 1, 2.6)
  const ref = usePulse(ringing, 9, 0.12)
  const Y = 1.85
  return (
    <group position={[0, Y, -0.008]}>
      <Cyl r={0.065} h={0.03} rotation={[Math.PI / 2, 0, 0]} color={C.white} segments={32} />
      <mesh ref={ref} position={[0, 0, 0.016]} geometry={torus(0.05, 0.004, 32)} material={ring} />
      {[-0.015, 0, 0.015].map((x) => (
        <Ball key={x} r={0.004} position={[x, 0, 0.016]} color={C.steel} shadow={false} />
      ))}
      {ringing && <Glow position={[0, 0, 0.06]} color="#4fc3ff" opacity={v.night ? 0.7 : 0.4} size={0.45} />}
    </group>
  )
}

/* ---------- sensors ---------- */

/**
 * Garage parking sensor (on the wall, 1 m): five LED segments that light from the bound distance sensor, green while the
 * car is far, amber when close, red when it should stop; dark while the bay is empty (a bound occupancy sensor is off).
 * model/household.ts > parkingBar.
 */
export function ParkingSensor({ v }: P) {
  const ents = entitiesOf(v)
  const dist = ents.find((e) => domainOf(e.entity_id) === 'sensor')
  const occ = ents.find((e) => domainOf(e.entity_id) === 'binary_sensor')
  const bar = parkingBar(distanceM(dist), occ ? isActive(occ) : Boolean(dist))
  const Y = 1.0
  return (
    <group position={[0, Y, -0.01]}>
      <Box size={[0.14, 0.1, 0.03]} color="#2a2c33" radius={0.01} />
      {[0, 1, 2, 3, 4].map((i) => (
        <Box key={i} size={[0.018, 0.05, 0.004]} position={[-0.048 + i * 0.024, 0, 0.016]} material={glowing(bar.color, i < bar.lit, 1.8)} shadow={false} />
      ))}
      {bar.lit > 0 && <Glow position={[0, 0, 0.05]} color={bar.color} opacity={v.night ? 0.6 : 0.3} size={0.3} />}
    </group>
  )
}
