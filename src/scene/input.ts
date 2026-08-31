// Pointer input (PLAN.md §2.4/§5, v2.3): BOTH stances use the same relative drag —
// dragging anywhere on the screen swipes the ghost by screen-space deltas that the app
// maps to table mm through the current camera. The old absolute standing drag (grab
// radius + finger lift) is gone: the standing camera now yaws continuously to keep the
// ghost centred, and an absolute finger→table mapping through a moving camera feeds
// back on itself. Exactly one pointer (the first primary-button one) owns a gesture;
// other pointers are ignored.

export interface InputContext {
  aiming: () => boolean
  onSwipe: (dxPx: number, dyPx: number) => void // relative 2D swipe, both stances
}

export function bindInput(canvas: HTMLCanvasElement, ctx: InputContext): void {
  let activePointer: number | null = null
  let lastX = 0
  let lastY = 0

  canvas.addEventListener('pointerdown', (ev) => {
    if (!ctx.aiming()) return
    if (ev.button !== 0 || ev.isPrimary === false) return
    if (activePointer !== null) return // one pointer owns the gesture
    activePointer = ev.pointerId
    canvas.setPointerCapture(ev.pointerId)
    lastX = ev.clientX
    lastY = ev.clientY
  })

  canvas.addEventListener('pointermove', (ev) => {
    if (ev.pointerId !== activePointer || !ctx.aiming()) return
    const dx = ev.clientX - lastX
    const dy = ev.clientY - lastY
    lastX = ev.clientX
    lastY = ev.clientY
    if (dx !== 0 || dy !== 0) ctx.onSwipe(dx, dy)
  })

  const stop = (ev: PointerEvent): void => {
    if (ev.pointerId !== activePointer) return
    activePointer = null
    try {
      canvas.releasePointerCapture(ev.pointerId)
    } catch {
      // capture already released
    }
  }
  canvas.addEventListener('pointerup', stop)
  canvas.addEventListener('pointercancel', stop)
}
