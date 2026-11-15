import { CATALOG } from './catalog'
import { apertureOf, isAperture, isOutdoor, isStreetSurface, wallKey, wallRuns, type Side, type WallRun } from './geometry'
import { isWallMounted } from './rules'
import type { Item, Level, Room } from './types'

/*
 * Walls left out (open plan, a passage without a door, a porch open to the garden). Home Assistant areas are functional
 * zones, not always rooms with walls: an open kitchen and living room stay two rooms (own name, area, floor and stats)
 * with no wall in between. A wall is named from one room by its key (geometry.ts > wallKey): the neighbor room's id or
 * the side facing open space. Room.open lists the walls left out; the wall between two rooms opens for both when either
 * room lists the other, so it stays open when one of them is moved, resized or rotated next to the other again.
 */

export interface RoomWall {
  key: string
  /** The room on the other side; none for an edge facing open space */
  neighbor?: Room
  /** Side of the room the wall is on (of its longest run) */
  side: Side
  /** Length along the room (m) */
  length: number
  open: boolean
}

/** Whether the room has walls or railings that can be left out (not a garden or a street surface). */
export const hasWalls = (room: Room) => room.type !== 'garden' && !isStreetSurface(room)

const SIDES: Side[] = ['back', 'right', 'front', 'left']

/** The room's walls, standing and left out, one entry per key; for a balcony or terrace its railing edges. */
export function roomWalls(room: Room, rooms: Room[]): RoomWall[] {
  if (!hasWalls(room)) return []
  const out = new Map<string, RoomWall & { longest: number }>()
  const add = (runs: WallRun[], open: boolean) => {
    for (const r of runs) {
      const key = wallKey(r)
      const len = r.a1 - r.a0
      const w = out.get(key) ?? { key, neighbor: r.neighbor ? rooms.find((o) => o.id === r.neighbor) : undefined, side: r.side, length: 0, open, longest: 0 }
      w.length += len
      if (len > w.longest) {
        w.longest = len
        w.side = r.side
      }
      out.set(key, w)
    }
  }
  add(wallRuns(room, rooms, 'walls', true), false)
  add(wallRuns(room, rooms, 'open', true), true)
  // Rooms first (by name), then the edges facing open space clockwise from the back
  return [...out.values()]
    .map(({ key, neighbor, side, length, open }) => ({ key, neighbor, side, length, open }))
    .sort((a, b) => (a.neighbor && b.neighbor ? a.neighbor.name.localeCompare(b.neighbor.name) : a.neighbor ? -1 : b.neighbor ? 1 : SIDES.indexOf(a.side) - SIDES.indexOf(b.side)))
}

/** Whether the item is in the wall run or hangs on it (on either side): a door, a window, a wall light, a wall TV... */
function onRun(it: Item, r: WallRun) {
  if (isAperture(it.kind)) {
    const a = apertureOf(it)
    return Boolean(a && a.horizontal === r.horizontal && Math.abs(a.line - r.line) <= 0.08 && a.along >= r.a0 && a.along <= r.a1)
  }
  if (!isWallMounted(it.kind, it.variant, it.mount)) return false
  // A wall item faces straight out of its wall and stands its half depth in front of it
  const face = r.horizontal ? Math.cos(it.rot) : Math.sin(it.rot)
  if (Math.abs(Math.abs(face) - 1) > 0.01) return false
  const perp = r.horizontal ? it.z : it.x
  const along = r.horizontal ? it.x : it.z
  return Math.abs(perp - r.line) < CATALOG[it.kind].size[1] / 2 + 0.15 && along >= r.a0 - 0.05 && along <= r.a1 + 0.05
}

/** Items that go with a wall when it is left out: doors and windows in it and the items hanging on it. Floor items stay. */
export function wallItems(level: Level, room: Room, key: string): Item[] {
  const runs = wallRuns(room, level.rooms, 'walls', true).filter((r) => wallKey(r) === key)
  return runs.length ? level.items.filter((it) => runs.some((r) => onRun(it, r))) : []
}

const withOpen = (room: Room, list: string[]): Room => {
  const { open: _, ...rest } = room
  return list.length ? { ...rest, open: list } : rest
}

/**
 * The level with walls of the room left out (open) or put back. Leaving a wall out removes the items in it and on it
 * (wallItems); putting the wall between two rooms back clears it from both rooms' lists.
 */
export function withWalls(level: Level, roomId: string, keys: string[], open: boolean): Level {
  const room = level.rooms.find((r) => r.id === roomId)
  if (!room || !keys.length) return level
  const gone = new Set(open ? keys.flatMap((k) => wallItems(level, room, k)).map((it) => it.id) : [])
  const set = new Set(keys)
  const rooms = level.rooms.map((r) => {
    if (r.id === roomId) return withOpen(r, open ? [...new Set([...(r.open ?? []), ...keys])] : (r.open ?? []).filter((k) => !set.has(k)))
    if (!open && set.has(r.id) && r.open?.includes(roomId)) return withOpen(r, r.open.filter((k) => k !== roomId))
    return r
  })
  return { ...level, rooms, items: gone.size ? level.items.filter((it) => !gone.has(it.id)) : level.items }
}

/** Sides after turning the room 90° (dir 1 clockwise seen from above, ui/rotateRoom.ts); room ids stay. */
const CW: Record<Side, Side> = { back: 'right', right: 'front', front: 'left', left: 'back' }
const CCW: Record<Side, Side> = { right: 'back', front: 'right', left: 'front', back: 'left' }
export const turnOpen = (open: string[], dir: 1 | -1) => open.map((k) => (isSide(k) ? (dir > 0 ? CW : CCW)[k] : k))
/** Whether a Room.open entry is a side facing open space (else it is a neighbor room's id) */
export const isSide = (k: string): k is Side => k in CW

/** Indoor rooms joined to this one by an open wall: a lamp lights them too (scene/roomLights.ts). */
export function openNeighbors(room: Room, rooms: Room[]): Room[] {
  if (isOutdoor(room)) return []
  const ids = new Set(wallRuns(room, rooms, 'open', true).flatMap((r) => (r.neighbor ? [r.neighbor] : [])))
  return rooms.filter((r) => ids.has(r.id) && !isOutdoor(r))
}
