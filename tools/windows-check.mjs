// Fixed windows regression test: the window card's Opens / Fixed switch, no hinge and direction controls and no flip
// bubble on a fixed window, the "Fixed window" card in the item bar, back to an opening window. Also the sliding glass
// door: width, the side that opens, no swing area. `npm run dev` must be
// running first. Run: npm run check:windows   Screenshots: shots/windows-*.png
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
const item = (id) => p.evaluate((id) => window.__homescape.getState().layout.layout.levels[0].items.find((i) => i.id === id), id)
const settle = () => p.waitForTimeout(700)

// One room with two windows in its back wall: one that opens and one that will become fixed
const plan = {
  version: 1,
  levels: [
    {
      id: 'lvl',
      name: 'Ground floor',
      elevation: 0,
      rooms: [{ id: 'living', name: 'Living room', floor: 'wood', x: 0, z: 0, w: 5, d: 4 }],
      items: [
        { id: 'w-open', kind: 'window', x: 1.4, z: 0.21, rot: 0 },
        { id: 'w-fixed', kind: 'window', x: 3.6, z: 0.21, rot: 0 },
      ],
    },
  ],
}
await p.evaluate((plan) => {
  const h = window.__homescape
  h.getState().layout.setLayout(plan)
  h.setTheme('day')
  h.setMode('edit')
  h.focusRoom('living')
}, plan)
await p.waitForSelector('body[data-ready="1"]', { state: 'attached', timeout: 60_000 })
await p.waitForTimeout(2500)
await p.screenshot({ path: 'shots/windows-before.png' })

// --- The window card: Opens / Fixed, with hinge and direction while it opens ---
await p.evaluate(() => window.__homescape.select({ type: 'item', id: 'w-fixed' }))
await p.waitForSelector('#window-fixed')
let card = await p.textContent('#side-panel')
ok(/Opens/.test(card) && /Fixed/.test(card) && /Hinge/.test(card), 'An opening window shows Opens / Fixed plus the hinge and direction')
ok(Boolean(await p.$('[title="Flip the opening direction"]')), 'Its bubble has the flip button')

// --- Fixed: stored on the item, no hinge or direction, no flip button ---
await p.click('#window-fixed')
await settle()
ok((await item('w-fixed')).fixed === true, 'Fixed is stored on the item')
card = await p.textContent('#side-panel')
ok(!/Hinge/.test(card) && /does not open/.test(card), 'A fixed window hides the hinge and direction and says it does not open')
ok(!(await p.$('[title="Flip the opening direction"]')), 'A fixed window has no flip button')
ok((await item('w-open')).fixed === undefined, 'The other window still opens')
await p.evaluate(() => window.__homescape.select(null))
await settle()
await p.screenshot({ path: 'shots/windows-fixed.png' })

// --- A window sensor does not open a fixed window, and keeps opening the other one ---
// In View (no swing arcs) the opening sash swings into the room and the window gets deeper; the fixed one stays as it is
const depth = (id) => p.evaluate((id) => window.__homescape.itemObject(id).then((o) => o.size[2]), id)
const sensor = (state) => p.evaluate((state) => window.__homescape.setEntity({ entity_id: 'binary_sensor.test_window', state, attributes: { friendly_name: 'Test window', device_class: 'window' } }), state)
await sensor('off')
await p.evaluate(() => {
  const h = window.__homescape
  const L = h.getState().layout
  L.updateItem('w-open', { entityId: 'binary_sensor.test_window' })
  L.updateItem('w-fixed', { entityId: 'binary_sensor.test_window' })
  h.setMode('view')
})
await settle()
const shut = { open: await depth('w-open'), fixed: await depth('w-fixed') }
await sensor('on')
await p.waitForTimeout(1500)
const opened = { open: await depth('w-open'), fixed: await depth('w-fixed') }
ok(opened.open > shut.open + 0.05 && Math.abs(opened.fixed - shut.fixed) < 0.005, `An open window sensor opens the window that opens and leaves the fixed one shut (depth ${shut.open.toFixed(2)} -> ${opened.open.toFixed(2)} m, fixed ${shut.fixed.toFixed(2)} -> ${opened.fixed.toFixed(2)} m)`)
const tile = await p.evaluate(() => document.querySelector('#kpi-tiles')?.textContent ?? '')
ok(/1 open/.test(tile), 'The Doors / windows tile counts only the window that opens')
await p.screenshot({ path: 'shots/windows-sensor.png' })
await sensor('off')
await p.evaluate(() => window.__homescape.setMode('edit'))
await settle()

