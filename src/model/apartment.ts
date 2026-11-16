import type { Layout, Level } from './types'

/*
 * Apartment mode (Layout.apartment): many homes are a flat in a building, not a house. The flat has no roof, it sits at
 * its height in the building (the street is drawn that many floors below its lowest level: scene/Apartment.tsx, Scene >
 * Contents, Weather), and its entrance door opens onto the stairwell, not the street: nobody waits outside it when the
 * home is empty, people coming home appear just inside it (model/people.ts), outdoor visitors do not pass by
 * (scene/Pets.tsx) and walk mode cannot leave the flat through it (scene/fps.ts > buildColliders).
 */

/** Highest building floor the card offers */
export const MAX_BUILDING_FLOOR = 80
/** Building floor a flat starts on when apartment mode is switched on */
export const DEFAULT_BUILDING_FLOOR = 3

export const isApartment = (layout: Pick<Layout, 'apartment'> | null | undefined) => Boolean(layout?.apartment)

/** Building floor of the plan's ground level (elevation 0); 0 for a house */
export const buildingBase = (layout: Pick<Layout, 'apartment'> | null | undefined) => layout?.apartment?.floor ?? 0

/**
 * How many floors the street is below this level: its building floor in a flat (never below the ground), 0 in a house
 * (there the ground is the level's own ground).
 */
export function streetFloors(layout: Pick<Layout, 'apartment'> | null | undefined, level: Pick<Level, 'elevation'> | null | undefined) {
  if (!layout?.apartment) return 0
  return Math.max(0, buildingBase(layout) + (level?.elevation ?? 0))
}

/** A valid building floor (whole number, 0 to MAX_BUILDING_FLOOR) */
export const clampFloor = (n: number) => Math.max(0, Math.min(MAX_BUILDING_FLOOR, Math.round(Number.isFinite(n) ? n : 0)))
