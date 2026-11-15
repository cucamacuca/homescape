import { useHa } from '@/ha/store'
import { areaContents, isOutdoor, rectsOf } from '@/model/geometry'
import { activeLevel, useLayout } from '@/model/layoutStore'
import { roomWalls, wallItems } from '@/model/walls'
import { t, tn } from '@/i18n'

/*
 * Deleting a room or a part with everything in it (items, devices, doors inside; doors from neighbors that open into it).
 * The count is shown beforehand and reported after deleting; ⌘Z brings everything back in one step.
 */

/** Number of items that go with the room when it is deleted */
export function roomContentsCount(roomId: string) {
  const level = activeLevel(useLayout.getState())
  const room = level?.rooms.find((r) => r.id === roomId)
  if (!level || !room) return 0
  return areaContents(level.items, rectsOf(room), level.rooms.filter((r) => r.id !== roomId)).length
}

export function removeRoom(roomId: string) {
  const room = activeLevel(useLayout.getState())?.rooms.find((r) => r.id === roomId)
  if (!room) return
  const n = roomContentsCount(roomId)
  useLayout.getState().deleteRoom(roomId)
  const vars = { room: room.name }
  useHa.setState({
    notice: n
      ? tn(n, '{room} deleted with the item in it. ⌘Z undoes it.', '{room} deleted with the {count} items in it. ⌘Z undoes it.', vars)
      : t('{room} deleted. ⌘Z undoes it.', vars),
  })
}

/** What an area selection deletes: the selected rooms, their contents and the items selected one by one */
export function multiCounts() {
  const s = useLayout.getState()
  const level = activeLevel(s)
  const m = s.multi
  if (!level || !m) return { rooms: 0, items: 0 }
  const keep = level.rooms.filter((r) => !m.rooms.includes(r.id))
  const area = level.rooms.filter((r) => m.rooms.includes(r.id)).flatMap(rectsOf)
  const items = new Set([...m.items, ...areaContents(level.items, area, keep).map((it) => it.id)])
  return { rooms: m.rooms.length, items: items.size }
}

export function removeMulti() {
  const { rooms, items } = multiCounts()
  if (!rooms && !items) return
  useLayout.getState().deleteMulti()
  const notice =
    rooms && items
      ? t('{rooms} and {items} deleted. ⌘Z undoes it.', { rooms: tn(rooms, '{count} room', '{count} rooms'), items: tn(items, '{count} item', '{count} items') })
      : rooms
        ? tn(rooms, '{count} room deleted. ⌘Z undoes it.', '{count} rooms deleted. ⌘Z undoes it.')
        : tn(items, '{count} item deleted. ⌘Z undoes it.', '{count} items deleted. ⌘Z undoes it.')
  useHa.setState({ notice })
}

export function removeRoomPart(roomId: string, index: number) {
  const level = activeLevel(useLayout.getState())
  const room = level?.rooms.find((r) => r.id === roomId)
  const part = room?.parts?.[index]
  if (!level || !room || !part) return
  const keep = level.rooms.map((r) => (r.id === roomId ? { ...r, parts: r.parts!.filter((_, i) => i !== index) } : r))
  const n = areaContents(level.items, [part], keep).length
  useLayout.getState().removePart(roomId, index)
  const vars = { room: room.name }
  useHa.setState({
    notice: n
      ? tn(n, 'A part of {room} deleted with the item in it. ⌘Z undoes it.', 'A part of {room} deleted with the {count} items in it. ⌘Z undoes it.', vars)
      : t('A part of {room} deleted. ⌘Z undoes it.', vars),
  })
}

/** Number of items that go when these walls of the room are left out (doors and windows in them, items hanging on them) */
export function wallContentsCount(roomId: string, keys: string[]) {
  const level = activeLevel(useLayout.getState())
  const room = level?.rooms.find((r) => r.id === roomId)
  if (!level || !room) return 0
  return new Set(keys.flatMap((k) => wallItems(level, room, k)).map((it) => it.id)).size
}

/** Leaves walls of the room out (one undo step) and reports what went with them. A balcony or terrace loses its railing there. */
export function removeWalls(roomId: string, wanted: string[]) {
  const level = activeLevel(useLayout.getState())
  const room = level?.rooms.find((r) => r.id === roomId)
  if (!level || !room) return
  // Only walls still standing (Delete on the guide of a wall already left out does nothing)
  const keys = roomWalls(room, level.rooms).filter((w) => !w.open && wanted.includes(w.key)).map((w) => w.key)
  if (!keys.length) return
  const n = wallContentsCount(roomId, keys)
  useLayout.getState().setWalls(roomId, keys, true)
  const s = useLayout.getState().selection
  // The selected wall is gone: its guide stays selected, so it can be put back right away
  if (s?.type === 'wall' && s.id === roomId && keys.length > 1) useLayout.getState().select({ type: 'room', id: roomId })
  const many = keys.length > 1
  useHa.setState({
    notice: isOutdoor(room)
      ? t('Railing removed. ⌘Z undoes it.')
      : n
        ? many
          ? tn(n, 'Walls removed with the item on them. ⌘Z undoes it.', 'Walls removed with the {count} items on them. ⌘Z undoes it.')
          : tn(n, 'Wall removed with the item on it. ⌘Z undoes it.', 'Wall removed with the {count} items on it. ⌘Z undoes it.')
        : many
          ? t('Walls removed. ⌘Z undoes it.')
          : t('Wall removed. ⌘Z undoes it.'),
  })
}

/** Puts walls of the room back (one undo step). */
export function restoreWalls(roomId: string, keys: string[]) {
  if (keys.length) useLayout.getState().setWalls(roomId, keys, false)
}
