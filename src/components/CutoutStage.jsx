import { useCallback, useEffect, useRef, useState } from 'react'
import { paintAlpha } from '../lib/segment.js'

// Shows the cut-out over a transparency checkerboard and takes two kinds of
// input: dragging a box to tell the segmenter where the dish is, and brushing
// alpha back in or out where it guessed wrong.
export default function CutoutStage({ source, alpha, tool, brushSize, onRect, onAlphaPainted, busy, busyLabel }) {
  const canvasRef = useRef(null)
  const dragRef = useRef(null)
  const [marquee, setMarquee] = useState(null)

  const redraw = useCallback(
    (box) => {
      const canvas = canvasRef.current
      if (!canvas || !source) return
      const ctx = canvas.getContext('2d')
      const region = box || { x0: 0, y0: 0, x1: source.width, y1: source.height }
      const w = region.x1 - region.x0
      const h = region.y1 - region.y0
      if (w <= 0 || h <= 0) return
      const patch = ctx.createImageData(w, h)
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const si = (y + region.y0) * source.width + (x + region.x0)
          const di = (y * w + x) * 4
          patch.data[di] = source.data[si * 4]
          patch.data[di + 1] = source.data[si * 4 + 1]
          patch.data[di + 2] = source.data[si * 4 + 2]
          patch.data[di + 3] = alpha ? alpha[si] : source.data[si * 4 + 3]
        }
      }
      ctx.putImageData(patch, region.x0, region.y0)
    },
    [source, alpha],
  )

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !source) return
    canvas.width = source.width
    canvas.height = source.height
    redraw()
  }, [source, alpha, redraw])

  const toImage = (event) => {
    const rect = canvasRef.current.getBoundingClientRect()
    return {
      x: ((event.clientX - rect.left) / rect.width) * source.width,
      y: ((event.clientY - rect.top) / rect.height) * source.height,
      rect,
    }
  }

  const onPointerDown = (event) => {
    if (busy || !source) return
    event.currentTarget.setPointerCapture(event.pointerId)
    const point = toImage(event)
    if (tool === 'rect') {
      dragRef.current = { start: point, kind: 'rect' }
      setMarquee({ left: event.clientX - point.rect.left, top: event.clientY - point.rect.top, width: 0, height: 0 })
    } else {
      dragRef.current = { kind: 'brush' }
      brush(point)
    }
  }

  const brush = (point) => {
    if (!alpha) return
    const radius = Math.max(2, brushSize)
    paintAlpha(alpha, source.width, source.height, point.x, point.y, radius, tool === 'restore')
    redraw({
      x0: Math.max(0, Math.floor(point.x - radius - 1)),
      y0: Math.max(0, Math.floor(point.y - radius - 1)),
      x1: Math.min(source.width, Math.ceil(point.x + radius + 1)),
      y1: Math.min(source.height, Math.ceil(point.y + radius + 1)),
    })
  }

  const onPointerMove = (event) => {
    const drag = dragRef.current
    if (!drag) return
    const point = toImage(event)
    if (drag.kind === 'brush') {
      brush(point)
      return
    }
    const left = Math.min(drag.start.x, point.x)
    const top = Math.min(drag.start.y, point.y)
    const scale = point.rect.width / source.width
    setMarquee({
      left: left * scale,
      top: top * (point.rect.height / source.height),
      width: Math.abs(point.x - drag.start.x) * scale,
      height: Math.abs(point.y - drag.start.y) * (point.rect.height / source.height),
    })
  }

  const onPointerUp = (event) => {
    const drag = dragRef.current
    dragRef.current = null
    if (!drag) return
    if (drag.kind === 'brush') {
      onAlphaPainted?.()
      return
    }
    const point = toImage(event)
    setMarquee(null)
    const x = Math.min(drag.start.x, point.x) / source.width
    const y = Math.min(drag.start.y, point.y) / source.height
    const w = Math.abs(point.x - drag.start.x) / source.width
    const h = Math.abs(point.y - drag.start.y) / source.height
    onRect?.(w > 0.06 && h > 0.06 ? { x, y, w, h } : null)
  }

  return (
    <div className="stage">
      <canvas
        ref={canvasRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        style={{ cursor: tool === 'rect' ? 'crosshair' : 'cell' }}
      />
      {marquee && <div className="marquee" style={marquee} />}
      {busy && (
        <div className="busy">
          <div className="spinner" />
          <span>{busyLabel}</span>
        </div>
      )}
    </div>
  )
}
