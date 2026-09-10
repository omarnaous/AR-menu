import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import Dropzone from '../components/Dropzone.jsx'
import CutoutStage from '../components/CutoutStage.jsx'
import ModelStage from '../components/ModelStage.jsx'
import ARView from '../components/ARView.jsx'
import { fileToImage, imageToImageData, applyMask } from '../lib/imaging.js'
import { segmentFood, alphaCoverage, DEFAULT_SEGMENT_OPTIONS } from '../lib/segment.js'
import { buildDishObject, exportGLB, exportUSDZ, disposeObject, DEFAULT_INFLATE_OPTIONS } from '../lib/inflate.js'
import { initArDelivery, publishUsdz, unpublishUsdz } from '../lib/ar.js'
import { ENGINES, generateMesh, getApiKey, setApiKey } from '../lib/ai3d.js'
import { importDishGlb, countTriangles, DEFAULT_IMPORT_OPTIONS } from '../lib/glbImport.js'
import { imageDataToCanvas, canvasToBlob } from '../lib/imaging.js'
import { createId, saveItem } from '../lib/storage.js'
import { useI18n, CURRENCIES } from '../i18n/index.jsx'

const STEPS = ['photo', 'cutout', 'model', 'publish']
const CATEGORIES = ['starters', 'mains', 'grills', 'desserts', 'drinks']
const TILTS = [
  { value: 90, key: 'model.tilt.top' },
  { value: 45, key: 'model.tilt.angle' },
  { value: 0, key: 'model.tilt.front' },
]

// Gives React a frame to paint the spinner before a long synchronous pass.
const nextFrame = () => new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)))

