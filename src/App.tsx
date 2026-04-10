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
  { key: 'altitude', color: '#ff8c42', label: '고도', unit: 'm' },
  { key: 'external_temp', color: '#7dd3fc', label: '외부 온도', unit: '도C' },
  { key: 'battery_level', color: '#fde047', label: '배터리', unit: '%' },
  { key: 'signal_strength', color: '#f87171', label: '통신 세기', unit: 'dBm' },
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
    return '잘못된 시간'
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
    throw new Error(`${index + 1}번째 행: 각 항목은 객체여야 합니다.`)
  }

  for (const key of requiredKeys) {
    if (!(key in point)) {
      throw new Error(`${index + 1}번째 행: 필수 필드 "${key}"가 없습니다.`)
    }
  }

  const candidate = point as Record<string, unknown>

  if (
    typeof candidate.timestamp !== 'string' ||
    Number.isNaN(new Date(candidate.timestamp).getTime())
  ) {
    throw new Error(`${index + 1}번째 행: timestamp는 유효한 ISO 8601 문자열이어야 합니다.`)
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
      throw new Error(`${index + 1}번째 행: "${key}" 필드는 숫자여야 합니다.`)
    }
  }

  if (candidate.signal_strength !== null && !isFiniteNumber(candidate.signal_strength)) {
    throw new Error(`${index + 1}번째 행: "signal_strength" 필드는 숫자 또는 null이어야 합니다.`)
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
      title: '업로드 대기',
      message: '텔레메트리 JSON 파일을 업로드하면 분석을 시작합니다.',
    }
  }

  if (latest.altitude === 0 && latest.battery_level === 0 && latest.signal_strength === 0) {
    return {
      tone: 'offline' as StatusTone,
      title: '임무 종료',
      message: '마지막 패킷에서 전체 신호 상실과 시스템 종료가 감지되었습니다.',
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
      title: '심각 상태',
      message: '전력 여유, 통신 품질, 자세 안정성이 모두 위험 구간에 들어갔습니다.',
    }
  }

  if (
    latest.battery_level <= 45 ||
    (latest.cpu_load ?? 0) >= 75 ||
    (previous && latest.external_temp - previous.external_temp <= -2.5)
  ) {
    return {
      tone: 'warning' as StatusTone,
      title: '주의 상태',
      message: '임무는 진행 중이지만 열환경 또는 전력 추세에 개입이 필요합니다.',
    }
  }

  return {
    tone: 'stable' as StatusTone,
    title: '정상 상승',
    message: '텔레메트리 흐름이 안정적이며 상승과 탑재체 상태가 정상 범위에 있습니다.',
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
              : '없음'}
          </strong>
        </div>
        <span className="chart-chip" style={{ '--chip-color': metric.color } as CSSProperties}>
          {metric.unit}
        </span>
      </header>
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${metric.label} 차트`}>
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
        throw new Error('JSON 최상위 값은 텔레메트리 객체 배열이어야 합니다.')
      }

      if (parsed.length === 0) {
        throw new Error('텔레메트리 배열이 비어 있습니다.')
      }

      parsed.forEach((point, index) => validateTelemetryPoint(point, index))

      setPoints(parsed as TelemetryPoint[])
      setFileName(file.name)
      setError(null)
    } catch (reason) {
      setPoints([])
      setFileName('')
      setError(reason instanceof Error ? reason.message : '업로드한 JSON 파일을 해석하지 못했습니다.')
    } finally {
      event.target.value = ''
    }
  }

  return (
    <main className="app-shell">
      <section className="hero-panel">
        <div className="hero-copy">
          <span className={`status-pill status-pill--${status.tone}`}>{status.title}</span>
          <h1>SE3C 큐브위성 텔레메트리 분석기</h1>
          <p>
            업로드한 JSON 텔레메트리 로그를 브라우저에서 바로 분석합니다. 고도, 온도,
            배터리, 통신, 이상 시점, 최종 실패 패턴까지 한 화면에서 확인할 수 있습니다.
          </p>
          <label className="upload-panel" htmlFor="telemetry-upload">
            <span className="upload-kicker">JSON 업로드</span>
            <strong>{fileName || '텔레메트리 파일 선택'}</strong>
            <span>
              텔레메트리 객체 배열 형태의 JSON을 읽습니다. 필수 필드는 timestamp, altitude,
              온도, humidity, battery, power, solar, signal_strength입니다.
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
            <span>임무 추적</span>
            <strong>{points.length}</strong>
            <small>{fileName ? '샘플 분석 완료' : '업로드 대기 중'}</small>
          </div>
        </div>
      </section>

      {error ? (
        <section className="message-panel message-panel--error">
          <h2>업로드 실패</h2>
          <p>{error}</p>
        </section>
      ) : null}

      {!error && points.length === 0 ? (
        <section className="message-panel">
          <h2>텔레메트리 파일을 올려주세요</h2>
          <p>
            이 페이지는 더미 데이터를 자동으로 불러오지 않습니다. 직접 JSON 파일을 넣으면
            브라우저에서 구조를 검증하고 내용을 분석합니다.
          </p>
        </section>
      ) : null}

      {points.length > 0 && stats ? (
        <>
          <section className="metrics-grid">
            <MetricCard
              label="최고 고도"
              value={formatNumber(stats.maxAltitude, ' m', 0)}
              detail={`${points.length}개 텔레메트리 샘플 분석`}
              tone="stable"
            />
            <MetricCard
              label="배터리 여유"
              value={formatNumber(stats.batteryMargin, '%')}
              detail={`발전 여유 ${formatNumber(stats.generationMargin, ' W', 3)}`}
              tone={stats.batteryMargin <= 25 ? 'critical' : 'warning'}
            />
            <MetricCard
              label="통신 이상"
              value={`${stats.nullSignalCount + stats.criticalPackets}`}
              detail={`null ${stats.nullSignalCount}건, 심각 손실 ${stats.criticalPackets}건`}
              tone="critical"
            />
            <MetricCard
              label="임무 종료 시점"
              value={
                stats.offlineIndex >= 0 ? formatTime(points[stats.offlineIndex]!.timestamp) : '없음'
              }
              detail="마지막 0값 패킷 또는 단절 시퀀스 탐지"
              tone="offline"
            />
          </section>

          <section className="section-head">
            <div>
              <p className="eyebrow">현재 상태</p>
              <h2>시스템 스냅샷</h2>
            </div>
            <p>{status.message}</p>
          </section>

          <section className="snapshot-grid">
            <div className="snapshot-panel">
              <h3>최신 패킷</h3>
              <dl>
                <div>
                  <dt>시각</dt>
                  <dd>{latest ? formatTime(latest.timestamp) : '-'}</dd>
                </div>
                <div>
                  <dt>고도</dt>
                  <dd>{latest ? formatNumber(latest.altitude, ' m', 0) : '-'}</dd>
                </div>
                <div>
                  <dt>통신 세기</dt>
                  <dd>
                    {latest?.signal_strength === null
                      ? '없음'
                      : latest
                        ? formatNumber(latest.signal_strength, ' dBm')
                        : '-'}
                  </dd>
                </div>
                <div>
                  <dt>CPU 부하</dt>
                  <dd>
                    {latest?.cpu_load !== undefined ? formatNumber(latest.cpu_load, '%') : '없음'}
                  </dd>
                </div>
              </dl>
            </div>

            <div className="snapshot-panel">
              <h3>임무 해석</h3>
              <ul className="signal-list">
                <li>
                  <span className="list-key">원본 파일</span>
                  <strong>{fileName}</strong>
                </li>
                <li>
                  <span className="list-key">성층권 진입</span>
                  <strong>
                    {stats.stratosphereEntry
                      ? `${formatTime(stats.stratosphereEntry.timestamp)} / ${formatNumber(
                          stats.stratosphereEntry.external_temp,
                          ' 도C',
                        )}`
                      : '감지되지 않음'}
                  </strong>
                </li>
                <li>
                  <span className="list-key">전력 부족 여부</span>
                  <strong>
                    {stats.generationMargin < 0
                      ? '발전량이 소비전력보다 낮음'
                      : '발전량이 소비전력보다 높음'}
                  </strong>
                </li>
                <li>
                  <span className="list-key">실패 양상</span>
                  <strong>통신 붕괴 + 전력 고갈 + 자세 오차 누적</strong>
                </li>
              </ul>
            </div>
          </section>

          <section className="section-head">
            <div>
              <p className="eyebrow">텔레메트리 추세</p>
              <h2>핵심 채널</h2>
            </div>
            <p>업로드한 JSON을 서버 전처리 없이 바로 읽어 차트로 갱신합니다.</p>
          </section>

          <section className="charts-grid">
            {chartMetrics.map((metric) => (
              <Sparkline key={metric.key} points={points} metric={metric} />
            ))}
          </section>

          <section className="section-head">
            <div>
              <p className="eyebrow">예외 처리 연습</p>
              <h2>이상 이벤트 타임라인</h2>
            </div>
            <p>통신 null, 패킷 손실 급증, 급격한 온도 하락, 마지막 0값 종료 패킷을 추적합니다.</p>
          </section>

          <section className="timeline-panel">
            {anomalyMoments.slice(0, 10).map((point) => {
              const issue =
                point.altitude === 0 && point.battery_level === 0
                  ? '최종 연결 끊김'
                  : point.signal_strength === null
                    ? '통신 값 null 발생'
                    : (point.packet_loss ?? 0) >= 40
                      ? '심각한 패킷 손실'
                      : (point.attitude_error ?? 0) >= 15
                        ? '자세 불안정'
                        : '성층권 진입 급랭'

              return (
                <article key={`${point.timestamp}-${issue}`} className="timeline-entry">
                  <div>
                    <span>{formatTime(point.timestamp)}</span>
                    <h3>{issue}</h3>
                  </div>
                  <p>
                    고도 {formatNumber(point.altitude, ' m', 0)} / 배터리{' '}
                    {formatNumber(point.battery_level, '%')} / 통신{' '}
                    {point.signal_strength === null
                      ? '없음'
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
