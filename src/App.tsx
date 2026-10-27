import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Activity, AlertTriangle, BatteryCharging, Bell, Camera,
  Check, ChevronDown, CircleHelp, Clock3, Download, FileText, Gauge, Heater, Info,
  LockKeyhole, Moon, PlugZap, RefreshCw, Settings2, ShieldAlert, Sun, Thermometer,
  UnlockKeyhole, Wifi, X,
} from 'lucide-react'
import {
  Area, Brush, CartesianGrid, ComposedChart, Legend, Line, LineChart, ReferenceArea, Scatter,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'
import { decodeAlarms, optionalFieldPresent, type Command, type Sample } from './domain'
import { calculatePairMetrics, calculateTemperatureMetrics } from './metrics'
import { downloadFile, listSessions, saveSession, updateSession, type SessionRecord, samplesToCsv } from './persistence'
import { useDashboard } from './useDashboard'

const WINDOW_MS: Record<string, number> = { '5m': 5 * 60_000, '30m': 30 * 60_000, '2h': 2 * 60 * 60_000, all: Infinity }
const SERIES_COLORS = ['#e7a958', '#6bb5a7', '#8ba8ed', '#df7c71']
const fmt = (value: number | null | undefined, digits = 1) => typeof value === 'number' && Number.isFinite(value) ? value.toFixed(digits) : '—'
const timeLabel = (time: number) => new Date(time).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
const durationLabel = (seconds: number | null | undefined) => typeof seconds === 'number' ? seconds < 60 ? `${Math.round(seconds)} dtk` : `${Math.floor(seconds / 3600)}j ${Math.floor((seconds % 3600) / 60)}m` : '—'
const chartSamples = (samples: Sample[], limit = 1600) => {
  if (samples.length <= limit) return samples
  const stride = Math.ceil(samples.length / limit)
  return samples.filter((_, index) => index % stride === 0 || index === samples.length - 1)
}
function MetricTile({ label, value, unit, hint }: { label: string; value: string; unit?: string; hint?: string }) {
  return <div className="metric-tile"><span className="metric-label">{label}</span><strong>{value}<small>{unit}</small></strong>{hint && <span className="metric-hint">{hint}</span>}</div>
}

function WaitCard({ title, icon: Icon, children, waiting, className = '' }: { title: string; icon: typeof Activity; children?: React.ReactNode; waiting: boolean; className?: string }) {
  return <section className={`panel optional-card ${className}`}>
    <div className="panel-heading"><div className="panel-title"><Icon size={16} /><h3>{title}</h3></div><span className={`presence-dot ${waiting ? 'muted' : ''}`} /></div>
    {waiting ? <div className="waiting-state"><span className="waiting-mark" />Menunggu data dari perangkat</div> : children}
  </section>
}

function TemperatureChart({ samples, windowKey, setWindowKey }: { samples: Sample[]; windowKey: string; setWindowKey: (value: string) => void }) {
  const plottedSamples = chartSamples(samples)
  const data = plottedSamples.map(({ receivedAt, telemetry }) => ({
    time: receivedAt, suhu: telemetry.t ?? null, setpoint: telemetry.sp ?? null, daya: telemetry.p ?? null,
    ...(telemetry.ds ?? []).reduce<Record<string, number | null>>((result, value, index) => ({ ...result, [`ds${index + 1}`]: value ?? null }), {}),
  }))
  const sensorCount = Math.max(0, ...plottedSamples.map((sample) => sample.telemetry.ds?.length ?? 0))
  return <section className="panel chart-panel">
    <div className="panel-heading chart-heading"><div><div className="eyebrow">PEMANTAUAN REAL-TIME</div><h2>Tren suhu & pemanas</h2></div>
      <div className="segmented" aria-label="Rentang grafik">{['5m', '30m', '2h', 'all'].map((key) => <button key={key} className={windowKey === key ? 'selected' : ''} onClick={() => setWindowKey(key)}>{key === 'all' ? 'Semua' : key}</button>)}</div>
    </div>
    <div className="chart-legend"><span><i className="legend-line controlled" />Terkendali</span><span><i className="legend-line setpoint" />Setpoint</span>{Array.from({ length: sensorCount }, (_, index) => <span key={index}><i className="legend-line" style={{ borderColor: SERIES_COLORS[index % SERIES_COLORS.length] }} />DS{index + 1}</span>)}<span><i className="legend-bar" />Pemanas</span></div>
    {data.length < 2 ? <div className="chart-empty">Menunggu data historis dari perangkat</div> : <div className="chart-area">
      <ResponsiveContainer width="100%" height="100%"><ComposedChart data={data} margin={{ top: 15, right: 12, bottom: 0, left: -12 }} syncId="timeline">
        <CartesianGrid strokeDasharray="3 5" vertical={false} stroke="var(--grid)" />
        <XAxis dataKey="time" type="number" domain={['dataMin', 'dataMax']} tickFormatter={timeLabel} tick={{ fill: 'var(--muted)', fontSize: 10 }} axisLine={false} tickLine={false} minTickGap={45} />
        <YAxis yAxisId="temp" domain={['auto', 'auto']} tick={{ fill: 'var(--muted)', fontSize: 10 }} axisLine={false} tickLine={false} width={43} />
        <YAxis yAxisId="power" orientation="right" domain={[0, 100]} hide />
        <Tooltip labelFormatter={(value) => timeLabel(Number(value))} contentStyle={{ background: 'var(--panel-raised)', border: '1px solid var(--border)', borderRadius: 5, color: 'var(--text)' }} />
        {data.at(-1)?.setpoint !== null && data.at(-1)?.setpoint !== undefined && <ReferenceArea yAxisId="temp" y1={Number(data.at(-1)?.setpoint) - 0.5} y2={Number(data.at(-1)?.setpoint) + 0.5} fill="#65b7a4" fillOpacity={0.075} />}
        <Area yAxisId="power" type="monotone" dataKey="daya" fill="#d68b45" fillOpacity={0.07} stroke="#d68b45" strokeOpacity={0.45} strokeWidth={1} name="Daya pemanas (%)" isAnimationActive={false} />
        <Line yAxisId="temp" type="monotone" dataKey="suhu" stroke="#e7a958" strokeWidth={2.2} dot={false} name="Terkendali (°C)" connectNulls isAnimationActive={false} />
        <Line yAxisId="temp" type="stepAfter" dataKey="setpoint" stroke="#6bb5a7" strokeWidth={1.6} strokeDasharray="5 4" dot={false} name="Setpoint (°C)" connectNulls isAnimationActive={false} />
        {Array.from({ length: sensorCount }, (_, index) => <Line key={index} yAxisId="temp" type="monotone" dataKey={`ds${index + 1}`} stroke={SERIES_COLORS[index % SERIES_COLORS.length]} strokeWidth={1} strokeOpacity={0.72} dot={false} name={`DS${index + 1} (°C)`} connectNulls isAnimationActive={false} />)}
        <Brush dataKey="time" height={17} stroke="var(--teal)" fill="var(--panel-raised)" tickFormatter={timeLabel} />
      </ComposedChart></ResponsiveContainer>
    </div>}
    <div className="chart-footnote"><span><i className="tolerance-chip" /> Rentang toleransi ±0,5 °C dari setpoint</span><span>Hover titik untuk nilai dan waktu</span></div>
  </section>
}

function SettingsDialog({ settings, updateSettings, close }: { settings: ReturnType<typeof useDashboard>['settings']; updateSettings: ReturnType<typeof useDashboard>['updateSettings']; close: () => void }) {
  const [newDevice, setNewDevice] = useState('')
  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) close() }}><section className="modal settings-modal">
    <div className="modal-heading"><div><div className="eyebrow">PREFERENSI PERANGKAT</div><h2>Pengaturan</h2></div><button className="icon-button" onClick={close} aria-label="Tutup"><X size={18} /></button></div>
    <div className="settings-grid">
      <label className="field wide">URL broker MQTT<input value={settings.brokerUrl} onChange={(event) => updateSettings({ brokerUrl: event.target.value })} placeholder="wss://broker.example:8884/mqtt" /></label>
      <label className="field">Username<input autoComplete="username" value={settings.username} onChange={(event) => updateSettings({ username: event.target.value })} /></label>
      <label className="field">Password<input type="password" autoComplete="new-password" value={settings.password} onChange={(event) => updateSettings({ password: event.target.value })} /></label>
      <label className="field">Perangkat aktif<select value={settings.deviceId} onChange={(event) => updateSettings({ deviceId: event.target.value })}>{settings.devices.map((id) => <option key={id}>{id}</option>)}</select></label>
      <div className="field add-device"><span>Tambah ID perangkat</span><div className="inline-field"><input value={newDevice} onChange={(event) => setNewDevice(event.target.value)} placeholder="icare-02" /><button className="small-button" onClick={() => { const clean = newDevice.trim(); if (clean && /^[a-zA-Z0-9_-]+$/.test(clean)) { updateSettings({ deviceId: clean }); setNewDevice('') } }}>Tambah</button></div></div>
      <label className="field">URL kamera<input value={settings.cameraUrl} onChange={(event) => updateSettings({ cameraUrl: event.target.value })} placeholder="http://alamat-kamera/stream" /></label>
      <label className="field">Setpoint minimum (°C)<input type="number" step="0.1" value={settings.minSetpoint} onChange={(event) => updateSettings({ minSetpoint: Number(event.target.value) })} /></label>
      <label className="field">Setpoint maksimum (°C)<input type="number" step="0.1" value={settings.maxSetpoint} onChange={(event) => updateSettings({ maxSetpoint: Number(event.target.value) })} /></label>
      <label className="field">Ambang bunyi alarm<select value={settings.alarmThreshold} onChange={(event) => updateSettings({ alarmThreshold: Number(event.target.value) })}><option value={1}>Kritis</option><option value={2}>Semua alarm</option></select></label>
      <label className="toggle-field"><input type="checkbox" checked={settings.alarmSound} onChange={(event) => updateSettings({ alarmSound: event.target.checked })} /><span>Bunyi alarm aktif</span></label>
      <label className="toggle-field public-control-toggle"><input type="checkbox" checked={settings.allowPublicControl} onChange={(event) => updateSettings({ allowPublicControl: event.target.checked })} /><span>Izinkan kontrol MQTT pada broker publik (uji coba saja)</span></label>
      <div className="settings-note"><ShieldAlert size={16} />Kredensial disimpan hanya di localStorage browser ini. Broker publik HiveMQ untuk uji coba saja; kontrol tetap terkunci sampai izin uji coba diaktifkan.</div>
    </div>
    <div className="modal-actions"><button className="primary-button" onClick={close}>Selesai</button></div>
  </section></div>
}

