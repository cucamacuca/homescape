// Apartment mode regression test: the House / Apartment switch and the building floor in the edit card, one undo step,
// floor names from the building floor, no roof and no roof controls, the street that many floors below with the facade
// down to it, nobody waiting outside while away, arrivals inside the entrance, the walk shut in at the entrance door,
// and the setting kept across a reload. `npm run dev` must be running first. Run: npm run check:apartment
// Screenshots: shots/apartment-*.png
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'

const BASE = process.env.HOMESCAPE_URL ?? 'http://localhost:5190/'

mkdirSync('shots', { recursive: true })
let failures = 0
const b = await chromium.launch({ channel: 'chrome', args: ['--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] })
const p = await b.newPage({ viewport: { width: 1600, height: 900 }, locale: 'en-US' })
const errors = []
p.on('pageerror', (e) => errors.push(e.message))
await p.goto(BASE)
await p.waitForFunction(() => Boolean(window.__homescape?.getState), null, { timeout: 60_000 })

const ok = (c, m) => {
  if (!c) failures += 1
  console.log(`${c ? 'PASS ' : 'FAIL '} ${m}`)
}
const H = (fn, arg) => p.evaluate(fn, arg)
const state = () => H(() => window.__homescape.getState().layout)
const apartment = () => H(() => window.__homescape.getState().layout.layout.apartment ?? null)
const settle = (ms = 700) => p.waitForTimeout(ms)
const FLOOR_H = 2.8

// A flat: living room with a balcony, a bedroom and a hall with the entrance door (on z = 7)
const plan = {
  version: 1,
  levels: [
    {
      id: 'lvl',
      name: '',
      elevation: 0,
      rooms: [
        { id: 'living', name: 'Living room', floor: 'wood', x: 0, z: 0, w: 6, d: 5 },
        { id: 'bed', name: 'Bedroom', floor: 'carpet', x: 6, z: 0, w: 4, d: 5 },
        { id: 'hall', name: 'Hall', floor: 'tile', x: 0, z: 5, w: 4, d: 2 },
        { id: 'balcony', name: 'Balcony', floor: 'deck', x: 1, z: -1.8, w: 5, d: 1.8, type: 'balcony' },
      ],
      items: [
        { id: 'd-bal', kind: 'door', x: 3.5, z: 0.21, rot: 0 },
        { id: 'd-hall', kind: 'door', x: 1.5, z: 5.21, rot: 0 },
        { id: 'd-front', kind: 'door', x: 2.5, z: 6.79, rot: Math.PI },
        { id: 'w-bed', kind: 'window', x: 8, z: 0.21, rot: 0 },
      ],
    },
  ],
}
await H((plan) => {
  const h = window.__homescape
  h.getState().layout.setLayout(plan)
  h.setTheme('day')
  h.setMode('edit')
  h.select(null)
}, plan)
await p.waitForSelector('body[data-ready="1"]', { state: 'attached', timeout: 60_000 })
await settle(2000)

// --- The edit card: House / Apartment, then the building floor ---
await p.waitForSelector('#home-type')
ok((await apartment()) === null && !(await p.$('#apartment-floor')), 'A plan starts as a house; the card offers House / Apartment and no floor yet')
const past0 = (await state()).past.length
await p.click('#home-apartment')
await settle()
ok((await apartment())?.floor === 3 && (await state()).past.length === past0 + 1, 'Apartment makes the home a flat on the 3rd floor, in one undo step')
await p.click('#apartment-floor-up')
await settle(400)
const label = await p.textContent('#apartment-floor')
const shownName = await H(() => import('/src/model/layoutStore.ts').then((m) => m.levelName(window.__homescape.getState().layout.layout.levels[0])))
ok((await apartment())?.floor === 4 && /Floor 4/.test(label) && shownName === 'Floor 4', `One floor up: 4th floor, and the flat's level is named after it ("${label}", "${shownName}")`)

// --- No roof and no roof controls ---
await H(() => {
  window.__homescape.setMode('view')
  window.__homescape.select(null)
})
await settle(2500)
const roofPref = await H(() => import('/src/scene/camera.ts').then((m) => m.useView.getState().roof))
await p.keyboard.press('t')
await settle(300)
const roof = await H(() => window.__homescape.roof())
const roofAfter = await H(() => import('/src/scene/camera.ts').then((m) => m.useView.getState().roof))
ok(!(await p.$('#roof-toggle')) && !roof.covered && Object.values(roof.alpha).every((a) => a === 0) && roofAfter === roofPref, 'A flat has no roof: no roof button, the T key does nothing, the roof stays off')

// --- The street four floors below, the facade down to it ---
const probe = (x, z) => H(([x, z]) => window.__homescape.pick(x, 5, z, 0, -1, 0), [x, z])
const groundHit = await probe(-4, 2.5)
const facade = await H(() => import('/src/scene/Apartment.tsx').then((m) => ({ ...m.facadeDebug })))
ok(groundHit && Math.abs(groundHit.y - (-4 * FLOOR_H - 0.125)) < 0.05, `Next to the flat the street is 4 floors down (hit at ${groundHit?.y.toFixed(2)} m)`)
ok(facade.sides >= 4 && Math.abs(facade.height - 4 * FLOOR_H) < 1e-6, `The building's facade reaches down to the street (${facade.sides} sides, ${facade.height.toFixed(1)} m)`)
await p.screenshot({ path: 'shots/apartment-flat.png' })

// --- People: nobody waits outside while away; arrivals appear inside the entrance ---
const people = await H(async () => {
  const m = await import('/src/model/people.ts')
  const g = await import('/src/model/geometry.ts')
  const lv = window.__homescape.getState().layout.layout.levels[0]
  const away = (apartment) => m.planPeople({ level: lv, entities: {}, registry: null, alarm: 'armed_away', now: Date.now(), residents: 2, apartment }).spots.length
  const inside = (apartment) => {
    const a = m.arrivalPoint(lv, apartment)
    return a ? (g.roomAt(lv.rooms, a.x, a.z)?.id ?? null) : 'none'
  }
  return { flat: away(true), house: away(false), inFlat: inside(true), inHouse: inside(false) }
})
ok(people.flat === 0 && people.house === 2, `While away nobody waits outside a flat's door (flat ${people.flat}, house ${people.house} people outside)`)
// (in a house the first door to the outside is the balcony door here: they arrive on the balcony, outside the rooms)
ok(people.inFlat === 'hall' && people.inHouse !== 'hall' && people.inHouse !== 'living', `People coming home appear inside a flat's entrance, outside a house's door (${people.inFlat}, ${people.inHouse})`)

// --- Walk mode: the entrance door is shut (stairwell), the balcony door stays a passage ---
const walls = await H(async () => {
  const f = await import('/src/scene/fps.ts')
  const lv = window.__homescape.getState().layout.layout.levels[0]
  const across = (segs, x, z, horizontal) => segs.some((s) => (horizontal ? Math.abs(s.z1 - z) < 0.01 && Math.abs(s.z2 - z) < 0.01 && Math.min(s.x1, s.x2) < x && Math.max(s.x1, s.x2) > x : false))
  const shut = f.buildColliders(lv, [], true).segs
  const open = f.buildColliders(lv, [], false).segs
  const g = await import('/src/model/geometry.ts')
  const sp = f.spawnPoint(lv, null, true)
  return { flatFront: across(shut, 2.5, 7, true), houseFront: across(open, 2.5, 7, true), flatBalcony: across(shut, 3.5, 0, true), start: g.roomAt(lv.rooms, sp.x, sp.z)?.id ?? null }
})
ok(walls.flatFront && !walls.houseFront && !walls.flatBalcony, `Walk mode cannot leave a flat through its entrance door; the balcony door stays open (${JSON.stringify(walls)})`)
ok(walls.start === 'hall', `The walk starts inside a flat's entrance, not at the balcony door (${walls.start})`)

// --- Kept on the plan: undo, a reload, back to a house ---
await p.reload()
await p.waitForSelector('body[data-ready="1"]', { state: 'attached', timeout: 60_000 })
await settle(1500)
ok((await apartment())?.floor === 4, 'The flat and its floor are kept across a reload')
await H(() => {
  window.__homescape.setMode('edit')
  window.__homescape.select(null)
})
await p.waitForSelector('#home-house')
await p.click('#home-house')
await settle()
ok((await apartment()) === null && !(await p.$('#apartment-floor')), 'House turns the flat back into a house')
await p.keyboard.press('ControlOrMeta+z')
await settle()
ok((await apartment())?.floor === 4, 'Undo brings the flat back on its floor')
await H(() => window.__homescape.getState().layout.setApartment({ floor: 0 }))
await settle(400)
ok(await p.$eval('#apartment-floor-down', (e) => e.disabled), 'On the ground floor there is no floor lower')
const ground0 = await probe(-4, 2.5)
ok(ground0 && Math.abs(ground0.y + 0.125) < 0.05, 'A ground floor flat has the street at its own level')

ok(errors.length === 0, `No page errors (${errors.slice(0, 3).join(' / ')})`)
await b.close()
console.log(failures ? `\n${failures} check(s) failed` : '\nAll apartment checks passed')
process.exit(failures ? 1 : 0)