export default function Studio() {
  const { t, lang } = useI18n()
  const navigate = useNavigate()
  const stageRef = useRef(null)

  const [step, setStep] = useState('photo')
  const [source, setSource] = useState(null)
  const [alpha, setAlpha] = useState(null)
  const [alphaVersion, setAlphaVersion] = useState(0)
  const [segment, setSegment] = useState(DEFAULT_SEGMENT_OPTIONS)
  const [rect, setRect] = useState(null)
  const [tool, setTool] = useState('rect')
  const [brushSize, setBrushSize] = useState(18)

  const [engine, setEngine] = useState('inflate')
  const [apiKey, setKey] = useState(() => getApiKey())
  const [aiBuffer, setAiBuffer] = useState(null)
  const [aiShape, setAiShape] = useState(DEFAULT_IMPORT_OPTIONS)
  const abortRef = useRef(null)

  const [shape, setShape] = useState(DEFAULT_INFLATE_OPTIONS)
  const [object, setObject] = useState(null)
  const [stats, setStats] = useState(null)
  const [glb, setGlb] = useState(null)
  const [glbUrl, setGlbUrl] = useState(null)
  const [usdz, setUsdz] = useState(null)
  const [usdzUrl, setUsdzUrl] = useState(null)
  const [usdzFileUrl, setUsdzFileUrl] = useState(null)
  const [thumb, setThumb] = useState(null)
  const previewId = useRef(`preview_${Math.random().toString(36).slice(2, 9)}`)

  const [details, setDetails] = useState({
    name: '',
    nameAr: '',
    description: '',
    price: '',
    currency: 'AED',
    category: 'mains',
  })

  const [status, setStatus] = useState(null)
  const [error, setError] = useState(null)
  const [saving, setSaving] = useState(false)

  const objectRef = useRef(null)
  objectRef.current = object

  useEffect(() => {
    initArDelivery()
  }, [])
  useEffect(() => () => disposeObject(objectRef.current), [])
  useEffect(() => {
    const id = previewId.current
    return () => unpublishUsdz(id)
  }, [])
  useEffect(() => () => glbUrl && URL.revokeObjectURL(glbUrl), [glbUrl])
  useEffect(() => () => usdzFileUrl && URL.revokeObjectURL(usdzFileUrl), [usdzFileUrl])

  const invalidateExports = useCallback(() => {
    setGlb(null)
    setGlbUrl((previous) => {
      if (previous) URL.revokeObjectURL(previous)
      return null
    })
    setUsdz(null)
    setUsdzUrl(null)
    setUsdzFileUrl((previous) => {
      if (previous) URL.revokeObjectURL(previous)
      return null
    })
  }, [])

  const runSegmentation = useCallback(
    async (imageData, options, boundingRect) => {
      setStatus(t('status.segmenting'))
      setError(null)
      await nextFrame()
      try {
        const mask = segmentFood(imageData, { ...options, rect: boundingRect })
        setAlpha(mask)
        setAlphaVersion((value) => value + 1)
      } catch (cause) {
        setError(cause.message || t('error.generic'))
      } finally {
        setStatus(null)
      }
    },
    [t],
  )

  const handleFile = async (file) => {
    setStatus(t('status.reading'))
    setError(null)
    try {
      const image = await fileToImage(file)
      const imageData = imageToImageData(image)
      setSource(imageData)
      setRect(null)
      setTool('rect')
      setStep('cutout')
      await runSegmentation(imageData, segment, null)
    } catch (cause) {
      setStatus(null)
      setError(cause.message || t('error.generic'))
    }
  }

  // Sliders re-run the whole cut-out, so they are debounced rather than live.
  const segmentSignature = `${segment.tolerance}|${segment.shrink}|${segment.feather}|${JSON.stringify(rect)}`
  const firstSegmentRun = useRef(true)
  useEffect(() => {
    if (!source) return
    if (firstSegmentRun.current) {
      firstSegmentRun.current = false
      return
    }
    const timer = setTimeout(() => runSegmentation(source, segment, rect), 220)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [segmentSignature, source])

  const coverage = useMemo(() => (alpha ? alphaCoverage(alpha) : 0), [alpha, alphaVersion])

  const buildModel = useCallback(
    async (options) => {
      if (!source || !alpha) return
      setStatus(t('status.inflating'))
      setError(null)
      await nextFrame()
      try {
        const masked = applyMask(source, alpha)
        const next = buildDishObject(masked, options)
        disposeObject(objectRef.current)
        setObject(next)
        invalidateExports()

        let triangles = 0
        next.traverse((child) => {
          if (child.isMesh) {
            const index = child.geometry.getIndex()
            triangles += (index ? index.count : child.geometry.getAttribute('position').count) / 3
          }
        })
        setStats({ triangles: Math.round(triangles) })
      } catch (cause) {
        setError(cause.message || t('error.generic'))
      } finally {
        setStatus(null)
      }
    },
    [source, alpha, t],
  )

  const buildAiModel = useCallback(
    async (buffer, options) => {
      if (!buffer) return
      setStatus(t('status.assembling'))
      setError(null)
      await nextFrame()
      try {
        const next = await importDishGlb(buffer, options)
        disposeObject(objectRef.current)
        setObject(next)
        setStats({ triangles: countTriangles(next) })
        invalidateExports()
      } catch (cause) {
        setError(cause.message || t('error.generic'))
      } finally {
        setStatus(null)
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [t],
  )

  // The reconstruction costs money per call, so the GLB is fetched once and
  // every later tweak re-places that same buffer locally.
  const runAi = async () => {
    if (!source || !alpha) return
    const controller = new AbortController()
    abortRef.current = controller
    setError(null)
    setStep('model')
    try {
      const blob = await canvasToBlob(imageDataToCanvas(applyMask(source, alpha)), 'image/png')
      const buffer = await generateMesh({
        blob,
        engine,
        apiKey,
        signal: controller.signal,
        onProgress: (stage, position) =>
          setStatus(position ? `${t(`status.ai.${stage}`)} (${position})` : t(`status.ai.${stage}`)),
      })
      setAiBuffer(buffer)
      await buildAiModel(buffer, aiShape)
    } catch (cause) {
      setStatus(null)
      if (cause.name !== 'AbortError') setError(cause.message || t('error.generic'))
    } finally {
      abortRef.current = null
    }
  }

  const goToModel = async () => {
    if (engine !== 'inflate') {
      await runAi()
      return
    }
    setStep('model')
    await buildModel(shape)
  }

  const shapeSignature = JSON.stringify(shape)
  useEffect(() => {
    if (step !== 'model' || !object || engine !== 'inflate') return
    const timer = setTimeout(() => buildModel(shape), 260)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shapeSignature])

  const aiSignature = JSON.stringify(aiShape)
  useEffect(() => {
    if (step !== 'model' || !aiBuffer) return
    const timer = setTimeout(() => buildAiModel(aiBuffer, aiShape), 260)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aiSignature])

  // The live preview is unmounted on the publish step, so grab the thumbnail
  // while its WebGL context is still around.
  const goToPublish = async () => {
    setThumb(await stageRef.current?.captureThumbnail())
    setStep('publish')
  }

  // Android and the web viewer read the GLB; iOS Quick Look reads the USDZ.
  // Both come out of the same three.js object, so they are built together.
  const ensureExports = useCallback(async () => {
    if (!object) return null
    if (glb) return glb
    setStatus(t('status.exporting'))
    await nextFrame()
    try {
      const blob = await exportGLB(object)
      setGlb(blob)
      setGlbUrl((previous) => {
        if (previous) URL.revokeObjectURL(previous)
        return URL.createObjectURL(blob)
      })

      setStatus(t('status.usdz'))
      await nextFrame()
      try {
        const usdzBlob = await exportUSDZ(object)
        setUsdz(usdzBlob)
        setUsdzFileUrl((previous) => {
          if (previous) URL.revokeObjectURL(previous)
          return URL.createObjectURL(usdzBlob)
        })
        setUsdzUrl(await publishUsdz(previewId.current, usdzBlob))
      } catch {
        // A failed USDZ only costs iOS camera AR, so the GLB still ships.
        setUsdz(null)
        setUsdzUrl(null)
        setUsdzFileUrl((previous) => {
          if (previous) URL.revokeObjectURL(previous)
          return null
        })
      }
      return blob
    } catch (cause) {
      setError(cause.message || t('error.generic'))
      return null
    } finally {
      setStatus(null)
    }
  }, [glb, object, t])

  useEffect(() => {
    if (step === 'publish') ensureExports()
  }, [step, ensureExports])

  const save = async () => {
    const blob = glb || (await ensureExports())
    if (!blob) return
    setSaving(true)
    try {
      const id = createId()
      await saveItem(
        {
          id,
          createdAt: Date.now(),
          name: details.name.trim() || 'Untitled dish',
          nameAr: details.nameAr.trim(),
          description: details.description.trim(),
          price: details.price === '' ? null : Number(details.price),
          currency: details.currency,
          category: details.category,
          engine,
          shape: engine === 'inflate' ? shape : aiShape,
          bytes: blob.size,
          triangles: stats?.triangles ?? null,
        },
        { glb: blob, usdz, thumb },
      )
      navigate(`/item/${id}`)
    } catch (cause) {
      setError(cause.message || t('error.generic'))
    } finally {
      setSaving(false)
    }
  }

  const reset = () => {
    disposeObject(objectRef.current)
    setObject(null)
    setSource(null)
    setAlpha(null)
    setGlb(null)
    setGlbUrl((previous) => {
      if (previous) URL.revokeObjectURL(previous)
      return null
    })
    setUsdz(null)
    setUsdzUrl(null)
    setUsdzFileUrl((previous) => {
      if (previous) URL.revokeObjectURL(previous)
      return null
    })
    setStats(null)
    setAiBuffer(null)
    setAiShape(DEFAULT_IMPORT_OPTIONS)
    setThumb(null)
    setRect(null)
    setSegment(DEFAULT_SEGMENT_OPTIONS)
    setShape(DEFAULT_INFLATE_OPTIONS)
    setStep('photo')
    firstSegmentRun.current = true
  }

  const stepIndex = STEPS.indexOf(step)

  return (
    <div className="stack">
      <div>
        <h1>{t('app.title')}</h1>
        <p className="lede">{t('app.tagline')}</p>
      </div>

      <ol className="steps">
        {STEPS.map((name, index) => (
          <li key={name} className={index === stepIndex ? 'current' : index < stepIndex ? 'done' : ''}>
            <b>{index + 1}</b>
            {t(`step.${name}`)}
          </li>
        ))}
      </ol>

      {error && <div className="note bad">{error}</div>}

      {step === 'photo' && (
        <div className="grid two">
          <Dropzone onFile={handleFile} />
          <div className="card">
            <h2>{t('upload.tips.title')}</h2>
            <ul className="tips">
              <li>{t('upload.tips.1')}</li>
              <li>{t('upload.tips.2')}</li>
              <li>{t('upload.tips.3')}</li>
              <li>{t('upload.tips.4')}</li>
            </ul>
          </div>
        </div>
      )}

      {step === 'cutout' && source && (
        <div className="grid two">
          <CutoutStage
            source={source}
            alpha={alpha}
            tool={tool}
            brushSize={brushSize}
            onRect={setRect}
            onAlphaPainted={() => setAlphaVersion((value) => value + 1)}
            busy={Boolean(status)}
            busyLabel={status}
          />
          <div className="card controls">
            <h2>{t('cut.title')}</h2>

            <div className="seg" role="group">
              {['rect', 'erase', 'restore'].map((value) => (
                <button key={value} aria-pressed={tool === value} onClick={() => setTool(value)}>
                  {value === 'rect' ? '▭' : value === 'erase' ? '⌫' : '✚'} {t(`cut.tool.${value}`)}
                </button>
              ))}
            </div>

            {tool === 'rect' && <p className="tiny muted" style={{ margin: 0 }}>{t('cut.rect')}</p>}

            <Slider
              label={t('cut.tolerance')}
              min={0}
              max={1}
              step={0.02}
              value={segment.tolerance}
              onChange={(value) => setSegment((s) => ({ ...s, tolerance: value }))}
              format={(v) => `${Math.round(v * 100)}%`}
            />
            <Slider
              label={t('cut.shrink')}
              min={0}
              max={5}
              step={1}
              value={segment.shrink}
              onChange={(value) => setSegment((s) => ({ ...s, shrink: value }))}
              format={(v) => `${v} px`}
            />
            <Slider
              label={t('cut.feather')}
              min={0}
              max={6}
              step={0.5}
              value={segment.feather}
              onChange={(value) => setSegment((s) => ({ ...s, feather: value }))}
              format={(v) => `${v} px`}
            />
            {tool !== 'rect' && (
              <Slider
                label={t('cut.brushSize')}
                min={4}
                max={80}
                step={1}
                value={brushSize}
                onChange={setBrushSize}
                format={(v) => `${v} px`}
              />
            )}

            <p className="tiny muted" style={{ margin: 0 }}>
              {t('cut.coverage', { value: (coverage * 100).toFixed(1) })}
            </p>
            {coverage < 0.02 && <div className="note bad">{t('cut.warnSmall')}</div>}
            {coverage > 0.9 && <div className="note warn">{t('cut.warnLarge')}</div>}

            <div className="field">
              <label>{t('engine.label')}</label>
              <div className="seg">
                <button aria-pressed={engine === 'inflate'} onClick={() => setEngine('inflate')}>
                  {t('engine.inflate')}
                </button>
                {Object.values(ENGINES).map((option) => (
                  <button
                    key={option.id}
                    aria-pressed={engine === option.id}
                    onClick={() => setEngine(option.id)}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>

            {engine !== 'inflate' && (
              <>
                <p className="tiny muted" style={{ margin: 0 }}>{ENGINES[engine].note}</p>
                <div className="field">
                  <label>{t('engine.key')}</label>
                  <input
                    type="password"
                    value={apiKey}
                    autoComplete="off"
                    placeholder="fal.ai API key"
                    onChange={(event) => {
                      setKey(event.target.value)
                      setApiKey(event.target.value)
                    }}
                  />
                </div>
                <div className="note warn">{t('engine.keyWarning')}</div>
              </>
            )}

            <div className="row">
              <button className="btn ghost" onClick={reset}>{t('action.back')}</button>
              <button className="btn" onClick={() => runSegmentation(source, segment, rect)} disabled={Boolean(status)}>
                {t('cut.recompute')}
              </button>
              <button
                className="btn primary"
                onClick={goToModel}
                disabled={Boolean(status) || coverage < 0.005 || (engine !== 'inflate' && !apiKey)}
              >
                {t('action.next')}
              </button>
            </div>
          </div>
        </div>
      )}

      {step === 'model' && (
        <div className="grid two">
          <ModelStage ref={stageRef} object={object} busy={Boolean(status)} busyLabel={status} />
          <div className="card controls">
            <h2>{t('model.title')}</h2>
            {engine === 'inflate' && (
              <>

            <div className="field">
              <label>{t('model.tilt')}</label>
              <div className="seg">
                {TILTS.map((tilt) => (
                  <button
                    key={tilt.value}
                    aria-pressed={shape.tiltDeg === tilt.value}
                    onClick={() => setShape((s) => ({ ...s, tiltDeg: tilt.value }))}
                  >
                    {t(tilt.key)}
                  </button>
                ))}
              </div>
            </div>

            <Slider
              label={t('model.width')}
              min={8}
              max={45}
              step={1}
              value={shape.widthCm}
              onChange={(value) => setShape((s) => ({ ...s, widthCm: value }))}
              format={(v) => `${v} cm`}
            />
            <Slider
              label={t('model.puffiness')}
              min={0.05}
              max={0.9}
              step={0.01}
              value={shape.puffiness}
              onChange={(value) => setShape((s) => ({ ...s, puffiness: value }))}
              format={(v) => v.toFixed(2)}
            />
            <Slider
              label={t('model.back')}
              min={0}
              max={1}
              step={0.05}
              value={shape.backDepth}
              onChange={(value) => setShape((s) => ({ ...s, backDepth: value }))}
              format={(v) => v.toFixed(2)}
            />
            <Slider
              label={t('model.relief')}
              min={0}
              max={1.5}
              step={0.05}
              value={shape.relief}
              onChange={(value) => setShape((s) => ({ ...s, relief: value }))}
              format={(v) => v.toFixed(2)}
            />
            <Slider
              label={t('model.quality')}
              min={64}
              max={280}
              step={8}
              value={shape.gridRes}
              onChange={(value) => setShape((s) => ({ ...s, gridRes: value }))}
              format={(v) => `${v}`}
            />
            <label className="check">
              <input
                type="checkbox"
                checked={shape.detectPlate}
                onChange={(event) => setShape((s) => ({ ...s, detectPlate: event.target.checked }))}
              />
              {t('model.detectPlate')}
            </label>
            <label className="check">
              <input
                type="checkbox"
                checked={shape.plate}
                onChange={(event) => setShape((s) => ({ ...s, plate: event.target.checked }))}
                disabled={shape.tiltDeg <= 30}
              />
              {t('model.plate')}
            </label>

              </>
            )}

            {engine !== 'inflate' && (
              <>
                <Slider
                  label={t('model.width')}
                  min={8}
                  max={45}
                  step={1}
                  value={aiShape.widthCm}
                  onChange={(value) => setAiShape((a) => ({ ...a, widthCm: value }))}
                  format={(v) => `${v} cm`}
                />
                <Slider
                  label={t('model.yaw')}
                  min={0}
                  max={350}
                  step={10}
                  value={aiShape.yawDeg}
                  onChange={(value) => setAiShape((a) => ({ ...a, yawDeg: value }))}
                  format={(v) => `${v}°`}
                />
                <label className="check">
                  <input
                    type="checkbox"
                    checked={aiShape.plate}
                    onChange={(event) => setAiShape((a) => ({ ...a, plate: event.target.checked }))}
                  />
                  {t('model.plate')}
                </label>
                <p className="tiny muted" style={{ margin: 0 }}>{t('model.aiNote')}</p>
              </>
            )}
            {stats && (
              <p className="tiny muted" style={{ margin: 0 }}>
                {stats.triangles.toLocaleString(lang === 'ar' ? 'ar-AE' : 'en-US')} triangles
              </p>
            )}

            <div className="row">
              <button className="btn ghost" onClick={() => setStep('cutout')}>{t('action.back')}</button>
              <button className="btn primary" onClick={goToPublish} disabled={!object || Boolean(status)}>
                {t('action.next')}
              </button>
            </div>
          </div>
        </div>
      )}

      {step === 'publish' && (
        <div className="grid two">
          <div className="stack">
            {glbUrl ? (
              <ARView src={glbUrl} iosSrc={usdzUrl} alt={details.name || t('app.title')} />
            ) : (
              <div className="stage viewport" style={{ position: 'relative' }}>
                <div className="busy">
                  <div className="spinner" />
                  <span>{status || t('status.exporting')}</span>
                </div>
              </div>
            )}
            {glb && (
              <p className="tiny muted" style={{ margin: 0 }}>
                GLB {(glb.size / 1024 / 1024).toFixed(2)} MB
                {usdz ? ` · USDZ ${(usdz.size / 1024 / 1024).toFixed(2)} MB` : ''} ·{' '}
                {stats?.triangles?.toLocaleString('en-US')} triangles
              </p>
            )}
          </div>
          <div className="card controls">
            <h2>{t('details.title')}</h2>
            <Text label={t('details.name')} value={details.name} onChange={(v) => setDetails((d) => ({ ...d, name: v }))} />
            <Text
              label={t('details.nameAr')}
              value={details.nameAr}
              dir="rtl"
              onChange={(v) => setDetails((d) => ({ ...d, nameAr: v }))}
            />
            <div className="field">
              <label>{t('details.desc')}</label>
              <textarea
                value={details.description}
                onChange={(event) => setDetails((d) => ({ ...d, description: event.target.value }))}
              />
            </div>
            <div className="row">
              <div className="field">
                <label>{t('details.price')}</label>
                <input
                  type="number"
                  min="0"
                  step="0.25"
                  value={details.price}
                  onChange={(event) => setDetails((d) => ({ ...d, price: event.target.value }))}
                />
              </div>
              <div className="field">
                <label>{t('details.currency')}</label>
                <select
                  value={details.currency}
                  onChange={(event) => setDetails((d) => ({ ...d, currency: event.target.value }))}
                >
                  {CURRENCIES.map((code) => (
                    <option key={code} value={code}>{code}</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="field">
              <label>{t('details.category')}</label>
              <select
                value={details.category}
                onChange={(event) => setDetails((d) => ({ ...d, category: event.target.value }))}
              >
                {CATEGORIES.map((key) => (
                  <option key={key} value={key}>{t(`details.category.${key}`)}</option>
                ))}
              </select>
            </div>

            <div className="row">
              <button className="btn ghost" onClick={() => setStep('model')}>{t('action.back')}</button>
              {glbUrl && (
                <a className="btn" href={glbUrl} download={`${slugify(details.name)}.glb`}>
                  {t('action.download')}
                </a>
              )}
              {usdzFileUrl && (
                <a className="btn" href={usdzFileUrl} download={`${slugify(details.name)}.usdz`}>
                  {t('action.downloadUsdz')}
                </a>
              )}
              <button className="btn primary" onClick={save} disabled={!glb || saving}>
                {t('action.save')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function slugify(name) {
  return (name || 'dish').trim().replace(/\s+/g, '-').toLowerCase() || 'dish'
}

function Slider({ label, min, max, step, value, onChange, format }) {
  return (
    <div className="field">
      <label>
        <span>{label}</span>
        <output>{format ? format(value) : value}</output>
      </label>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </div>
  )
}

function Text({ label, value, onChange, dir }) {
  return (
    <div className="field">
      <label>{label}</label>
      <input type="text" value={value} dir={dir} onChange={(event) => onChange(event.target.value)} />
    </div>
  )
}
