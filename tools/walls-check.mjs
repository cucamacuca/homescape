// Deleting walls regression test: click a wall in edit mode to select it, delete it (Delete key or the card's button) with
// the doors, windows and wall items on it, a shared wall gone for both rooms, undo, exterior walls, moving and rotating the
// room, no selection in view mode. `npm run dev` must be running first. Run: npm run check:walls
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
const level = () => p.evaluate(() => window.__homescape.getState().layout.layout.levels[0])
const room = async (id) => (await level()).rooms.find((r) => r.id === id)
const ids = async () => (await level()).items.map((i) => i.id).sort()
const selection = () => p.evaluate(() => window.__homescape.getState().layout.selection)
const pick = (x, y, z, dx, dz) => p.evaluate(([x, y, z, dx, dz]) => window.__homescape.pick(x, y, z, dx, 0, dz), [x, y, z, dx, dz])
const clickAt = async (x, y, z) => {
  const s = await p.evaluate(([x, y, z]) => window.__homescape.project(x, y, z), [x, y, z])
  await p.mouse.click(s.x, s.y)
}
const settle = () => p.waitForTimeout(700)

// A living room (0-4) and a kitchen (4-7) share the wall on x = 4. On it: a door and a wall light (living room side).
// Elsewhere: a window in the living room's back wall, a wall light on its left wall, a sofa against the shared wall.
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
      items: [
        { id: 'door', kind: 'door', x: 4.21, z: 2, rot: Math.PI / 2 },
        { id: 'lamp-shared', kind: 'wallLight', x: 3.815, z: 1, rot: -Math.PI / 2 },
        { id: 'window', kind: 'window', x: 2, z: 0.21, rot: 0 },
        { id: 'lamp-left', kind: 'wallLight', x: 0.185, z: 2, rot: Math.PI / 2 },
        { id: 'sofa', kind: 'sofa', x: 3.4, z: 2.6, rot: -Math.PI / 2 },
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

// --- Clicking a wall selects it ---
await clickAt(4, 1.4, 3.4)
await settle()
let sel = await selection()
ok(sel?.type === 'wall' && sel.run.horizontal === false && Math.abs(sel.run.line - 4) < 0.01, `A click on the shared wall selects it (${JSON.stringify(sel)})`)
const card = await p.textContent('#side-panel').catch(() => '')
// The click lands on whichever room's half of the shared wall is in front: the card names both rooms, that one first
const [first, second] = sel?.id === 'kitchen' ? ['Kitchen', 'Living room'] : ['Living room', 'Kitchen']
ok(new RegExp(`${first} · ${second}`).test(card) && /Shared wall/.test(card) && /2 doors, windows and items on it are deleted too/.test(card), 'The card names both rooms and counts the door and the wall light on it')
await p.screenshot({ path: 'shots/walls-selected.png' })

// --- Delete key: the wall goes with what is on it, for both rooms ---
const before = await pick(2, 1.2, 3.4, 1, 0)
ok(before && Math.abs(before.distance - 1.95) < 0.1, `A wall stands on the shared line (hit at ${before?.distance.toFixed(2)} m)`)
await p.keyboard.press('Delete')
await settle()
const owner = await room(sel.id)
ok(owner.removedWalls?.length === 1 && owner.removedWalls[0].line === 4 && !owner.removedWalls[0].horizontal, `The selected room (${sel.id}) stores the deleted wall (${JSON.stringify(owner.removedWalls)})`)
let living
ok(JSON.stringify(await ids()) === JSON.stringify(['lamp-left', 'sofa', 'window']), `The door and the wall light on it are gone; the rest stays (${(await ids()).join(', ')})`)
const through = await pick(2, 1.2, 3.4, 1, 0)
ok(!through || through.distance > 4.5, `Nothing stands on the shared line any more (${through ? through.distance.toFixed(2) + ' m' : 'no hit'})`)
const fromKitchen = await pick(5.5, 1.2, 3.4, -1, 0)
ok(!fromKitchen || fromKitchen.distance > 2, `The kitchen's half of the wall is gone too (${fromKitchen ? fromKitchen.distance.toFixed(2) + ' m' : 'no hit'})`)
ok((await selection()) === null, 'The selection clears after deleting')
await p.screenshot({ path: 'shots/walls-deleted.png' })

// --- Undo brings the wall and its items back in one step ---
await p.keyboard.press('ControlOrMeta+z')
await settle()
ok(!(await room(sel.id)).removedWalls?.length && (await ids()).length === 5, 'Undo brings back the wall, the door and the wall light')

// --- Exterior wall from the card: asks once, then deletes it with the window in it ---
await p.evaluate(() => window.__homescape.select({ type: 'wall', id: 'living', run: { horizontal: true, line: 0, a0: 0, a1: 4 } }))
await p.waitForSelector('#wall-delete')
ok(/Exterior wall/.test(await p.textContent('#side-panel')), 'An exterior wall is labelled as such')
await p.click('#wall-delete')
ok(/Are you sure/.test(await p.textContent('#wall-delete')), 'The button asks once before deleting')
await p.click('#wall-delete')
await settle()
living = await room('living')
ok(living.removedWalls?.length === 1 && living.removedWalls[0].horizontal && living.removedWalls[0].line === 0 && !(await ids()).includes('window'), 'The exterior wall is deleted with the window in it')

// --- Moving and rotating the room carry the deleted wall along ---
await p.evaluate(() => window.__homescape.getState().layout.moveRoom('kitchen', 6, 0))
await p.evaluate(() => window.__homescape.getState().layout.moveRoom('living', 0, 2))
await settle()
living = await room('living')
ok(living.removedWalls[0].horizontal && living.removedWalls[0].line === 2 && living.removedWalls[0].a0 === 0, `Moving the room moves the deleted wall (${JSON.stringify(living.removedWalls)})`)
await p.evaluate(() => window.__homescape.select({ type: 'room', id: 'living' }))
await p.waitForSelector('#room-rotate')
await p.click('#room-rotate')
await settle()
living = await room('living')
ok(living.removedWalls.length === 1 && !living.removedWalls[0].horizontal, `Rotating the room turns the deleted wall (${JSON.stringify(living.removedWalls)})`)

// --- View mode: a click on a wall selects nothing ---
await p.evaluate(() => {
  const h = window.__homescape
  h.select(null)
  h.setMode('view')
})
await settle()
await clickAt(2, 1.2, 4.0)
await settle()
ok((await selection())?.type !== 'wall', 'In view mode a wall cannot be selected')

ok(errors.length === 0, `No page errors (${errors.slice(0, 3).join(' / ')})`)
await b.close()
console.log(failures ? `\n${failures} check(s) failed` : '\nAll wall checks passed')
process.exit(failures ? 1 : 0)
