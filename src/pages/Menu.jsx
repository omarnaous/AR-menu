import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { listItems, getAsset, exportMenu, importMenu } from '../lib/storage.js'
import { useI18n, formatPrice } from '../i18n/index.jsx'

export default function Menu() {
  const { t, lang } = useI18n()
  const [items, setItems] = useState([])
  const [thumbs, setThumbs] = useState({})
  const [message, setMessage] = useState(null)
  const importRef = useRef(null)

  const load = async () => {
    const rows = await listItems()
    setItems(rows)
    const urls = {}
    for (const row of rows) {
      const blob = await getAsset(row.id, 'thumb')
      if (blob) urls[row.id] = URL.createObjectURL(blob)
    }
    setThumbs((previous) => {
      for (const url of Object.values(previous)) URL.revokeObjectURL(url)
      return urls
    })
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => () => Object.values(thumbs).forEach(URL.revokeObjectURL), [thumbs])

  const doExport = async () => {
    const blob = await exportMenu()
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `ar-menu-${new Date().toISOString().slice(0, 10)}.json`
    anchor.click()
    URL.revokeObjectURL(url)
  }

  const doImport = async (file) => {
    if (!file) return
    try {
      const count = await importMenu(file)
      setMessage(t('menu.imported', { count }))
      await load()
    } catch (cause) {
      setMessage(cause.message)
    }
  }

  return (
    <div className="stack">
      <div className="spread">
        <div>
          <h1>{t('menu.title')}</h1>
          <p className="lede" style={{ margin: 0 }}>{items.length === 1 ? t('menu.count.one') : t('menu.count', { count: items.length })}</p>
        </div>
        <div className="row" style={{ flex: '0 0 auto' }}>
          <button className="btn small" onClick={doExport} disabled={!items.length}>{t('action.export')}</button>
          <button className="btn small" onClick={() => importRef.current?.click()}>{t('action.import')}</button>
          <Link className="btn small primary" to="/">{t('action.startOver')}</Link>
          <input
            ref={importRef}
            type="file"
            accept="application/json"
            className="sr-only"
            onChange={(event) => doImport(event.target.files?.[0])}
          />
        </div>
      </div>

      {message && <div className="note">{message}</div>}
      <div className="note">{t('menu.localOnly')}</div>

      {!items.length ? (
        <div className="card">{t('menu.empty')}</div>
      ) : (
        <div className="dishes">
          {items.map((item) => (
            <Link key={item.id} className="card dish" to={`/item/${item.id}`}>
              {thumbs[item.id] ? <img src={thumbs[item.id]} alt={item.name} /> : <div style={{ aspectRatio: '4 / 3' }} />}
              <div className="body">
                <h3>{item.name}</h3>
                {item.nameAr && <span className="ar-name" dir="rtl">{item.nameAr}</span>}
                <div className="meta">
                  <span className="price">{formatPrice(item.price, item.currency, lang)}</span>
                  <span className="tiny muted">{t(`details.category.${item.category}`)}</span>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
