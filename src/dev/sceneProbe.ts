import * as THREE from 'three'
import { sceneRef } from '@/scene/frame'

/*
 * Scene probes for the test hooks (window.__homescape.pick, itemObject): first visible hit and an item's group in the
 * scene. Tests and debugging only; the app does not use them.
 */

const scene = () => sceneRef.scene as unknown as THREE.Scene | null

function visible(o: THREE.Object3D | null) {
  for (let p = o; p; p = p.parent) if (!p.visible) return false
  return true
}
function itemOf(o: THREE.Object3D | null): string | null {
  for (let p = o; p; p = p.parent) if (typeof p.userData.itemId === 'string') return p.userData.itemId
  return null
}

/** First visible hit from (x, y, z) in direction (dx, dy, dz): height, distance, item id */
export function pick(x: number, y: number, z: number, dx: number, dy: number, dz: number) {
  const s = scene()
  if (!s) return null
  const r = new THREE.Raycaster(new THREE.Vector3(x, y, z), new THREE.Vector3(dx, dy, dz).normalize())
  // Meshes only (raycasting a Sprite needs a camera)
  const meshes: THREE.Object3D[] = []
  s.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) meshes.push(o)
  })
  // Meshes whose raycast needs a camera (fat lines) are skipped instead of throwing
  const hits: THREE.Intersection[] = []
  for (const m of meshes) {
    try {
      r.intersectObject(m, false, hits)
    } catch {
      /* needs a camera */
    }
  }
  const hit = hits.sort((a, b) => a.distance - b.distance).find((h) => visible(h.object))
  return hit ? { y: hit.point.y, distance: hit.distance, itemId: itemOf(hit.object) } : null
}

type Part = { rot: [number, number, number]; visible: boolean; opacity?: number; state?: string }

/** An item's group in the scene: its uuid (changes when rebuilt), world height and size, and its named parts */
export function itemObject(id: string) {
  const s = scene()
  if (!s) return null
  let found: THREE.Object3D | null = null
  s.traverse((o) => {
    if (!found && o.userData.itemId === id) found = o
  })
  if (!found) return null
  const o = found as THREE.Object3D
  const p = o.getWorldPosition(new THREE.Vector3())
  // World size of everything drawn for the item (glow and selection aids included): for comparing lengths
  const size = new THREE.Box3().setFromObject(o).getSize(new THREE.Vector3())
  // Named parts (a clock's hands, a voice assistant's ring, a phone's body): rotation, visibility, material opacity and the
  // state the model put on them (userData.state)
  const parts: Record<string, Part> = {}
  o.traverse((c) => {
    if (!c.name) return
    const m = (c as THREE.Mesh).material
    parts[c.name] = {
      rot: [c.rotation.x, c.rotation.y, c.rotation.z],
      visible: visible(c),
      ...(m && !Array.isArray(m) ? { opacity: m.opacity } : {}),
      ...(typeof c.userData.state === 'string' ? { state: c.userData.state } : {}),
    }
  })
  return { uuid: o.uuid, y: p.y, visible: visible(o), size: [size.x, size.y, size.z] as [number, number, number], parts }
}
