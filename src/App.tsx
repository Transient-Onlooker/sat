import type { ChangeEvent, CSSProperties } from 'react'
import { useMemo, useState } from 'react'
import './App.css'

type TelemetryPoint = {
  timestamp: string
  altitude: number
  external_temp: number
  internal_temp: number
  humidity: number
  battery_level: number
  power_consumption: number
  solar_generation: number
  signal_strength: number | null
  pressure_hpa?: number
  vertical_speed?: number
  battery_voltage?: number
  cpu_load?: number
  packet_loss?: number
  attitude_error?: number
}

type StatusTone = 'stable' | 'warning' | 'critical' | 'offline'

type ChartMetric = {
  key: keyof TelemetryPoint
  color: string
  label: string
  unit: string
}

const requiredKeys: Array<keyof TelemetryPoint> = [
  'timestamp',
  'altitude',
  'external_temp',
  'internal_temp',
  'humidity',
  'battery_level',
  'power_consumption',
  'solar_generation',
  'signal_strength',
]

const chartMetrics: ChartMetric[] = [
  { key: 'altitude', color: '#ff8c42', label: 'Altitude', unit: 'm' },
  { key: 'external_temp', color: '#7dd3fc', label: 'External Temp', unit: 'deg C' },
  { key: 'battery_level', color: '#fde047', label: 'Battery', unit: '%' },
  { key: 'signal_strength', color: '#f87171', label: 'Signal', unit: 'dBm' },
]

function formatNumber(value: number, unit = '', digits = 1) {
  return `${value.toFixed(digits)}${unit}`
}

function formatTime(timestamp: string) {
  if (!timestamp) {
    return '--:--:--'
  }

  const parsed = new Date(timestamp)

  if (Number.isNaN(parsed.getTime())) {
    return 'Invalid time'
  }

  return new Intl.DateTimeFormat('ko-KR', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(parsed)
}

function isFiniteNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value)
}

function validateTelemetryPoint(point: unknown, index: number): point is TelemetryPoint {
  if (!point || typeof point !== 'object') {
    throw new Error(`Row ${index + 1}: each item must be an object.`)
  }

  for (const key of requiredKeys) {
    if (!(key in point)) {
      throw new Error(`Row ${index + 1}: missing required field "${key}".`)
    }
  }

  const candidate = point as Record<string, unknown>

  if (typeof candidate.timestamp !== 'string' || Number.isNaN(new Date(candidate.timestamp).getTime())) {
    throw new Error(`Row ${index + 1}: timestamp must be a valid ISO 8601 string.`)
  }

  const numericKeys: Array<Exclude<keyof TelemetryPoint, 'timestamp' | 'signal_strength'>> = [
    'altitude',
    'external_temp',
    'internal_temp',
    'humidity',
    'battery_level',
    'power_consumption',
    'solar_generation',
    'pressure_hpa',
    'vertical_speed',
    'battery_voltage',
    'cpu_load',
    'packet_loss',
    'attitude_error',
  ]

  for (const key of numericKeys) {
    if (candidate[key] !== undefined && !isFiniteNumber(candidate[key])) {
      throw new Error(`Row ${index + 1}: field "${key}" must be a number.`)
    }
  }

  if (candidate.signal_strength !== null && !isFiniteNumber(candidate.signal_strength)) {
    throw new Error(`Row ${index + 1}: field "signal_strength" must be a number or null.`)
  }

  return true
}

function buildPath(
  points: TelemetryPoint[],
  metric: keyof TelemetryPoint,
  width: number,
  height: number,
) {
  const values = points
    .map((point) => point[metric])
    .filter((value): value is number => typeof value === 'number')

  if (values.length === 0) {
    return ''
  }

  const min = Math.min(...values)
  const max = Math.max(...values)
  const range = max - min || 1
  let path = ''

  points.forEach((point, index) => {
    const value = point[metric]

    if (typeof value !== 'number') {
      return
    }

    const x = (index / Math.max(points.length - 1, 1)) * width
    const y = height - ((value - min) / range) * height
    path += `${path ? ' L' : 'M'} ${x.toFixed(2)} ${y.toFixed(2)}`
  })

  return path
}

