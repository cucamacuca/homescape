import { deviceClass, domainOf, isActive, num } from '@/ha/derive'
import type { HassEntity } from '@/ha/types'

/*
 * State of household items, pure so the checks can call it (the models are in scene/kit/household.tsx): wall clock hands,
 * the voice assistant's LED ring, the garage parking sensor's bar, a phone on its charger.
 */

/** Hand angles of a clock at a time: radians clockwise from 12 o'clock, seen from the front. */
export function clockHands(d: Date) {
  const m = d.getMinutes() + d.getSeconds() / 60
  const h = (d.getHours() % 12) + m / 60
  return { hour: (h / 12) * Math.PI * 2, minute: (m / 60) * Math.PI * 2 }
}

/** Time as HH:MM (24 h) for the small displays */
export const clockText = (d: Date) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`

/**
 * LED ring of a voice assistant from its assist_satellite state: dark when idle, steady while listening, spinning while
 * processing, pulsing while responding. A media player that plays pulses too.
 */
export type AssistRing = 'off' | 'listen' | 'spin' | 'pulse'
export function assistRing(domain: string, state: string): AssistRing {
  if (domain === 'assist_satellite') return state === 'listening' ? 'listen' : state === 'processing' ? 'spin' : state === 'responding' ? 'pulse' : 'off'
  if (domain === 'media_player') return state === 'playing' ? 'pulse' : 'off'
  return 'off'
}

/** Distance in meters from a sensor with a length unit (cm, mm, m, in, ft); null when it is not a number. */
export function distanceM(e?: Pick<HassEntity, 'state' | 'attributes'>) {
  const n = num(e?.state)
  if (n == null) return null
  const unit = String(e?.attributes.unit_of_measurement ?? 'cm')
  const k = unit === 'mm' ? 0.001 : unit === 'm' ? 1 : unit === 'in' ? 0.0254 : unit === 'ft' ? 0.3048 : 0.01
  return n * k
}

/**
 * Garage parking sensor bar: how many of its five segments light and their color, from the distance to the car (m).
 * Dark while the bay is empty; green far away, amber when close, red when it is time to stop.
 */
export function parkingBar(distance: number | null, occupied: boolean): { lit: number; color: string } {
  if (!occupied || distance == null) return { lit: 0, color: '#3a3d47' }
  const lit = Math.max(1, Math.min(5, Math.round((2.2 - distance) / 0.4) + 1))
  return { lit, color: distance > 1.2 ? '#2fbf71' : distance > 0.5 ? '#f0a63a' : '#e2564b' }
}

/**
 * Phone on its charger, from its companion app entities: away when a device tracker is not home (drawn see-through, like
 * a car that left), charging from a battery charging sensor or a battery state, the battery level in percent.
 */
export function phoneState(entities: Pick<HassEntity, 'entity_id' | 'state' | 'attributes'>[]) {
  const tracker = entities.find((e) => domainOf(e.entity_id) === 'device_tracker')
  const away = Boolean(tracker && tracker.state !== 'home')
  const charging = entities.some(
    (e) =>
      (domainOf(e.entity_id) === 'binary_sensor' && deviceClass(e as HassEntity) === 'battery_charging' && isActive(e as HassEntity)) ||
      (domainOf(e.entity_id) === 'sensor' && /^(charging|full)$/i.test(e.state)),
  )
  const level = entities.find((e) => domainOf(e.entity_id) === 'sensor' && deviceClass(e as HassEntity) === 'battery')
  const battery = level ? num(level.state) : null
  return { away, charging, battery: battery == null ? null : Math.round(battery) }
}
