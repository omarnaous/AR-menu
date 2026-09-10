import { useEffect, useRef, useState } from 'react'
import { useI18n } from '../i18n/index.jsx'

// Four photos around the plate is the smallest amount of work that gets a
// reconstruction real geometry instead of a guess. Each slot opens the rear
// camera directly on a phone, so the whole job is four taps and a slow walk
// around the table.
const VIEWS = ['front', 'right', 'back', 'left']

export default function OrbitCapture({ shots, onChange, onBuild, busy, maxViews = 4 }) {
  const { t } = useI18n()
  const slots = VIEWS.slice(0, maxViews)
  const inputs = useRef([])
  const galleryRef = useRef(null)
  const [over, setOver] = useState(false)
  const [previews, setPreviews] = useState([])

  useEffect(() => {
    const urls = shots.map((file) => (file ? URL.createObjectURL(file) : null))
    setPreviews(urls)
    return () => urls.forEach((url) => url && URL.revokeObjectURL(url))
  }, [shots])

  const setSlot = (index, file) => {
    const next = shots.slice()
    next[index] = file || null
    onChange(next)
  }

  // Dropping or picking several at once fills the empty slots in order, so a
  // set of photos already on the phone needs one action rather than four.
  const fill = (fileList) => {
    const files = Array.from(fileList || []).filter((f) => f.type.startsWith('image/'))
    if (!files.length) return
    const next = shots.slice()
    for (const file of files) {
      const free = next.findIndex((slot) => !slot)
      if (free === -1) break
      next[free] = file
    }
    onChange(next)
  }

  const taken = shots.filter(Boolean).length

  return (
    <div
      className={over ? 'card orbit over' : 'card orbit'}
      onDragOver={(event) => {
        event.preventDefault()
        setOver(true)
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(event) => {
        event.preventDefault()
        setOver(false)
        fill(event.dataTransfer.files)
      }}
    >
      <div className="spread">
        <h2 style={{ margin: 0 }}>{t('orbit.title')}</h2>
        <span className="tiny muted">{t('orbit.count', { taken, total: slots.length })}</span>
      </div>
      <p className="tiny muted" style={{ margin: '4px 0 0' }}>{t('orbit.hint')}</p>

      <div className="slots">
        {slots.map((view, index) => (
          <div key={view} className={shots[index] ? 'slot filled' : 'slot'}>
            <button type="button" onClick={() => inputs.current[index]?.click()} disabled={busy}>
              {previews[index] ? (
                <img src={previews[index]} alt={t(`orbit.view.${view}`)} />
              ) : (
                <>
                  <span className="glyph">{index + 1}</span>
                  <span className="tiny">{t(`orbit.view.${view}`)}</span>
                </>
              )}
            </button>
            {shots[index] && (
              <button type="button" className="clear" onClick={() => setSlot(index, null)} aria-label="clear">
                ✕
              </button>
            )}
            <input
              ref={(element) => {
                inputs.current[index] = element
              }}
              type="file"
              accept="image/*"
              capture="environment"
              className="sr-only"
              onChange={(event) => setSlot(index, event.target.files?.[0] || null)}
            />
          </div>
        ))}
      </div>

      <div className="row">
        <button className="btn" onClick={() => galleryRef.current?.click()} disabled={busy}>
          {t('orbit.choose')}
        </button>
        <button className="btn primary" onClick={onBuild} disabled={busy || taken === 0}>
          {taken > 1 ? t('orbit.buildMulti', { taken }) : t('orbit.buildOne')}
        </button>
        <input
          ref={galleryRef}
          type="file"
          accept="image/*"
          multiple
          className="sr-only"
          onChange={(event) => fill(event.target.files)}
        />
      </div>
    </div>
  )
}
