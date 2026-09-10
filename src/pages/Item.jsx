import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import ARView from '../components/ARView.jsx'
import QRCard from '../components/QRCard.jsx'
import { getItem, getAsset, deleteItem } from '../lib/storage.js'
import { useI18n, formatPrice } from '../i18n/index.jsx'

export default function Item() {
  const { id } = useParams()
  const { t, lang } = useI18n()
  const navigate = useNavigate()
  const [item, setItem] = useState(null)
  const [src, setSrc] = useState(null)
  const [poster, setPoster] = useState(null)
  const [missing, setMissing] = useState(false)

  useEffect(() => {
    let urls = []
    getItem(id).then(async (row) => {
      if (!row) {
        setMissing(true)
        return
      }
      setItem(row)
      const [glb, thumb] = await Promise.all([getAsset(id, 'glb'), getAsset(id, 'thumb')])
      if (glb) {
        const url = URL.createObjectURL(glb)
        urls.push(url)
        setSrc(url)
      }
      if (thumb) {
        const url = URL.createObjectURL(thumb)
        urls.push(url)
        setPoster(url)
      }
    })
    return () => urls.forEach(URL.revokeObjectURL)
  }, [id])

  if (missing) {
    return (
      <div className="card stack">
        <p>{t('menu.empty')}</p>
        <Link className="btn" to="/menu">{t('nav.menu')}</Link>
      </div>
    )
  }

  if (!item) return <div className="card">…</div>

  return (
    <div className="stack">
      <div className="spread">
        <div>
          <h1>{item.name}</h1>
          {item.nameAr && <p className="lede" dir="rtl" style={{ margin: 0 }}>{item.nameAr}</p>}
        </div>
        <span className="price" style={{ fontSize: 20, color: 'var(--accent)', fontWeight: 600 }}>
          {formatPrice(item.price, item.currency, lang)}
        </span>
      </div>

      <div className="grid two">
        <div className="stack">
          {src ? <ARView src={src} alt={item.name} poster={poster} /> : <div className="card">…</div>}
          {item.description && <p className="muted" style={{ margin: 0 }}>{item.description}</p>}
        </div>

        <div className="stack">
          <QRCard url={`${window.location.origin}/item/${item.id}`} filename={`${item.id}-qr.png`} />
          <div className="card stack">
            <div className="spread tiny muted">
              <span>{t('details.category')}</span>
              <span>{t(`details.category.${item.category}`)}</span>
            </div>
            <div className="spread tiny muted">
              <span>{t('model.width')}</span>
              <span>{item.shape?.widthCm} cm</span>
            </div>
            <div className="spread tiny muted">
              <span>GLB</span>
              <span>{item.bytes ? `${(item.bytes / 1024 / 1024).toFixed(2)} MB` : '—'}</span>
            </div>
            <div className="row">
              {src && (
                <a className="btn small" href={src} download={`${item.id}.glb`}>{t('action.download')}</a>
              )}
              <button
                className="btn small danger"
                onClick={async () => {
                  await deleteItem(item.id)
                  navigate('/menu')
                }}
              >
                {t('action.delete')}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
