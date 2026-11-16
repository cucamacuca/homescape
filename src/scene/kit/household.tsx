import { useMemo } from 'react'
import * as THREE from 'three'
import { deviceClass, domainOf, isActive } from '@/ha/derive'
import { Glow, useLitMaterial } from './effects'
import { C } from './palette'
import { Ball, Box, Cyl, mat } from './primitives'
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

/** Glowing part: emissive in its own color while lit, plain otherwise (cached by value). */
const glowing = (color: string, lit: boolean, k = 1.6) => (lit ? mat(color, { emissive: color, emissiveIntensity: Math.round(k * 10) / 10 }) : mat('#4a4e5a'))

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