// --- Undo, back to Opens ---
await p.keyboard.press('ControlOrMeta+z')
await p.keyboard.press('ControlOrMeta+z')
await p.keyboard.press('ControlOrMeta+z')
await settle()
ok(!(await item('w-fixed')).fixed, 'Undo makes the window open again')
await p.evaluate(() => window.__homescape.select({ type: 'item', id: 'w-fixed' }))
await p.waitForSelector('#window-fixed')
await p.click('#window-fixed')
await settle()
await p.click('#window-opens')
await settle()
ok(!(await item('w-fixed')).fixed && /Hinge/.test(await p.textContent('#side-panel')), 'Opens brings back the hinge and direction')

// --- The item bar has a "Fixed window" card ---
await p.evaluate(() => window.__homescape.select(null))
await p.getByRole('button', { name: 'Doors and windows' }).first().click()
await settle()
const bar = await p.textContent('body')
await p.screenshot({ path: 'shots/windows-bar.png' })
ok(/Fixed window/.test(bar) && /does not open/.test(bar), 'The item bar offers a "Fixed window"')
ok(/Sliding glass door/.test(bar), 'The item bar offers a "Sliding glass door"')

// --- Sliding glass door (GitHub issue #6): a door in the front wall becomes sliding, wider, without a swing area ---
await p.evaluate(() => {
  const L = window.__homescape.getState().layout
  L.addItems([{ id: 'd-slide', kind: 'door', x: 2.5, z: 3.79, rot: Math.PI }])
  window.__homescape.select({ type: 'item', id: 'd-slide' })
})
await p.waitForSelector('#door-sliding')
// A chair 60 cm in front of the door: in the swing of a hinged door, free in front of a sliding one
const chairFits = () =>
  p.evaluate(async () => {
    const rules = await import('/src/model/rules.ts')
    const lv = window.__homescape.getState().layout.layout.levels[0]
    return rules.checkItem(lv, { kind: 'chair', x: 2.5, z: 3.2, rot: 0 }).ok
  })
const hingedChair = await chairFits()
await p.click('#door-sliding')
await settle()
const slid = await item('d-slide')
const shape = await p.evaluate(async () => {
  const geo = await import('/src/model/geometry.ts')
  const it = window.__homescape.getState().layout.layout.levels[0].items.find((i) => i.id === 'd-slide')
  return { half: geo.apertureOf(it)?.half, card: document.querySelector('#side-panel')?.textContent ?? '' }
})
ok(slid.variant === 'sliding' && slid.len === 1.8 && Math.abs(shape.half - 0.9) < 1e-6, `Sliding glass makes a 1.8 m door with an opening as wide (half ${shape.half})`)
ok(/Door width/.test(shape.card) && /Side/.test(shape.card) && !/\bHinge\b/.test(shape.card), 'The sliding door card has the width and the side that opens, no hinge or swing direction')
ok(!hingedChair && (await chairFits()), 'A sliding door has no swing area: a chair can stand closer than in front of a hinged door')
await p.click('[title="Flip the opening direction"]')
await settle()
const flipped = await item('d-slide')
ok(flipped.hinge === 'right' && (flipped.swing ?? 'in') === 'in', 'The flip button switches the side that opens')
await p.locator('#len-d-slide').fill('2.4')
await settle()
ok((await item('d-slide')).len === 2.4, 'The width slider sets the door width')
await p.screenshot({ path: 'shots/windows-sliding.png' })
await p.click('#door-hinged')
await settle()
const back = await item('d-slide')
ok(!back.variant && back.len == null, 'Hinged makes it a 1 m hinged door again')

ok(errors.length === 0, `No page errors (${errors.slice(0, 3).join(' / ')})`)
await b.close()
console.log(failures ? `\n${failures} check(s) failed` : '\nAll window checks passed')
process.exit(failures ? 1 : 0)