function describeStatus(latest: TelemetryPoint | undefined, previous: TelemetryPoint | undefined) {
  if (!latest) {
    return {
      tone: 'warning' as StatusTone,
      title: 'Awaiting Upload',
      message: 'Upload a telemetry JSON file to start the mission analysis.',
    }
  }

  if (latest.altitude === 0 && latest.battery_level === 0 && latest.signal_strength === 0) {
    return {
      tone: 'offline' as StatusTone,
      title: 'Mission Lost',
      message: 'Final telemetry packet indicates complete signal loss and subsystem shutdown.',
    }
  }

  if (
    latest.battery_level <= 25 ||
    (latest.packet_loss ?? 0) >= 40 ||
    latest.signal_strength === null ||
    (latest.attitude_error ?? 0) >= 15
  ) {
    return {
      tone: 'critical' as StatusTone,
      title: 'Critical Degradation',
      message: 'Power margin, link quality, and attitude stability have entered a failure regime.',
    }
  }

  if (
    latest.battery_level <= 45 ||
    (latest.cpu_load ?? 0) >= 75 ||
    (previous && latest.external_temp - previous.external_temp <= -2.5)
  ) {
    return {
      tone: 'warning' as StatusTone,
      title: 'Watch Condition',
      message: 'The mission remains online, but thermal or power trends require intervention.',
    }
  }

  return {
    tone: 'stable' as StatusTone,
    title: 'Nominal Ascent',
    message: 'Telemetry remains coherent with gradual ascent and healthy payload behavior.',
  }
}

