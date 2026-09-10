import { useRef, useState } from 'react'
import { useI18n } from '../i18n/index.jsx'

export default function Dropzone({ onFile }) {
  const { t } = useI18n()
  const inputRef = useRef(null)
  const [over, setOver] = useState(false)

  const take = (fileList) => {
    const file = Array.from(fileList || []).find((f) => f.type.startsWith('image/'))
    if (file) onFile(file)
  }

  return (
    <div
      className={over ? 'dropzone over' : 'dropzone'}
      onClick={() => inputRef.current?.click()}
      onDragOver={(event) => {
        event.preventDefault()
        setOver(true)
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(event) => {
        event.preventDefault()
        setOver(false)
        take(event.dataTransfer.files)
      }}
    >
      <span style={{ fontSize: 40 }}>📸</span>
      <strong>{t('upload.prompt')}</strong>
      <p>{t('upload.hint')}</p>
      <span className="btn primary">{t('upload.button')}</span>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="sr-only"
        onChange={(event) => take(event.target.files)}
      />
    </div>
  )
}
