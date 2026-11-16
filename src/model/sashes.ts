import { deviceClass, domainOf } from '@/ha/derive'
import type { HassEntity } from '@/ha/types'
import { bindingsOf } from './bindings'
import type { Item } from './types'

/*
 * Window sashes and their sensors. A window's sash opens with a bound window, opening or door contact sensor (or one
 * without a device class). A double window (Item.double, GitHub issue #7) has two sashes: the left one follows the first
 * such sensor in binding order (main entity first, then the extras), the right one the second; with one sensor both
 * follow it. The card swaps the two (swapSashes).
 */

const CONTACT = ['window', 'opening', 'door']

/** Whether the entity opens a window sash: a binary contact sensor */
export const isSashSensor = (e?: HassEntity): e is HassEntity => Boolean(e && domainOf(e.entity_id) === 'binary_sensor' && (deviceClass(e) === '' || CONTACT.includes(deviceClass(e))))

/** The window's sash sensors in binding order: [left, right] on a double window */
export const sashSensorIds = (item: Item, entities: Record<string, HassEntity>) => bindingsOf(item).filter((id) => isSashSensor(entities[id]))

/** Open state of the two sashes of a double window from its sash sensors' states in binding order */
export function sashesOpen(states: boolean[]): [boolean, boolean] {
  const left = states[0] ?? false
  return [left, states.length > 1 ? states[1] : left]
}

/**
 * The window with its first two sash sensors swapped in the binding order (main entity and extras), so the left sash
 * follows the other sensor; null with fewer than two sensors.
 */
export function swapSashes(item: Item, entities: Record<string, HassEntity>): Pick<Item, 'entityId' | 'extras'> | null {
  const ids = bindingsOf(item)
  const [a, b] = sashSensorIds(item, entities)
  if (!a || !b) return null
  const order = ids.map((id) => (id === a ? b : id === b ? a : id))
  return { entityId: order[0], extras: order.slice(1) }
}
