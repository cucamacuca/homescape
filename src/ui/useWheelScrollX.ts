import { useEffect, useRef } from 'react'

/**
 * Lets a horizontal list scroll with a plain mouse wheel: a vertical wheel turn moves it sideways (deltaY to scrollLeft,
 * line and page based wheels converted to pixels). Native horizontal deltas (a trackpad swipe, Shift + wheel) are left to
 * the browser. Only while the list overflows; then the wheel scrolls neither the page nor anything behind the list. React's
 * onWheel is passive and cannot prevent the default, hence the native listener with passive: false.
 */
export function useWheelScrollX<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      // Pinch zoom and sideways swipes stay native
      if (e.ctrlKey || Math.abs(e.deltaX) >= Math.abs(e.deltaY)) return
      const max = el.scrollWidth - el.clientWidth
      if (max <= 1) return
      const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? el.clientWidth : 1
      const next = Math.min(max, Math.max(0, el.scrollLeft + e.deltaY * unit))
      e.preventDefault()
      el.scrollLeft = next
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])
  return ref
}
