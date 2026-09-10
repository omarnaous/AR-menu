import { useEffect, useState } from 'react'
import { useI18n } from '../i18n/index.jsx'

const isIOS = () =>
  /iPad|iPhone|iPod/.test(navigator.userAgent) ||
  (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)

export default function ARView({ src, iosSrc, alt, poster }) {
  const { t } = useI18n()
  const [ready, setReady] = useState(false)

  // model-viewer is ~300 KB and registers a custom element, so it only loads
  // once someone actually reaches a dish.
  useEffect(() => {
    let cancelled = false
    import('@google/model-viewer').then(() => {
      if (!cancelled) setReady(true)
    })
    return () => {
      cancelled = true
    }
  }, [])

  if (!ready) {
    return (
      <div className="stage viewport" style={{ position: 'relative' }}>
        <div className="busy">
          <div className="spinner" />
        </div>
      </div>
    )
  }

  return (
    <div className="stack">
      <model-viewer
        src={src}
        ios-src={iosSrc || undefined}
        alt={alt}
        poster={poster}
        ar
        ar-modes="webxr scene-viewer quick-look"
        ar-placement="floor"
        camera-controls
        touch-action="pan-y"
        shadow-intensity="1"
        shadow-softness="0.7"
        exposure="1.05"
        environment-image="neutral"
        camera-orbit="25deg 68deg auto"
        min-camera-orbit="auto auto 5%"
      >
        <button slot="ar-button" className="btn primary" style={{ position: 'absolute', bottom: 16, insetInlineStart: 16 }}>
          {t('action.viewAr')}
        </button>
      </model-viewer>
      <p className="tiny muted" style={{ margin: 0 }}>{t('ar.hint')}</p>
      {isIOS() && iosSrc && (
        // Quick Look is fussy about how it is handed a file. A plain rel="ar"
        // anchor is the most reliable trigger there is, and if this one fails
        // too the file itself is the problem, not model-viewer.
        <a className="btn" rel="ar" href={iosSrc}>
          <img alt="" width="1" height="1" style={{ display: 'none' }} />
          {t('ar.iosDirect')}
        </a>
      )}
      {isIOS() && !iosSrc && <div className="note warn">{t('ar.ios')}</div>}
    </div>
  )
}
