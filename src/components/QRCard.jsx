import { useEffect, useState } from 'react'
import QRCode from 'qrcode'
import { useI18n } from '../i18n/index.jsx'

export default function QRCard({ url, filename = 'dish-qr.png' }) {
  const { t } = useI18n()
  const [dataUrl, setDataUrl] = useState(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    let cancelled = false
    QRCode.toDataURL(url, {
      width: 512,
      margin: 1,
      errorCorrectionLevel: 'M',
      color: { dark: '#0b0d12ff', light: '#ffffffff' },
    })
      .then((value) => !cancelled && setDataUrl(value))
      .catch(() => !cancelled && setDataUrl(null))
    return () => {
      cancelled = true
    }
  }, [url])

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      setTimeout(() => setCopied(false), 1600)
    } catch {
      setCopied(false)
    }
  }

  return (
    <div className="card qr">
      {dataUrl && <img src={dataUrl} alt="QR code" />}
      <p className="tiny muted" style={{ margin: 0 }}>{t('menu.qrHint')}</p>
      <div className="row" style={{ width: '100%' }}>
        <button className="btn small" onClick={copy}>
          {copied ? t('action.copied') : t('action.copyLink')}
        </button>
        {dataUrl && (
          <a className="btn small" href={dataUrl} download={filename}>
            {t('action.downloadQr')}
          </a>
        )}
      </div>
    </div>
  )
}