function App() {
  const dashboard = useDashboard()
  const { telemetry, samples, settings, updateSettings, online, controlAllowed, stale, connection, lastMessageAt, deviceStatus, source, setSource, now, events, addEvent, pending, sendCommand, messageLog } = dashboard
  const [page, setPage] = useState<'overview' | 'analytics' | 'events' | 'raw'>('overview')
  const [windowKey, setWindowKey] = useState('30m')
  const [setpointDraft, setSetpointDraft] = useState(36.5)
  const [unlockedUntil, setUnlockedUntil] = useState(0)
  const [clock, setClock] = useState(Date.now())
  const [dialog, setDialog] = useState<{ title: string; message: string; action: () => void } | null>(null)
  const [showSettings, setShowSettings] = useState(false)
  const [eventFilter, setEventFilter] = useState('semua')
  const [sessionName, setSessionName] = useState('Uji inkubator')
  const [recording, setRecording] = useState<SessionRecord | null>(null)
  const [sessions, setSessions] = useState<SessionRecord[]>([])
  const [compareIds, setCompareIds] = useState<number[]>([])
  const [openedSession, setOpenedSession] = useState<SessionRecord | null>(null)
  const sessionRef = useRef<SessionRecord | null>(null)
  const lastRecordedAt = useRef(0)
  const samplesWindow = useMemo(() => {
    const cutoff = now - (WINDOW_MS[windowKey] ?? Infinity)
    return samples.filter((sample) => sample.receivedAt >= cutoff)
  }, [samples, now, windowKey])
  const metrics = useMemo(() => calculateTemperatureMetrics(samplesWindow), [samplesWindow])
  const comparedSessions = sessions.filter((session) => session.id !== undefined && compareIds.includes(session.id))
  const energyMetrics = useMemo(() => calculatePairMetrics(samplesWindow.flatMap(({ telemetry: item }) => typeof item.energy?.pred_wh === 'number' && typeof item.energy.actual_wh === 'number' ? [{ predicted: item.energy.pred_wh, actual: item.energy.actual_wh }] : [])), [samplesWindow])
  const alarms = decodeAlarms(telemetry?.alarm)
  const criticalAlarm = alarms.some((alarm) => alarm.severity === 'critical')
  const unlocked = clock < unlockedUntil && controlAllowed
  const target = typeof telemetry?.sp === 'number' ? telemetry.sp : null
  const temperature = typeof telemetry?.t === 'number' ? telemetry.t : null
  const configuredMin = Number.isFinite(settings.minSetpoint) ? settings.minSetpoint : 30
  const configuredMax = Number.isFinite(settings.maxSetpoint) ? settings.maxSetpoint : 37.5
  const controlMin = Math.max(30, Math.min(37.5, configuredMin))
  const controlMax = Math.max(controlMin, Math.min(37.5, configuredMax))
  const controlStatus = criticalAlarm ? 'Alarm' : temperature === null || target === null ? 'Menunggu data' : temperature < target - 0.3 ? 'Memanaskan' : temperature > target + 0.3 ? 'Mendinginkan' : 'Stabil'
  const ds = Array.isArray(telemetry?.ds) ? telemetry.ds : null
  const validSensors = ds?.filter((value): value is number => typeof value === 'number' && Number.isFinite(value)) ?? []
  const sensorSpread = validSensors.length > 1 ? Math.max(...validSensors) - Math.min(...validSensors) : null
  const cameraUrl = (typeof telemetry?.cam === 'string' && telemetry.cam) || settings.cameraUrl

  useEffect(() => {
    const timer = window.setInterval(() => setClock(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [])
  useEffect(() => {
    if (typeof telemetry?.sp === 'number') setSetpointDraft(telemetry.sp)
  }, [telemetry?.sp])
  useEffect(() => {
    if (unlockedUntil > 0) {
      const timer = window.setTimeout(() => setUnlockedUntil(0), Math.max(0, unlockedUntil - Date.now()))
      return () => window.clearTimeout(timer)
    }
  }, [unlockedUntil])
  useEffect(() => { void listSessions().then((items) => setSessions(items.sort((a, b) => b.startedAt - a.startedAt))).catch(() => undefined) }, [])
  useEffect(() => {
    if (!recording || !samples.length) return
    if (recording.deviceId !== settings.deviceId || recording.source !== source) return
    const latest = samples.at(-1)!
    if (latest.receivedAt <= lastRecordedAt.current) return
    lastRecordedAt.current = latest.receivedAt
    const next = { ...recording, samples: [...recording.samples, latest] }
    sessionRef.current = next
    setRecording(next)
    if (next.id !== undefined) void updateSession(next).catch(() => undefined)
  }, [samples, recording, settings.deviceId, source])
  useEffect(() => {
    const key = `icare-last-online:${settings.deviceId}`
    const old = sessionStorage.getItem(key)
    const current = online ? 'online' : 'offline'
    if (old && old !== current) addEvent('status', current === 'online' ? 'Perangkat kembali online' : 'Perangkat offline atau data basi')
    sessionStorage.setItem(key, current)
  }, [online, addEvent, settings.deviceId])
  useEffect(() => {
    if (!settings.alarmSound || !alarms.length) return
    const shouldSound = settings.alarmThreshold === 2 ? alarms.length > 0 : criticalAlarm
    if (!shouldSound) return
    try {
      const audio = new AudioContext()
      const oscillator = audio.createOscillator()
      const gain = audio.createGain()
      oscillator.frequency.value = 760
      gain.gain.value = 0.04
      oscillator.connect(gain); gain.connect(audio.destination); oscillator.start()
      window.setTimeout(() => { oscillator.stop(); void audio.close() }, 180)
    } catch { /* Audio may be unavailable in the browser. */ }
  }, [alarms.length, criticalAlarm, settings.alarmSound, settings.alarmThreshold])

  const applySetpoint = () => {
    const bounded = Math.min(controlMax, Math.max(controlMin, setpointDraft))
    if (bounded !== setpointDraft) setSetpointDraft(Number(bounded.toFixed(1)))
    const previous = target ?? bounded
    setDialog({ title: 'Konfirmasi setpoint', message: `${fmt(previous)} → ${fmt(bounded)} °C?`, action: () => {
      const result = sendCommand({ kind: 'setpoint', value: Number(bounded.toFixed(1)) })
      if (!result.ok && result.message) window.alert(result.message)
      setDialog(null)
    } })
  }
  const runCommand = (command: Command) => {
    const result = sendCommand(command)
    if (!result.ok && result.message) window.alert(result.message)
  }
  const startSession = async () => {
    const session: SessionRecord = { name: sessionName.trim() || `Sesi ${new Date().toLocaleString('id-ID')}`, deviceId: settings.deviceId, source, startedAt: Date.now(), endedAt: null, samples: [] }
    const id = await saveSession(session)
    session.id = Number(id)
    sessionRef.current = session
    lastRecordedAt.current = samples.at(-1)?.receivedAt ?? 0
    setRecording(session)
    addEvent('session', `Perekaman sesi dimulai: ${session.name}`)
  }
  const stopSession = async () => {
    if (!recording) return
    const completed = { ...recording, endedAt: Date.now() }
    await updateSession(completed)
    setSessions((current) => [completed, ...current])
    setRecording(null); sessionRef.current = null
    addEvent('session', `Perekaman sesi selesai: ${completed.name}`)
  }
  const sessionExport = (session: SessionRecord, format: 'json' | 'csv') => {
    const base = session.name.trim().replace(/[^a-z0-9-_]+/gi, '-').toLowerCase() || 'sesi-icare'
    downloadFile(`${base}.${format}`, format === 'json' ? JSON.stringify(session, null, 2) : samplesToCsv(session.samples), format === 'json' ? 'application/json' : 'text/csv')
  }
  const exportReport = () => window.print()
  const visibleEvents = events.filter((event) => eventFilter === 'semua' || event.type === eventFilter)
  const staleLabel = lastMessageAt ? `${Math.max(0, Math.floor((now - lastMessageAt) / 1000))} dtk lalu` : 'Belum ada telemetry'
  const chartData = chartSamples(samplesWindow).map(({ receivedAt, telemetry: item }) => ({ time: receivedAt, suhu: item.t ?? null, daya: item.p ?? null, bat: item.bat?.soc ?? null, berat: item.wt?.g ?? null, pred: item.energy?.pred_wh ?? null, aktual: item.energy?.actual_wh ?? null, alarm: item.alarm ? 1 : 0 }))

  return <div className="app-shell">
    <header className="topbar">
      <a className="brand" href="#" onClick={(event) => { event.preventDefault(); setPage('overview') }}><span className="brand-mark"><Activity size={21} /></span><span><strong>I-Care</strong><small>INCUBATOR MONITOR</small></span></a>
      <nav className="main-nav" aria-label="Navigasi utama">
        {[['overview', 'Pemantauan'], ['analytics', 'Analitik'], ['events', 'Kejadian'], ['raw', 'Data mentah']].map(([key, title]) => <button key={key} className={page === key ? 'active' : ''} onClick={() => setPage(key as typeof page)}>{title}</button>)}
      </nav>
      <div className="top-actions">
        <button className={`source-toggle ${source === 'demo' ? 'demo' : ''}`} onClick={() => { const next = source === 'demo' ? 'mqtt' : 'demo'; dashboard.resetTelemetry(); setSource(next) }} title="Ganti sumber data"><span className="source-led" />{source === 'demo' ? 'MODE DEMO' : 'MQTT NYATA'}<ChevronDown size={13} /></button>
        <button className="icon-button theme-toggle" onClick={() => updateSettings({ theme: settings.theme === 'dark' ? 'light' : 'dark' })} aria-label="Ganti tema">{settings.theme === 'dark' ? <Sun size={17} /> : <Moon size={17} />}</button>
        <button className="icon-button" onClick={() => setShowSettings(true)} aria-label="Pengaturan"><Settings2 size={18} /></button>
      </div>
    </header>

    <main className="page-content">
      {source === 'demo' && <div className="demo-ribbon"><Activity size={14} /> SIMULASI PENELITIAN <span>Data sintetis; perintah hanya mengubah simulasi.</span></div>}
      <section className="page-heading">
        <div><div className="eyebrow">PEMANTAUAN INKUBATOR <span className="heading-slash">/</span> {settings.deviceId}</div><h1>{page === 'overview' ? 'Ruang kendali' : page === 'analytics' ? 'Analitik & evaluasi' : page === 'events' ? 'Log kejadian' : 'Data mentah'}</h1></div>
        <div className="heading-actions"><div className={`connection-chip ${connection}`}><span className="status-dot" />{connection === 'connected' ? source === 'demo' ? 'Simulasi aktif' : 'Broker terhubung' : connection === 'connecting' || connection === 'reconnecting' ? 'Menghubungkan' : connection === 'error' ? 'Broker bermasalah' : 'Broker terputus'}</div><button className="emergency-button" onClick={() => runCommand({ kind: 'estop', value: 1 })} disabled={!online && source !== 'demo'}><ShieldAlert size={16} /> EMERGENCY OFF</button></div>
      </section>

      <section className="status-strip">
        <div className={`device-state ${online ? 'is-online' : 'is-offline'}`}><span className="pulse-dot" /><span><b>{online ? 'ONLINE' : 'OFFLINE'}</b><small>{stale ? 'Data basi' : deviceStatus ?? 'Telemetry aktif'}</small></span></div>
        <div className="status-item"><Wifi size={15} /><span>RSSI</span><b>{fmt(telemetry?.rssi, 0)} <small>dBm</small></b></div>
        <div className="status-item"><Clock3 size={15} /><span>Uptime</span><b>{durationLabel(telemetry?.up)}</b></div>
        <div className="status-item"><RefreshCw size={14} /><span>Pesan terakhir</span><b>{staleLabel}</b></div>
        <div className="status-device"><span>ID PERANGKAT</span><select value={settings.deviceId} onChange={(event) => updateSettings({ deviceId: event.target.value })}>{settings.devices.map((id) => <option key={id}>{id}</option>)}</select></div>
      </section>

      {criticalAlarm && <section className="critical-banner"><AlertTriangle size={20} /><div><strong>ALARM KRITIS AKTIF</strong><span>{alarms.filter((alarm) => alarm.severity === 'critical').map((alarm) => alarm.label).join(' · ')}</span></div><button className="banner-close" onClick={() => setShowSettings(true)} aria-label="Pengaturan alarm"><Settings2 size={16} /></button></section>}

      {page === 'overview' && <>
        <div className="overview-grid">
          <div className="primary-column">
            <section className={`temperature-panel ${stale ? 'is-stale' : ''}`}>
              <div className="temperature-top"><div><div className="eyebrow">SUHU TERKENDALI <span className="live-dot" /></div><div className="temperature-value">{fmt(temperature, 2)}<span>°C</span></div><span className="stale-caption">{stale ? 'DATA BASI · menunggu telemetry terbaru' : `Diperbarui ${lastMessageAt ? timeLabel(lastMessageAt) : 'menunggu data'}`}</span></div>
                <div className="temp-side"><div className={`operation-badge ${controlStatus.toLowerCase().replaceAll(' ', '-')}`}><span />{controlStatus}</div><div className="algorithm-label">ALGORITMA <b>{telemetry?.mode?.toUpperCase() ?? '—'}</b></div></div></div>
              <div className="temperature-stats"><div><span>SETPOINT</span><strong>{fmt(target)} <small>°C</small></strong></div><div><span>GALAT</span><strong>{fmt(telemetry?.e, 2)} <small>°C</small></strong></div><div><span>DAYA PEMANAS</span><strong>{fmt(telemetry?.p, 0)} <small>%</small></strong></div><div className="heater-gauge"><div className="gauge-track"><span style={{ width: `${Math.min(100, Math.max(0, telemetry?.p ?? 0))}%` }} /></div><span><Heater size={13} /> Pemanas</span></div></div>
            </section>
            <section className="sensor-overview-grid">
              <section className="panel sensor-map-panel">
                <div className="panel-heading"><div className="panel-title"><Thermometer size={16} /><h3>Distribusi suhu</h3></div><span className="mini-label">TAMPAK ATAS</span></div>
                <div className="incubator-map"><div className="incubator-lid"><span className="lid-window" /><span className="lid-label">INKUBATOR</span></div>{ds ? ds.map((value, index) => {
                  const x = ds.length === 1 ? 50 : 18 + index * (64 / (ds.length - 1))
                  const y = index % 2 === 0 ? 34 : 67
                  const hue = typeof value === 'number' ? Math.min(120, Math.max(0, 120 - Math.abs(value - (target ?? value)) * 55)) : 0
                  return <div key={index} className={`sensor-point ${typeof value === 'number' ? '' : 'error'}`} style={{ left: `${x}%`, top: `${y}%`, '--sensor-hue': hue } as React.CSSProperties}><span>{typeof value === 'number' ? `DS${index + 1}` : 'ERR'}</span><b>{fmt(value)}°</b></div>
                }) : <div className="map-wait">Menunggu data dari perangkat</div>}</div>
                <div className="spread-line"><span>SEBARAN ANTARSENSOR</span><b>{fmt(sensorSpread, 2)} <small>°C</small></b><span>selisih maks–min</span></div>
              </section>
              <section className="sensor-stack">
                <section className="panel sht-card"><div className="panel-heading"><div className="panel-title"><Activity size={16} /><h3>SHT31</h3></div><span className="sensor-index">01</span></div><div className="sensor-readings"><div><span>SUHU</span><b>{telemetry?.sht === null ? 'Error' : fmt(telemetry?.sht)}<small>°C</small></b></div><div><span>KELEMBAPAN</span><b>{telemetry?.hum === null ? 'Error' : fmt(telemetry?.hum)}<small>%</small></b></div></div></section>
                <section className="panel ds-card"><div className="panel-heading"><div className="panel-title"><Thermometer size={16} /><h3>DS18B20</h3></div><span className="sensor-index">{ds?.length ?? '—'} SENSOR</span></div><div className="ds-list">{ds ? ds.map((value, index) => <div key={index} className="ds-row"><span className={`sensor-led ${typeof value !== 'number' ? 'error' : ''}`} />DS{index + 1}<b>{value === null ? 'Error' : fmt(value)}<small> °C</small></b></div>) : <div className="waiting-state compact">Menunggu data dari perangkat</div>}</div></section>
              </section>
            </section>
            <TemperatureChart samples={samplesWindow} windowKey={windowKey} setWindowKey={setWindowKey} />
          </div>

          <aside className="control-column">
            <section className={`panel control-panel ${unlocked ? 'unlocked' : ''}`}>
              <div className="panel-heading"><div><div className="eyebrow">KONTROL JARAK JAUH</div><h2>Kontrol</h2></div><span className={`lock-state ${unlocked ? 'open' : ''}`}>{unlocked ? <UnlockKeyhole size={15} /> : <LockKeyhole size={15} />}{unlocked ? 'Terbuka' : 'Terkunci'}</span></div>
              <div className="public-warning"><ShieldAlert size={15} /><span>Jangan gunakan kontrol di broker publik di luar uji coba.</span></div>
              {!unlocked ? <button className="unlock-button" disabled={!controlAllowed} onClick={() => setUnlockedUntil(Date.now() + 120000)}><UnlockKeyhole size={15} /> Buka kunci selama 2 menit</button> : <div className="unlock-countdown"><span>Kontrol terkunci otomatis</span><b>{Math.ceil((unlockedUntil - clock) / 1000)} dtk</b></div>}
              <div className={`control-fields ${!unlocked || !controlAllowed ? 'disabled' : ''}`}>
                <div className="field-heading"><label htmlFor="setpoint-input">SETPOINT</label><span>{controlMin.toFixed(1)}–{controlMax.toFixed(1)} °C</span></div>
                <div className="setpoint-editor"><input aria-label="Setpoint suhu" type="number" min={controlMin} max={controlMax} step="0.1" value={setpointDraft} disabled={!unlocked || !controlAllowed} onChange={(event) => setSetpointDraft(Number(event.target.value))} id="setpoint-input" /><span>°C</span></div>
                <input className="setpoint-slider" aria-label="Slider setpoint" type="range" min={controlMin} max={controlMax} step="0.1" value={setpointDraft} disabled={!unlocked || !controlAllowed} onChange={(event) => setSetpointDraft(Number(event.target.value))} />
                <div className="preset-row">{[32, 34, 36, 36.5, 37].filter((value) => value >= controlMin && value <= controlMax).map((value) => <button key={value} className={setpointDraft === value ? 'chosen' : ''} disabled={!unlocked || !controlAllowed} onClick={() => setSetpointDraft(value)}>{value.toFixed(value % 1 ? 1 : 0)}</button>)}</div>
                <button className="apply-button" disabled={!unlocked || !controlAllowed || setpointDraft < controlMin || setpointDraft > controlMax} onClick={applySetpoint}><Check size={16} /> Terapkan setpoint</button>
                <div className="field-heading mode-heading"><label>ALGORITMA</label><span>Dikonfirmasi via telemetry</span></div>
                <div className="mode-switch"><button className={telemetry?.mode === 'fuzzy' ? 'selected' : ''} disabled={!unlocked || !controlAllowed} onClick={() => runCommand({ kind: 'mode', value: 'fuzzy' })}>Fuzzy</button><button className={telemetry?.mode === 'pid' ? 'selected' : ''} disabled={!unlocked || !controlAllowed} onClick={() => runCommand({ kind: 'mode', value: 'pid' })}>PID</button></div>
              </div>
              {pending && <div className={`command-state ${pending.state}`}><span className="command-state-dot" />{pending.state === 'pending' ? 'Menunggu konfirmasi' : pending.state === 'confirmed' ? 'Perintah terkonfirmasi' : pending.state === 'unconfirmed' ? 'Tidak terkonfirmasi - pastikan kontrol jarak jauh aktif di firmware' : 'Perintah gagal dikirim'}</div>}
              {!controlAllowed && <div className="offline-notice"><Wifi size={14} />{online ? 'Kontrol broker publik terkunci. Aktifkan izin uji coba di Pengaturan.' : 'Kontrol nonaktif saat perangkat offline atau data basi.'}</div>}
              <button className="continue-button" disabled={!controlAllowed} onClick={() => setDialog({ title: 'Lanjutkan operasi?', message: 'Matikan emergency stop dan lanjutkan operasi perangkat?', action: () => { runCommand({ kind: 'estop', value: 0 }); setDialog(null) } })}>Lanjutkan operasi</button>
            </section>
            <section className="panel quick-stats"><div className="panel-heading"><div className="panel-title"><Gauge size={16} /><h3>Ringkasan sensor</h3></div><button className="info-button" title="Nilai mengikuti telemetry terakhir."><CircleHelp size={15} /></button></div><div className="quick-stat-row"><span>Kelembapan</span><b>{fmt(telemetry?.hum)} <small>% RH</small></b></div><div className="quick-stat-row"><span>Zero-cross</span><b>{fmt(telemetry?.zc, 0)} <small>Hz edge/s</small></b></div><div className="quick-stat-row"><span>Galat berubah</span><b>{fmt(telemetry?.de, 2)} <small>°C/menit</small></b></div></section>
            <section className="panel active-alarms"><div className="panel-heading"><div className="panel-title"><Bell size={16} /><h3>Alarm aktif</h3></div><span className={`count-pill ${alarms.length ? 'has-alarm' : ''}`}>{alarms.length}</span></div>{alarms.length ? alarms.map((alarm) => <div className={`alarm-row ${alarm.severity}`} key={alarm.bit}><span className="alarm-marker" /><div><b>{alarm.label}</b><small>BIT {alarm.bit} · {alarm.severity === 'critical' ? 'KRITIS' : 'PERINGATAN'}</small></div></div>) : <div className="all-clear"><Check size={15} />Tidak ada alarm aktif</div>}</section>
          </aside>
        </div>

        <section className="optional-section"><div className="section-heading"><div><div className="eyebrow">TELEMETRI LANJUTAN</div><h2>Energi & pemantauan pendukung</h2></div><span>Aktif otomatis saat field diterima</span></div>
          <div className="optional-grid">
            <WaitCard title="Baterai" icon={BatteryCharging} waiting={!optionalFieldPresent(telemetry, 'bat')}><div className="battery-content"><div className="soc-ring" style={{ '--soc': `${telemetry?.bat?.soc ?? 0}%` } as React.CSSProperties}><strong>{fmt(telemetry?.bat?.soc, 0)}<small>%</small></strong></div><div className="battery-values"><MetricTile label="TEGANGAN" value={fmt(telemetry?.bat?.v, 2)} unit="V" /><MetricTile label="ARUS" value={fmt(telemetry?.bat?.i, 2)} unit="A" hint={typeof telemetry?.bat?.i === 'number' ? telemetry.bat.i < 0 ? 'Mengisi' : 'Discharge' : undefined} /><MetricTile label="KAPASITAS" value={fmt(telemetry?.bat?.cap_ah, 1)} unit="Ah" /><MetricTile label="WAKTU TERSISA" value={durationLabel(telemetry?.bat?.runtime_min ? telemetry.bat.runtime_min * 60 : null)} /></div></div><MiniTrend data={samplesWindow} value={(sample) => sample.telemetry.bat?.soc} label="SoC" color="#77b8a4" />
            </WaitCard>
            <WaitCard title="Sumber daya & ATS" icon={PlugZap} waiting={!optionalFieldPresent(telemetry, 'grid')}><div className="grid-state"><div className={`grid-availability ${telemetry?.grid?.pln === false ? 'danger' : ''}`}><span className="grid-light" />{typeof telemetry?.grid?.pln !== 'boolean' ? '—' : telemetry.grid.pln ? 'PLN tersedia' : 'PLN padam'}</div><div className="grid-details"><MetricTile label="SUMBER AKTIF" value={telemetry?.grid?.src ?? '—'} /><MetricTile label="STATUS ATS" value={typeof telemetry?.grid?.ats_ok !== 'boolean' ? '—' : telemetry.grid.ats_ok ? 'Normal' : 'Bahaya'} hint={telemetry?.grid?.ats_ok === false ? 'Sumber tidak valid' : undefined} /></div></div></WaitCard>
            <WaitCard title="Listrik AC · PZEM" icon={Activity} waiting={!optionalFieldPresent(telemetry, 'pzem')}><div className="pzem-grid">{[['TEGANGAN', telemetry?.pzem?.v, 'V'], ['ARUS', telemetry?.pzem?.i, 'A'], ['DAYA AKTIF', telemetry?.pzem?.p, 'W'], ['POWER FACTOR', telemetry?.pzem?.pf, 'PF'], ['FREKUENSI', telemetry?.pzem?.hz, 'Hz'], ['ENERGI', telemetry?.pzem?.kwh, 'kWh']].map(([label, value, unit]) => <MetricTile key={String(label)} label={String(label)} value={fmt(value as number | null)} unit={String(unit)} />)}</div><MiniTrend data={samplesWindow} value={(sample) => sample.telemetry.pzem?.p} label="Daya aktif" color="#e7a958" /></WaitCard>
            <WaitCard title="Prediksi energi" icon={Activity} waiting={!optionalFieldPresent(telemetry, 'energy')}><div className="metric-grid two"><MetricTile label="PREDIKSI MAE" value={fmt(energyMetrics.mae, 2)} unit="Wh" /><MetricTile label="RMSE" value={fmt(energyMetrics.rmse, 2)} unit="Wh" /><MetricTile label="PASANGAN DATA" value={String(energyMetrics.count)} /><MetricTile label="WINDOW" value={windowKey === 'all' ? 'Semua' : windowKey} /></div><EnergyMiniTrend data={samplesWindow} /></WaitCard>
            <WaitCard title="Berat" icon={Activity} waiting={!optionalFieldPresent(telemetry, 'wt')}><div className="weight-value">{fmt(telemetry?.wt?.g, 0)} <small>gram</small></div><p className="clinical-note">Pendukung pemantauan, bukan diagnosis.</p><WeightTrend data={samplesWindow} /></WaitCard>
            <WaitCard title="Fototerapi" icon={Sun} waiting={!optionalFieldPresent(telemetry, 'photo')}><div className={`photo-status ${telemetry?.photo?.on ? 'on' : ''}`}><span />{telemetry?.photo?.on ? 'Sesi aktif' : 'Tidak aktif'}</div><div className="photo-metrics"><MetricTile label="DURASI SESI" value={durationLabel(telemetry?.photo?.sec)} /><MetricTile label="INTENSITAS" value={fmt(telemetry?.photo?.lux, 0)} unit="lux" /></div><div className="photo-history">{events.filter((event) => event.type === 'photo').slice(-2).reverse().map((event, index) => <div key={`${event.at}-${index}`}><time>{timeLabel(event.at)}</time><span>{event.message}</span></div>)}</div><p className="clinical-note warning-note">Lux BH1750 bukan irradiansi terapeutik. Gunakan radiometer terkalibrasi.</p></WaitCard>
            <WaitCard title="Kamera" icon={Camera} waiting={!optionalFieldPresent(telemetry, 'cam') && !settings.cameraUrl} className="camera-card">{cameraUrl ? <CameraView url={cameraUrl} /> : <div className="waiting-state">Menunggu URL kamera</div>}<p className="clinical-note">Bukan alat diagnosis medis.</p></WaitCard>
          </div>
        </section>
      </>}

      {page === 'analytics' && <section className="analytics-page">
        <div className="analytics-toolbar"><div><div className="eyebrow">EVALUASI KINERJA SUHU</div><h2>Ringkasan metrik <span className="help-tip" title="MAE = rata-rata |T−SP|. RMSE = akar rata-rata (T−SP)². Steady-state error = rata-rata T−SP."><Info size={14} /></span></h2></div><div className="segmented">{['5m', '30m', '2h', 'all'].map((key) => <button key={key} className={windowKey === key ? 'selected' : ''} onClick={() => setWindowKey(key)}>{key === 'all' ? 'Semua' : key}</button>)}</div></div>
        <div className="metrics-grid">{[
          ['Jumlah sampel', String(metrics.count), ''], ['Rata-rata suhu', fmt(metrics.average, 2), '°C'], ['Simpangan baku', fmt(metrics.standardDeviation, 3), '°C'], ['Steady-state error', fmt(metrics.steadyStateError, 3), '°C'], ['MAE', fmt(metrics.mae, 3), '°C'], ['RMSE', fmt(metrics.rmse, 3), '°C'], ['Deviasi puncak', fmt(metrics.peakDeviation, 2), '°C'], ['Dalam ±0,5 °C', fmt(metrics.withinHalfDegree, 1), '%'], ['Dalam ±0,25 °C', fmt(metrics.withinQuarterDegree, 1), '%'], ['Sebaran sensor maks.', fmt(metrics.maxSensorSpread, 2), '°C'], ['Overshoot (Tpeak−SP)', fmt(metrics.overshoot, 2), '°C'], ['Settling time', durationLabel(metrics.settlingTimeSeconds), ''],
        ].map(([label, value, unit]) => <MetricTile key={label} label={label} value={value} unit={unit} />)}</div>
        <div className="panel analytics-chart"><div className="panel-heading"><div><div className="eyebrow">LINIMASA TERPADU</div><h2>Suhu, daya, baterai, berat & energi</h2></div><span className="mini-label">{samplesWindow.length} TITIK</span></div><IntegratedChart data={chartData} /></div>
        <div className="panel session-panel"><div className="panel-heading"><div><div className="eyebrow">REKAMAN PENELITIAN</div><h2>Sesi pengujian</h2></div>{recording ? <button className="stop-recording" onClick={() => void stopSession()}>Berhenti merekam</button> : <div className="record-form"><input aria-label="Nama sesi" value={sessionName} onChange={(event) => setSessionName(event.target.value)} /><button className="primary-button" onClick={() => void startSession()}><span className="record-dot" /> Mulai sesi</button></div>}</div>
          {recording && <div className="recording-status"><span className="record-dot" /> Merekam “{recording.name}” · {recording.samples.length} sampel · mulai {timeLabel(recording.startedAt)}</div>}
          {sessions.length === 0 ? <div className="empty-list">Belum ada sesi tersimpan. Mulai perekaman untuk menyimpan telemetry di browser.</div> : <div className="session-list">{sessions.map((session, index) => <div className="session-row" key={session.id ?? `${session.startedAt}-${index}`}><label className="compare-checkbox"><input type="checkbox" checked={session.id !== undefined && compareIds.includes(session.id)} onChange={(event) => setCompareIds((current) => event.target.checked ? [...current, session.id!].slice(-2) : current.filter((id) => id !== session.id))} /><span /></label><div className="session-name"><b>{session.name}</b><small>{new Date(session.startedAt).toLocaleString('id-ID')} · {session.samples.length} sampel</small></div><button className="small-button" onClick={() => setOpenedSession(session)}>Buka</button><button className="icon-button small-icon" title="Ekspor CSV" onClick={() => sessionExport(session, 'csv')}><Download size={15} /></button><button className="icon-button small-icon" title="Ekspor JSON" onClick={() => sessionExport(session, 'json')}><FileText size={15} /></button></div>)}</div>}
          {comparedSessions.length === 2 && <div className="session-comparison"><div className="eyebrow">PERBANDINGAN SESI</div><div className="comparison-grid"><span>Metrik</span><b>{comparedSessions[0].name}</b><b>{comparedSessions[1].name}</b>{(['count', 'average', 'mae', 'rmse', 'peakDeviation', 'withinHalfDegree'] as const).flatMap((key) => { const left = calculateTemperatureMetrics(comparedSessions[0].samples)[key]; const right = calculateTemperatureMetrics(comparedSessions[1].samples)[key]; return [<span key={`${key}-label`}>{key}</span>, <span key={`${key}-left`}>{typeof left === 'number' ? fmt(left, 2) : '—'}</span>, <span key={`${key}-right`}>{typeof right === 'number' ? fmt(right, 2) : '—'}</span>] })}</div></div>}
          <div className="report-row"><p>Laporan mencakup parameter uji, metrik, dan grafik untuk dicetak atau disimpan sebagai PDF.</p><button className="secondary-button" onClick={exportReport}><FileText size={15} /> Cetak / PDF</button></div>
        </div>
      </section>}

      {page === 'events' && <section className="panel event-page"><div className="panel-heading"><div><div className="eyebrow">AUDIT LOKAL · INDEXEDDB</div><h2>Log kejadian</h2></div><div className="event-actions"><select value={eventFilter} onChange={(event) => setEventFilter(event.target.value)}><option value="semua">Semua tipe</option>{['alarm', 'status', 'setpoint', 'mode', 'grid', 'power', 'photo', 'control', 'session'].map((value) => <option key={value} value={value}>{value}</option>)}</select><button className="secondary-button" onClick={() => downloadFile('icare-kejadian.json', JSON.stringify(visibleEvents, null, 2), 'application/json')}><Download size={15} /> Ekspor</button></div></div>{visibleEvents.length ? <div className="event-list">{[...visibleEvents].reverse().map((event, index) => <div className="event-row" key={event.id ?? `${event.at}-${index}`}><span className={`event-marker ${event.type}`} /><time>{new Date(event.at).toLocaleString('id-ID')}</time><span className="event-type">{event.type}</span><p>{event.message}</p></div>)}</div> : <div className="empty-list">Belum ada kejadian. Aktivitas perangkat akan tercatat di sini.</div>}</section>}

      {page === 'raw' && <section className="raw-grid"><section className="panel raw-panel"><div className="panel-heading"><div><div className="eyebrow">TELEMETRI TERAKHIR</div><h2>JSON perangkat</h2></div><button className="icon-button" title="Salin JSON" onClick={() => { if (telemetry) void navigator.clipboard.writeText(JSON.stringify(telemetry, null, 2)) }}><Download size={15} /></button></div><pre>{telemetry ? JSON.stringify(telemetry, null, 2) : 'Menunggu data dari perangkat'}</pre></section><section className="panel raw-panel"><div className="panel-heading"><div><div className="eyebrow">MQTT / SIMULASI</div><h2>Log pesan</h2></div><span className="mini-label">{messageLog.length} PESAN</span></div><div className="message-list">{messageLog.length ? messageLog.map((item, index) => <div className="message-row" key={`${item.at}-${index}`}><time>{timeLabel(item.at)}</time><span className={`event-type ${item.kind}`}>{item.kind}</span><code>{item.text}</code></div>) : <div className="empty-list">Belum ada pesan diterima.</div>}</div></section><section className="panel raw-panel extra-fields"><div className="panel-heading"><div><div className="eyebrow">KOMPATIBILITAS</div><h2>Field telemetry</h2></div><Info size={16} /></div><div className="field-chips">{telemetry ? Object.keys(telemetry).map((key) => <span key={key}>{key}</span>) : 'Menunggu data dari perangkat'}</div><p>Field yang belum dikenal tetap tersedia di JSON mentah dan sesi ekspor; payload JSON tidak valid diabaikan dan dicatat di log.</p></section></section>}

      <footer className="app-footer"><span>Prototipe penelitian - bukan alat medis tersertifikasi</span><span>I-Care · MQTT Contract v2</span></footer>
    </main>

    {dialog && <div className="modal-backdrop"><section className="modal confirm-modal"><div className="modal-heading"><div><div className="eyebrow">TINDAKAN KONTROL</div><h2>{dialog.title}</h2></div><button className="icon-button" onClick={() => setDialog(null)} aria-label="Tutup"><X size={18} /></button></div><p>{dialog.message}</p><div className="modal-actions"><button className="secondary-button" onClick={() => setDialog(null)}>Batal</button><button className="primary-button" onClick={dialog.action}>Konfirmasi</button></div></section></div>}
    {showSettings && <SettingsDialog settings={settings} updateSettings={updateSettings} close={() => setShowSettings(false)} />}
    {openedSession && <div className="modal-backdrop"><section className="modal session-modal"><div className="modal-heading"><div><div className="eyebrow">SESI TERSIMPAN</div><h2>{openedSession.name}</h2></div><button className="icon-button" onClick={() => setOpenedSession(null)} aria-label="Tutup"><X size={18} /></button></div><div className="metrics-grid compact-metrics">{Object.entries(calculateTemperatureMetrics(openedSession.samples)).filter(([key]) => ['count', 'average', 'mae', 'rmse', 'peakDeviation', 'withinHalfDegree', 'maxSensorSpread'].includes(key)).map(([key, value]) => <MetricTile key={key} label={key} value={typeof value === 'number' ? fmt(value, 2) : '—'} />)}</div><div className="modal-actions"><button className="secondary-button" onClick={() => sessionExport(openedSession, 'csv')}><Download size={15} /> CSV</button><button className="secondary-button" onClick={() => sessionExport(openedSession, 'json')}><FileText size={15} /> JSON</button><button className="primary-button" onClick={() => setOpenedSession(null)}>Selesai</button></div></section></div>}
  </div>
}

function MiniTrend({ data, value, label, color }: { data: Sample[]; value: (sample: Sample) => number | null | undefined; label: string; color: string }) {
  const points = data.slice(-80).map((sample) => ({ time: sample.receivedAt, value: value(sample) ?? null }))
  return <div className="mini-trend"><ResponsiveContainer width="100%" height="100%"><LineChart data={points}><Tooltip labelFormatter={(time) => timeLabel(Number(time))} formatter={(item) => [item ?? '—', label]} contentStyle={{ background: 'var(--panel-raised)', border: '1px solid var(--border)', borderRadius: 4, fontSize: 11 }} /><Line type="monotone" dataKey="value" stroke={color} strokeWidth={1.7} dot={false} connectNulls isAnimationActive={false} /></LineChart></ResponsiveContainer></div>
}

function EnergyMiniTrend({ data }: { data: Sample[] }) {
  const points = data.slice(-80).map(({ receivedAt, telemetry }) => ({ time: receivedAt, predicted: telemetry.energy?.pred_wh ?? null, actual: telemetry.energy?.actual_wh ?? null }))
  return <div className="mini-trend"><ResponsiveContainer width="100%" height="100%"><LineChart data={points}><Tooltip labelFormatter={(time) => timeLabel(Number(time))} contentStyle={{ background: 'var(--panel-raised)', border: '1px solid var(--border)', borderRadius: 4, fontSize: 11 }} /><Line type="monotone" dataKey="predicted" name="Prediksi Wh" stroke="#8ba8ed" strokeWidth={1.6} dot={false} connectNulls isAnimationActive={false} /><Line type="monotone" dataKey="actual" name="Aktual Wh" stroke="#e7a958" strokeWidth={1.6} dot={false} connectNulls isAnimationActive={false} /></LineChart></ResponsiveContainer></div>
}

function IntegratedChart({ data }: { data: Array<Record<string, number | null>> }) {
  return <div className="integrated-chart"><ResponsiveContainer width="100%" height="100%"><ComposedChart data={data} syncId="timeline" margin={{ top: 12, right: 12, bottom: 0, left: 0 }}><CartesianGrid strokeDasharray="3 5" vertical={false} stroke="var(--grid)" /><XAxis dataKey="time" type="number" domain={['dataMin', 'dataMax']} tickFormatter={timeLabel} tick={{ fill: 'var(--muted)', fontSize: 10 }} axisLine={false} tickLine={false} minTickGap={45} /><YAxis yAxisId="left" tick={{ fill: 'var(--muted)', fontSize: 10 }} axisLine={false} tickLine={false} width={42} /><YAxis yAxisId="right" orientation="right" tick={{ fill: 'var(--muted)', fontSize: 10 }} axisLine={false} tickLine={false} width={42} /><Tooltip labelFormatter={(time) => timeLabel(Number(time))} contentStyle={{ background: 'var(--panel-raised)', border: '1px solid var(--border)', borderRadius: 4 }} /><Legend /><Line yAxisId="left" dataKey="suhu" name="Suhu °C" stroke="#e7a958" dot={false} isAnimationActive={false} /><Line yAxisId="left" dataKey="daya" name="Pemanas %" stroke="#df7c71" dot={false} isAnimationActive={false} /><Line yAxisId="right" dataKey="bat" name="Baterai %" stroke="#6bb5a7" dot={false} isAnimationActive={false} /><Line yAxisId="right" dataKey="berat" name="Berat g" stroke="#8ba8ed" dot={false} isAnimationActive={false} /><Line yAxisId="left" dataKey="pred" name="Energi prediksi Wh" stroke="#c190d5" dot={false} isAnimationActive={false} /><Line yAxisId="left" dataKey="aktual" name="Energi aktual Wh" stroke="#d8c86d" dot={false} isAnimationActive={false} /><Line yAxisId="right" type="stepAfter" dataKey="alarm" name="Alarm aktif" stroke="#e7796d" dot={false} isAnimationActive={false} /></ComposedChart></ResponsiveContainer></div>
}

function WeightTrend({ data }: { data: Sample[] }) {
  const [windowSize, setWindowSize] = useState(5)
  const points = data.flatMap(({ receivedAt, telemetry }) => typeof telemetry.wt?.g === 'number' ? [{ time: receivedAt, grams: telemetry.wt.g }] : [])
  const chartData = points.map((point, index) => {
    const window = points.slice(Math.max(0, index - windowSize + 1), index + 1)
    return { ...point, average: window.reduce((sum, item) => sum + item.grams, 0) / window.length }
  })
  const first = points[0]
  const last = points.at(-1)
  const days = first && last ? (last.time - first.time) / 86_400_000 : 0
  const dailyChange = days > 0 ? (last!.grams - first!.grams) / days : null
  const mean = points.length ? points.reduce((sum, point) => sum + point.grams, 0) / points.length : 0
  const deviation = points.length > 1 ? Math.sqrt(points.reduce((sum, point) => sum + (point.grams - mean) ** 2, 0) / points.length) : 0
  const anomalies = chartData.filter((point) => Math.abs(point.grams - point.average) > Math.max(20, deviation * 2.5)).map((point) => ({ ...point, anomaly: point.grams }))
  return <>
    <div className="weight-controls"><label>Rata-rata bergerak<select value={windowSize} onChange={(event) => setWindowSize(Number(event.target.value))}><option value={1}>1 sampel</option><option value={5}>5 sampel</option><option value={10}>10 sampel</option></select></label><span>Perubahan <b>{fmt(dailyChange, 1)} g/hari</b></span></div>
    {points.length > 1 ? <div className="weight-chart"><ResponsiveContainer width="100%" height="100%"><ComposedChart data={chartData}><XAxis dataKey="time" type="number" domain={['dataMin', 'dataMax']} tickFormatter={timeLabel} hide /><YAxis domain={['auto', 'auto']} hide /><Tooltip labelFormatter={(time) => timeLabel(Number(time))} contentStyle={{ background: 'var(--panel-raised)', border: '1px solid var(--border)', borderRadius: 4, fontSize: 10 }} /><Line type="monotone" dataKey="grams" name="Berat (g)" stroke="#7385a9" strokeWidth={1} strokeOpacity={0.45} dot={false} isAnimationActive={false} /><Line type="monotone" dataKey="average" name={`Rata-rata ${windowSize}`} stroke="#6bb5a7" strokeWidth={1.8} dot={false} isAnimationActive={false} /><Scatter data={anomalies} dataKey="anomaly" name="Lonjakan tidak wajar" fill="#e7796d" isAnimationActive={false} /></ComposedChart></ResponsiveContainer></div> : <div className="weight-chart-empty">Menunggu data tren berat</div>}
    {anomalies.length > 0 && <span className="anomaly-note">Terdeteksi {anomalies.length} titik di luar pola lokal</span>}
  </>
}

function CameraView({ url }: { url: string }) {
  const [failed, setFailed] = useState(false)
  useEffect(() => setFailed(false), [url])
  return <div className="camera-view">{failed ? <div className="camera-failed"><Camera size={24} /><b>Stream tidak dapat dimuat</b><span>Periksa URL kamera dan akses jaringan.</span></div> : <img src={url} alt="Stream kamera inkubator" onError={() => setFailed(true)} />}</div>
}

export default App
