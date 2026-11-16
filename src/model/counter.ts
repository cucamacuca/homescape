import { CATALOG } from './catalog'
import type { Item } from './types'

/*
 * Built-in sink of the kitchen counter, with a faucet. Chosen on the card (Item.sink: none, left, center, right); when not
 * chosen it sits in the middle unless a separate sink item stands within 1 m of either end of the counter, so the
 * automatic plan does not get two sinks next to each other. Drawn by kit/furniture.tsx > CounterRun; the person's washing
 * spot is in model/people.ts > workSpots.
 */

/** Sink width and distance from the counter end (m) */
export const SINK_W = 0.56
const EDGE = 0.45
const CORNER = 0.6 + SINK_W / 2 + 0.06

/** Center of the counter's (or island's) built-in sink along local x; null without a sink. */
export function counterSink(items: Item[], c: Item): number | null {
  if (c.kind === 'kitchenIsland') return islandParts(c.len ?? CATALOG.kitchenIsland.size[0], c.sink, c.dishwasher).sink
  if (c.kind !== 'kitchenCounter') return null
  const L = c.len ?? CATALOG.kitchenCounter.size[0]
  if (L < 0.9) return null
  let side = c.sink
  if (!side) {
    const ax = Math.cos(c.rot)
    const az = -Math.sin(c.rot)
    const near = items.some((i) => {
      if (i.kind !== 'sink') return false
      const along = (i.x - c.x) * ax + (i.z - c.z) * az
      const across = Math.abs(-(i.x - c.x) * az + (i.z - c.z) * ax)
      return across < 0.6 && Math.abs(along) < L / 2 + 1
    })
    side = near ? 'none' : 'center'
  }
  if (side === 'none') return null
  // On an L counter it stays out of the corner square (0.6 m): at that end it starts one arm depth inward
  const lo = -L / 2 + (c.variant === 'lLeft' ? CORNER : EDGE)
  const hi = L / 2 - (c.variant === 'lRight' ? CORNER : EDGE)
  if (lo > hi) return null
  const x = side === 'left' ? lo : side === 'right' ? hi : 0
  return Math.min(hi, Math.max(lo, x))
}

/** Width of a base cabinet slot: the sink cabinet and the dishwasher (m) */
export const SLOT_W = 0.6
/** Gap between the island's end and a sink or dishwasher slot pushed to that end (m) */
const ISLAND_EDGE = 0.15

/**
 * Kitchen island (Item.sink, Item.dishwasher; left and right as seen at the cabinet side): centers of the built-in sink and
 * dishwasher along local x, null when absent or when the island is too short. The dishwasher sits right beside the sink
 * (sink and dishwasher cabinets side by side); without a sink it goes to that end of the island. A sink pushed to one end
 * keeps 0.45 m from it, or leaves room for the dishwasher between it and the end.
 */
export function islandParts(L: number, sinkSide?: Item['sink'], dishSide?: Item['dishwasher']): { sink: number | null; dish: number | null } {
  const side = sinkSide ?? 'none'
  const dishOn = dishSide === 'left' || dishSide === 'right'
  const ds = dishSide === 'left' ? -1 : 1
  const lo = -L / 2 + ISLAND_EDGE
  const hi = L / 2 - ISLAND_EDGE
  if (side === 'none') {
    if (!dishOn || hi - lo < SLOT_W) return { sink: null, dish: null }
    return { sink: null, dish: ds < 0 ? lo + SLOT_W / 2 : hi - SLOT_W / 2 }
  }
  // Sink alone: like the wall counter, 0.45 m from the end or in the middle
  let sink = side === 'left' ? -L / 2 + EDGE : side === 'right' ? L / 2 - EDGE : 0
  if (!dishOn || hi - lo < 2 * SLOT_W) {
    sink = Math.min(L / 2 - EDGE, Math.max(-L / 2 + EDGE, sink))
    return { sink, dish: null }
  }
  // Sink and dishwasher as one 1.2 m block, kept inside the island (the sink moves inward when the block would stick out)
  const left = Math.min(hi - 2 * SLOT_W, Math.max(lo, side === 'left' ? lo : side === 'right' ? hi - 2 * SLOT_W : ds < 0 ? -SLOT_W * 1.5 : -SLOT_W / 2))
  const sinkC = ds < 0 ? left + SLOT_W * 1.5 : left + SLOT_W / 2
  return { sink: sinkC, dish: ds < 0 ? left + SLOT_W / 2 : left + SLOT_W * 1.5 }
}
