import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import { isOutdoor, rectsOf, WALL_IN, wallRuns, type Side, type WallRun } from '@/model/geometry'
import { activeLevel, FLOOR_H, useLayout } from '@/model/layoutStore'
import { streetFloors } from '@/model/apartment'
import type { Level } from '@/model/types'
import { useView } from './camera'

/*
 * The building under a flat (apartment mode, model/apartment.ts): a plain facade with a window per bay and floor drops
 * from the outer face of the flat's exterior walls down to the street, so the flat does not float and a balcony looks down
 * a real height. Only the outline of the indoor rooms of the lowest drawn floor (balconies stick out of the building).
 * One plane per side of that outline with a repeating texture (one tile per floor and bay): a few meshes, nothing per
 * frame, not clickable.
 */

/** Test and debug (tools/apartment-check.mjs): how many facade sides are drawn and how tall they are */
export const facadeDebug = { sides: 0, height: 0 }

const BAY = 1.6
const OUT: Record<Side, [number, number]> = { back: [0, -1], front: [0, 1], left: [-1, 0], right: [1, 0] }
const ROT: Record<Side, number> = { back: Math.PI, front: 0, left: -Math.PI / 2, right: Math.PI / 2 }
const noRay = () => null

let tile: THREE.CanvasTexture | null = null
/** One floor and bay of the facade: wall, a window, the slab line at the floor (drawn once, shared by every side). */
function facadeTile() {
  if (tile) return tile
  const c = document.createElement('canvas')
  c.width = c.height = 128
  const g = c.getContext('2d')!
  g.fillStyle = '#e6e3ec'
  g.fillRect(0, 0, 128, 128)
  g.fillStyle = '#d3cfdb'
  g.fillRect(0, 118, 128, 10)
  g.fillStyle = '#c9c4d3'
  g.fillRect(30, 26, 68, 70)
  g.fillStyle = '#9fb3d4'
  g.fillRect(34, 30, 60, 62)
  g.fillStyle = '#e6e3ec'
  g.fillRect(62, 30, 4, 62)
  tile = new THREE.CanvasTexture(c)
  tile.colorSpace = THREE.SRGBColorSpace
  tile.wrapS = tile.wrapT = THREE.RepeatWrapping
  tile.anisotropy = 4
  return tile
}

/** The lowest floor drawn at the moment (same rule as Scene > Levels) */
function lowestDrawn(levels: Level[], active: Level, lower: boolean, fps: boolean) {
  const e0 = active.elevation ?? 0
  const shown = levels.filter((l) => {
    const e = l.elevation ?? 0
    return l.id === active.id || fps || (lower && e < e0 && e >= 0)
  })
  return shown.reduce((a, l) => ((l.elevation ?? 0) < (a.elevation ?? 0) ? l : a), active)
}

export function ApartmentFacade() {
  const layout = useLayout((s) => s.layout)
  const active = useLayout((s) => activeLevel(s))
  const lower = useView((s) => s.lowerFloors)
  const fps = useView((s) => s.fps)
  const base = active && layout ? lowestDrawn(layout.levels, active, lower, fps) : null
  const floors = layout && base ? streetFloors(layout, base) : 0
  // Top of the facade: the lowest drawn floor's level relative to the active floor (drawn at y = 0)
  const top = base && active ? ((base.elevation ?? 0) - (active.elevation ?? 0)) * FLOOR_H : 0
  const rooms = base?.rooms
  const sides = useMemo(() => {
    if (!rooms || floors <= 0) return []
    const rects = rooms.filter((r) => !isOutdoor(r)).flatMap(rectsOf)
    if (!rects.length) return []
    // One room made of all indoor rectangles: its edges are the outline of the building (joints between rooms vanish)
    const [main, ...parts] = rects
    return wallRuns({ id: 'building', name: '', floor: 'concrete', ...main, parts }, [], 'edges')
  }, [rooms, floors])
  const height = floors * FLOOR_H
  const planes = useMemo(() => sides.map((run) => facadePlane(run, height)), [sides, height])
  useEffect(() => {
    facadeDebug.sides = planes.length
    facadeDebug.height = planes.length ? height : 0
  }, [planes, height])
  useEffect(
    () => () => {
      facadeDebug.sides = 0
      facadeDebug.height = 0
      for (const p of planes) {
        p.geo.dispose()
        p.mat.dispose()
        p.map.dispose()
      }
    },
    [planes],
  )
  if (!planes.length) return null
  return (
    <group position-y={top}>
      {planes.map((p, i) => (
        <mesh key={i} geometry={p.geo} material={p.mat} position={p.at} rotation-y={p.rot} castShadow receiveShadow raycast={noRay} />
      ))}
    </group>
  )
}

function facadePlane(run: WallRun, height: number) {
  const len = run.a1 - run.a0 + 2 * WALL_IN
  const [ox, oz] = OUT[run.side]
  const mid = (run.a0 + run.a1) / 2
  const line = run.line + (run.horizontal ? oz : ox) * WALL_IN
  const at: [number, number, number] = run.horizontal ? [mid, -height / 2, line] : [line, -height / 2, mid]
  const geo = new THREE.PlaneGeometry(len, height)
  const map = facadeTile().clone()
  map.repeat.set(Math.max(1, Math.round(len / BAY)), height / FLOOR_H)
  map.needsUpdate = true
  const mat = new THREE.MeshStandardMaterial({ map, roughness: 0.92 })
  return { geo, mat, map, at, rot: ROT[run.side] }
}
