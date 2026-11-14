// Removed (hidden) walls regression test: the room card's Walls list, a shared wall gone on both sides, show again from
// either room, undo, moving and rotating the room, and openings (an entrance with no door in part of a wall). `npm run dev` must be running first. Run: npm run check:walls
// Screenshots: shots/walls-*.png
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'

const BASE = process.env.HOMESCAPE_URL ?? 'http://localhost:5190/'

mkdirSync('shots', { recursive: true })
let failures = 0
const b = await chromium.launch({ channel: 'chrome', args: ['--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] })
const p = await b.newPage({ viewport: { width: 1600, height: 900 }, locale: 'en-US' })
const errors = []
p.on('pageerror', (e) => errors.push(e.message))
// Small test plan first: the hook is enough to start (waiting for the sample home to draw is slow on software GL)
await p.goto(BASE)
await p.waitForFunction(() => Boolean(window.__homescape?.getState), null, { timeout: 60_000 })

const ok = (c, m) => {
  if (!c) failures += 1
  console.log(`${c ? 'PASS ' : 'FAIL '} ${m}`)
}
const room = (id) => p.evaluate((id) => window.__homescape.getState().layout.layout.levels[0].rooms.find((r) => r.id === id), id)
const select = async (id) => {
  await p.evaluate((id) => window.__homescape.select({ type: 'room', id }), id)
  await p.waitForSelector(`#walls-${id}`)
}
/** The room card's wall rows: label, open flag and button id */
const rows = (id) => p.$$eval(`[id^="wall-toggle-${id}-"]`, (els) => els.map((e) => ({ id: e.id, open: e.dataset.open === '1', text: e.parentElement.textContent })))
/** Distance from the middle of the living room to the first thing hit eastward at 1.2 m (the shared wall at x = 4) */
const east = () => p.evaluate(() => window.__homescape.pick(2, 1.2, 2, 1, 0, 0))
const settle = () => p.waitForTimeout(700)

// Two rooms side by side: a living room (0-4) and a kitchen (4-7) share the wall on x = 4
const plan = {
  version: 1,
  levels: [
    {
      id: 'lvl',
      name: 'Ground floor',
      elevation: 0,
      rooms: [
        { id: 'living', name: 'Living room', floor: 'wood', x: 0, z: 0, w: 4, d: 4 },
        { id: 'kitchen', name: 'Kitchen', floor: 'tile', x: 4, z: 0, w: 3, d: 4 },
      ],
      items: [],
    },
  ],
}
await p.evaluate((plan) => {
  const h = window.__homescape
  h.getState().layout.setLayout(plan)
  h.setTheme('day')
  h.setMode('edit')
}, plan)
await p.waitForSelector('body[data-ready="1"]', { state: 'attached', timeout: 60_000 })
await p.waitForTimeout(1500)

// --- The card lists the walls ---
await select('living')
let R = await rows('living')
const shared = R.find((r) => r.text.includes('Right wall') && r.text.includes('shared'))
ok(R.length === 4 && Boolean(shared) && R.every((r) => !r.open), `The living room card lists its 4 walls, the right one shared (${R.map((r) => r.text).join(' | ')})`)
const before = await east()
ok(before && Math.abs(before.distance - 1.95) < 0.1, `A wall stands on the shared line (hit at ${before?.distance.toFixed(2)} m)`)

// --- Hide the shared wall ---
await p.click(`#${shared.id}`)
await settle()
let living = await room('living')
ok(living.openWalls?.length === 1 && living.openWalls[0].horizontal === false && living.openWalls[0].line === 4, `The living room stores the removed wall (${JSON.stringify(living.openWalls)})`)
R = await rows('living')
ok(R.find((r) => r.text.includes('shared'))?.open === true, 'The row shows the wall as hidden')
const gone = await east()
// Past the shared line the ray meets nothing (the kitchen's far exterior wall faces the camera and is cut low) or a far wall
ok(!gone || gone.distance > 4.5, `The wall is gone for both rooms: nothing on the shared line (${gone ? gone.distance.toFixed(2) + ' m' : 'no hit'})`)
await p.screenshot({ path: 'shots/walls-hidden.png' })
await select('kitchen')
const K = await rows('kitchen')
ok(K.find((r) => r.text.includes('Left wall'))?.open === true, "The kitchen card shows the same wall as hidden (the neighbor's removal counts)")

// --- Show it again from the other room: the removal is dropped from the living room ---
await p.click(`#${K.find((r) => r.text.includes('Left wall')).id}`)
await settle()
living = await room('living')
ok(!living.openWalls?.length, 'Showing it from the kitchen clears the removal stored on the living room')
const back = await east()
ok(back && Math.abs(back.distance - 1.95) < 0.1, `The wall is back (${back?.distance.toFixed(2)} m)`)

// --- Undo brings the removal back (one step per click) ---
await p.keyboard.press('ControlOrMeta+z')
await settle()
living = await room('living')
ok(living.openWalls?.length === 1, 'Undo restores the hidden wall')

// --- Exterior wall: hidden and shown on its own room ---
await select('living')
R = await rows('living')
await p.click(`#${R.find((r) => r.text.includes('Back wall')).id}`)
await settle()
living = await room('living')
ok(living.openWalls?.length === 2 && living.openWalls.some((o) => o.horizontal && o.line === 0), 'An exterior wall can be hidden too')

// --- Moving keeps the removed walls in place relative to the room ---
await p.evaluate(() => window.__homescape.getState().layout.moveRoom('kitchen', 0, 2))
await p.evaluate(() => window.__homescape.getState().layout.moveRoom('living', 0, 2))
await p.evaluate(() => window.__homescape.getState().layout.moveRoom('kitchen', 0, 0))
await settle()
living = await room('living')
ok(living.openWalls.some((o) => !o.horizontal && o.line === 4 && o.a0 === 2 && o.a1 === 6) && living.openWalls.some((o) => o.horizontal && o.line === 2), `Moving the room moves its removed walls (${JSON.stringify(living.openWalls)})`)

// --- Rotating turns them with the room ---
await p.evaluate(() => window.__homescape.getState().layout.moveRoom('kitchen', 6, 0))
await settle()
await select('living')
await p.click('#room-rotate')
await settle()
living = await room('living')
ok(living.openWalls.length === 2 && living.openWalls.every((o) => Number.isFinite(o.line)) && living.openWalls.filter((o) => o.horizontal).length === 1, `Rotating turns the removed walls (${JSON.stringify(living.openWalls)})`)
R = await rows('living')
ok(R.filter((r) => r.open).length === 2, `After rotating, the card still shows 2 hidden walls (${R.filter((r) => r.open).map((r) => r.text).join(' | ')})`)

// --- Openings: an entrance with no door in part of the shared wall ---
await p.evaluate((plan) => window.__homescape.getState().layout.setLayout(plan), plan)
await settle()
await select('living')
R = await rows('living')
const sharedRow = R.findIndex((r) => r.text.includes('Right wall') && r.text.includes('shared'))
await p.click(`#wall-opening-living-${sharedRow}`)
await settle()
living = await room('living')
ok(living.openWalls?.length === 1 && living.openWalls[0].a0 === 1.5 && living.openWalls[0].a1 === 2.5, `"Add an opening" cuts 1 m in the middle of the wall (${JSON.stringify(living.openWalls)})`)
const through = await p.evaluate(() => window.__homescape.pick(2, 1.2, 2, 1, 0, 0))
const beside = await p.evaluate(() => window.__homescape.pick(2, 1.2, 0.8, 1, 0, 0))
ok((!through || through.distance > 4.5) && beside && Math.abs(beside.distance - 1.95) < 0.1, `The opening is open and the wall stands beside it (through ${through ? through.distance.toFixed(2) + ' m' : 'no hit'}, beside ${beside?.distance.toFixed(2)} m)`)
R = await rows('living')
const parts = R.filter((r) => r.text.includes('Right wall'))
ok(parts.length === 3 && parts[1].open && !parts[0].open && !parts[2].open, `The card splits the wall into wall, opening, wall (${parts.map((r) => r.text).join(' | ')})`)
await select('kitchen')
const K2 = await rows('kitchen')
ok(K2.filter((r) => r.text.includes('Left wall')).length === 3 && K2.some((r) => r.open), 'The kitchen sees the same opening on its side')
await select('living')
R = await rows('living')
const openIdx = R.findIndex((r) => r.open)
await p.fill(`#wall-width-living-${openIdx}`, '2')
await settle()
living = await room('living')
ok(living.openWalls[0].a0 === 1.5 && living.openWalls[0].a1 === 3.5, `Width 2 m widens the opening from its start (${JSON.stringify(living.openWalls[0])})`)
R = await rows('living')
await p.fill(`#wall-from-living-${R.findIndex((r) => r.open)}`, '0.5')
await settle()
living = await room('living')
ok(living.openWalls[0].a0 === 0.5 && living.openWalls[0].a1 === 2.5, `Position 0.5 m moves it along the wall (${JSON.stringify(living.openWalls[0])})`)
R = await rows('living')
await p.fill(`#wall-width-living-${R.findIndex((r) => r.open)}`, '9')
await settle()
living = await room('living')
ok(living.openWalls[0].a0 === 0 && living.openWalls[0].a1 === 4, `A too wide opening stays on the wall (${JSON.stringify(living.openWalls[0])})`)
await p.screenshot({ path: 'shots/walls-opening.png' })

ok(errors.length === 0, `No page errors (${errors.slice(0, 3).join(' / ')})`)
await b.close()
console.log(failures ? `\n${failures} check(s) failed` : '\nAll wall checks passed')
process.exit(failures ? 1 : 0)