function Sparkline({
  points,
  metric,
}: {
  points: TelemetryPoint[]
  metric: ChartMetric
}) {
  const width = 360
  const height = 120
  const path = useMemo(() => buildPath(points, metric.key, width, height), [metric.key, points])
  const latestValue = [...points]
    .reverse()
    .find((point) => typeof point[metric.key] === 'number')?.[metric.key]

  return (
    <article className="chart-card">
      <header>
        <div>
          <p>{metric.label}</p>
          <strong>
            {typeof latestValue === 'number'
              ? formatNumber(latestValue, metric.unit, metric.key === 'altitude' ? 0 : 1)
              : 'null'}
          </strong>
        </div>
        <span className="chart-chip" style={{ '--chip-color': metric.color } as CSSProperties}>
          {metric.unit}
        </span>
      </header>
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${metric.label} chart`}>
        <defs>
          <linearGradient id={`gradient-${metric.key}`} x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor={metric.color} stopOpacity="0.45" />
            <stop offset="100%" stopColor={metric.color} stopOpacity="0" />
          </linearGradient>
        </defs>
        <path
          d={path ? `${path} L ${width} ${height} L 0 ${height} Z` : ''}
          fill={`url(#gradient-${metric.key})`}
          opacity="0.7"
        />
        <path d={path} fill="none" stroke={metric.color} strokeWidth="3" strokeLinecap="round" />
      </svg>
      <footer>
        <span>{formatTime(points[0]?.timestamp ?? '')}</span>
        <span>{formatTime(points[points.length - 1]?.timestamp ?? '')}</span>
      </footer>
    </article>
  )
}

function MetricCard({
  label,
  value,
  detail,
  tone = 'stable',
}: {
  label: string
  value: string
  detail: string
  tone?: StatusTone
}) {
  return (
    <article className={`metric-card metric-card--${tone}`}>
      <p>{label}</p>
      <strong>{value}</strong>
      <span>{detail}</span>
    </article>
  )
}

function App() {
  const [points, setPoints] = useState<TelemetryPoint[]>([])
  const [error, setError] = useState<string | null>(null)
  const [fileName, setFileName] = useState<string>('')

  const latest = points.at(-1)
  const previous = points.at(-2)
  const status = describeStatus(latest, previous)

  const stats = useMemo(() => {
    if (points.length === 0) {
      return null
    }

    const livePoints = points.filter((point) => point.altitude > 0 || point.battery_level > 0)
    const maxAltitude = Math.max(...points.map((point) => point.altitude))
    const nullSignalCount = points.filter((point) => point.signal_strength === null).length
    const criticalPackets = points.filter((point) => (point.packet_loss ?? 0) >= 40).length
    const offlineIndex = points.findIndex(
      (point) =>
        point.altitude === 0 &&
        point.external_temp === 0 &&
        point.internal_temp === 0 &&
        point.battery_level === 0,
    )
    const stratosphereEntry = points.find(
      (point, index) =>
        point.altitude >= 15000 &&
        index > 0 &&
        points[index - 1]!.external_temp - point.external_temp >= 2.5,
    )
    const batteryMargin = livePoints.at(-1)?.battery_level ?? 0
    const generationMargin =
      (livePoints.at(-1)?.solar_generation ?? 0) - (livePoints.at(-1)?.power_consumption ?? 0)

    return {
      maxAltitude,
      nullSignalCount,
      criticalPackets,
      offlineIndex,
      stratosphereEntry,
      batteryMargin,
      generationMargin,
    }
  }, [points])

  const anomalyMoments = useMemo(
    () =>
      points.filter((point, index) => {
        const previousPoint = points[index - 1]
        const thermalDrop =
          previousPoint !== undefined &&
          previousPoint.external_temp - point.external_temp >= 2.5 &&
          point.altitude >= 15000

        return (
          point.signal_strength === null ||
          (point.packet_loss ?? 0) >= 40 ||
          (point.attitude_error ?? 0) >= 15 ||
          thermalDrop ||
          (point.altitude === 0 && point.battery_level === 0)
        )
      }),
    [points],
  )

  const handleUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]

    if (!file) {
      return
    }

    try {
      const rawText = await file.text()
      const parsed = JSON.parse(rawText) as unknown

      if (!Array.isArray(parsed)) {
        throw new Error('Root JSON value must be an array of telemetry objects.')
      }

      if (parsed.length === 0) {
        throw new Error('Telemetry array is empty.')
      }

      parsed.forEach((point, index) => validateTelemetryPoint(point, index))

      setPoints(parsed as TelemetryPoint[])
      setFileName(file.name)
      setError(null)
    } catch (reason) {
      setPoints([])
      setFileName('')
      setError(reason instanceof Error ? reason.message : 'Failed to parse the uploaded JSON file.')
    } finally {
      event.target.value = ''
    }
  }

  return (
    <main className="app-shell">
      <section className="hero-panel">
        <div className="hero-copy">
          <span className={`status-pill status-pill--${status.tone}`}>{status.title}</span>
          <h1>SE3C CubeSat Telemetry Console</h1>
          <p>
            JSON telemetry logs are analyzed in-browser after upload. The dashboard extracts
            altitude, temperature, battery, signal, anomaly timing, and terminal failure
            patterns from the file you provide.
          </p>
          <label className="upload-panel" htmlFor="telemetry-upload">
            <span className="upload-kicker">Upload JSON</span>
            <strong>{fileName || 'Choose a telemetry file'}</strong>
            <span>
              Accepts a JSON array of telemetry objects. Required fields include timestamp,
              altitude, temperatures, humidity, battery, power, solar, and signal strength.
            </span>
          </label>
          <input
            id="telemetry-upload"
            className="upload-input"
            type="file"
            accept=".json,application/json"
            onChange={handleUpload}
          />
        </div>
        <div className="hero-surface">
          <div className="hero-grid" />
          <div className="hero-orbit hero-orbit--one" />
          <div className="hero-orbit hero-orbit--two" />
          <div className="hero-core">
            <span>MISSION TRACE</span>
            <strong>{points.length}</strong>
            <small>{fileName ? 'samples parsed' : 'waiting for upload'}</small>
          </div>
        </div>
      </section>

      {error ? (
        <section className="message-panel message-panel--error">
          <h2>Upload failed</h2>
          <p>{error}</p>
        </section>
      ) : null}

      {!error && points.length === 0 ? (
        <section className="message-panel">
          <h2>Upload telemetry to begin</h2>
          <p>
            This page no longer loads bundled dummy data. Drop in your own JSON file and the
            dashboard will validate it and analyze the contents locally in the browser.
          </p>
        </section>
      ) : null}

      {points.length > 0 && stats ? (
        <>
          <section className="metrics-grid">
            <MetricCard
              label="Peak Altitude"
              value={formatNumber(stats.maxAltitude, ' m', 0)}
              detail={`${points.length} telemetry samples parsed`}
              tone="stable"
            />
            <MetricCard
              label="Battery Margin"
              value={formatNumber(stats.batteryMargin, '%')}
              detail={`Solar margin ${formatNumber(stats.generationMargin, ' W', 3)}`}
              tone={stats.batteryMargin <= 25 ? 'critical' : 'warning'}
            />
            <MetricCard
              label="Signal Anomalies"
              value={`${stats.nullSignalCount + stats.criticalPackets}`}
              detail={`${stats.nullSignalCount} null, ${stats.criticalPackets} severe loss`}
              tone="critical"
            />
            <MetricCard
              label="Mission Termination"
              value={
                stats.offlineIndex >= 0 ? formatTime(points[stats.offlineIndex]!.timestamp) : 'N/A'
              }
              detail="Detects zeroed final packets or disconnect sequences"
              tone="offline"
            />
          </section>

          <section className="section-head">
            <div>
              <p className="eyebrow">Current state</p>
              <h2>Subsystem snapshot</h2>
            </div>
            <p>{status.message}</p>
          </section>

          <section className="snapshot-grid">
            <div className="snapshot-panel">
              <h3>Latest packet</h3>
              <dl>
                <div>
                  <dt>Timestamp</dt>
                  <dd>{latest ? formatTime(latest.timestamp) : '-'}</dd>
                </div>
                <div>
                  <dt>Altitude</dt>
                  <dd>{latest ? formatNumber(latest.altitude, ' m', 0) : '-'}</dd>
                </div>
                <div>
                  <dt>Signal</dt>
                  <dd>
                    {latest?.signal_strength === null
                      ? 'null'
                      : latest
                        ? formatNumber(latest.signal_strength, ' dBm')
                        : '-'}
                  </dd>
                </div>
                <div>
                  <dt>CPU Load</dt>
                  <dd>
                    {latest?.cpu_load !== undefined ? formatNumber(latest.cpu_load, '%') : 'N/A'}
                  </dd>
                </div>
              </dl>
            </div>

            <div className="snapshot-panel">
              <h3>Mission interpretation</h3>
              <ul className="signal-list">
                <li>
                  <span className="list-key">Source file</span>
                  <strong>{fileName}</strong>
                </li>
                <li>
                  <span className="list-key">Stratosphere entry</span>
                  <strong>
                    {stats.stratosphereEntry
                      ? `${formatTime(stats.stratosphereEntry.timestamp)} / ${formatNumber(
                          stats.stratosphereEntry.external_temp,
                          ' deg C',
                        )}`
                      : 'Not detected'}
                  </strong>
                </li>
                <li>
                  <span className="list-key">Power deficit</span>
                  <strong>
                    {stats.generationMargin < 0 ? 'Solar below load' : 'Solar exceeds load'}
                  </strong>
                </li>
                <li>
                  <span className="list-key">Failure mode</span>
                  <strong>Link collapse + energy depletion + attitude drift</strong>
                </li>
              </ul>
            </div>
          </section>

          <section className="section-head">
            <div>
              <p className="eyebrow">Telemetry trends</p>
              <h2>Core channels</h2>
            </div>
            <p>Charts update from the uploaded JSON without server-side preprocessing.</p>
          </section>

          <section className="charts-grid">
            {chartMetrics.map((metric) => (
              <Sparkline key={metric.key} points={points} metric={metric} />
            ))}
          </section>

          <section className="section-head">
            <div>
              <p className="eyebrow">Exception practice</p>
              <h2>Anomaly timeline</h2>
            </div>
            <p>Null signal, packet loss spikes, thermal cliffs, and forced zero shutdown packets.</p>
          </section>

          <section className="timeline-panel">
            {anomalyMoments.slice(0, 10).map((point) => {
              const issue =
                point.altitude === 0 && point.battery_level === 0
                  ? 'Final disconnect'
                  : point.signal_strength === null
                    ? 'Null communication sample'
                    : (point.packet_loss ?? 0) >= 40
                      ? 'Severe packet loss'
                      : (point.attitude_error ?? 0) >= 15
                        ? 'Attitude instability'
                        : 'Thermal cliff at stratosphere entry'

              return (
                <article key={`${point.timestamp}-${issue}`} className="timeline-entry">
                  <div>
                    <span>{formatTime(point.timestamp)}</span>
                    <h3>{issue}</h3>
                  </div>
                  <p>
                    Alt {formatNumber(point.altitude, ' m', 0)} / Batt{' '}
                    {formatNumber(point.battery_level, '%')} / Signal{' '}
                    {point.signal_strength === null
                      ? 'null'
                      : formatNumber(point.signal_strength, ' dBm')}
                  </p>
                </article>
              )
            })}
          </section>
        </>
      ) : null}
    </main>
  )
}

export default App
