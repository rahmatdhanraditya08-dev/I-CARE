import { useCallback, useEffect, useRef, useState } from 'react'
import mqtt, { type MqttClient } from 'mqtt'
import type { Command, IcareTelemetry, Sample } from './domain'
import { decodeAlarms, isCommandConfirmed, isPublicBroker, parseTelemetry } from './domain'
import { listEvents, saveEvent, type EventRecord } from './persistence'

export interface DashboardSettings {
  brokerUrl: string
  username: string
  password: string
  deviceId: string
  devices: string[]
  cameraUrl: string
  minSetpoint: number
  maxSetpoint: number
  alarmSound: boolean
  alarmThreshold: number
  allowPublicControl: boolean
  theme: 'dark' | 'light'
}

const DEFAULT_SETTINGS: DashboardSettings = {
  brokerUrl: 'wss://broker.hivemq.com:8884/mqtt',
  username: '',
  password: '',
  deviceId: 'icare-radit-7391',
  devices: ['icare-radit-7391'],
  cameraUrl: '',
  minSetpoint: 30,
  maxSetpoint: 37.5,
  alarmSound: false,
  alarmThreshold: 1,
  allowPublicControl: false,
  theme: 'dark',
}

function readSettings(): DashboardSettings {
  try {
    const stored = localStorage.getItem('icare-settings')
    return stored ? { ...DEFAULT_SETTINGS, ...JSON.parse(stored) as Partial<DashboardSettings> } : DEFAULT_SETTINGS
  } catch {
    return DEFAULT_SETTINGS
  }
}

export type SourceMode = 'demo' | 'mqtt'
export type LinkState = 'disconnected' | 'connecting' | 'connected' | 'reconnecting' | 'error'
export interface PendingCommand {
  command: Command
  state: 'pending' | 'confirmed' | 'unconfirmed' | 'error'
  sentAt: number
}

export function useDashboard() {
  const [settings, setSettings] = useState<DashboardSettings>(readSettings)
  const [source, setSource] = useState<SourceMode>('demo')
  const [connection, setConnection] = useState<LinkState>('disconnected')
  const [telemetry, setTelemetry] = useState<IcareTelemetry | null>(null)
  const [samples, setSamples] = useState<Sample[]>([])
  const [lastMessageAt, setLastMessageAt] = useState<number | null>(null)
  const [deviceStatus, setDeviceStatus] = useState<string | null>(null)
  const [now, setNow] = useState(Date.now())
  const [events, setEvents] = useState<EventRecord[]>([])
  const [pending, setPending] = useState<PendingCommand | null>(null)
  const [messageLog, setMessageLog] = useState<Array<{ at: number; text: string; kind: string }>>([])
  const clientRef = useRef<MqttClient | null>(null)
  const pendingRef = useRef<PendingCommand | null>(null)
  const previousRef = useRef<IcareTelemetry | null>(null)
  const lastCommandAt = useRef(0)
  const outageStartedAt = useRef<number | null>(null)
  const simRef = useRef({ temperature: 27, setpoint: 36.5, mode: 'fuzzy', emergency: false, tick: 0, soc: 83, outage: false })

  const addEvent = useCallback((type: string, message: string, at = Date.now()) => {
    const event = { at, type, message }
    setEvents((current) => [...current, event].slice(-1500))
    void saveEvent(event).catch(() => undefined)
  }, [])

  const acceptTelemetry = useCallback((next: IcareTelemetry, at = Date.now()) => {
    const previous = previousRef.current
    const currentPending = pendingRef.current
    setTelemetry(next)
    setLastMessageAt(at)
    setSamples((current) => [...current, { receivedAt: at, telemetry: next }].slice(-100000))
    if (currentPending?.state === 'pending' && isCommandConfirmed(currentPending.command, next)) {
      const confirmed = { ...currentPending, state: 'confirmed' as const }
      pendingRef.current = confirmed
      setPending(confirmed)
      addEvent('control', `Perintah ${currentPending.command.kind} terkonfirmasi dari telemetry`)
    }
    if (previous) {
      const oldAlarm = previous.alarm ?? 0
      const newAlarm = next.alarm ?? 0
      if (oldAlarm !== newAlarm) {
        const oldBits = new Set(decodeAlarms(oldAlarm).map((alarm) => alarm.bit))
        const newBits = new Set(decodeAlarms(newAlarm).map((alarm) => alarm.bit))
        for (const alarm of decodeAlarms(newAlarm)) if (!oldBits.has(alarm.bit)) addEvent('alarm', `Alarm muncul: ${alarm.label}`, at)
        for (const alarm of decodeAlarms(oldAlarm)) if (!newBits.has(alarm.bit)) addEvent('alarm', `Alarm hilang: ${alarm.label}`, at)
      }
      if (typeof previous.sp === 'number' && typeof next.sp === 'number' && previous.sp !== next.sp) addEvent('setpoint', `Setpoint berubah ${previous.sp.toFixed(1)} → ${next.sp.toFixed(1)} °C`, at)
      if (previous.mode && next.mode && previous.mode !== next.mode) addEvent('mode', `Mode berubah ${previous.mode} → ${next.mode}`, at)
      if (previous.grid?.pln !== next.grid?.pln && typeof next.grid?.pln === 'boolean') {
        if (next.grid.pln) {
          const duration = outageStartedAt.current === null ? null : Math.round((at - outageStartedAt.current) / 1000)
          addEvent('grid', duration === null ? 'PLN pulih' : `PLN pulih setelah ${Math.floor(duration / 60)} menit ${duration % 60} detik`, at)
          outageStartedAt.current = null
        } else {
          outageStartedAt.current = at
          addEvent('grid', 'PLN padam', at)
        }
      }
      if (previous.grid?.src && next.grid?.src && previous.grid.src !== next.grid.src) addEvent('power', `Sumber daya berpindah ${previous.grid.src} → ${next.grid.src}`, at)
      if (previous.photo?.on !== next.photo?.on && typeof next.photo?.on === 'boolean') {
        addEvent('photo', next.photo.on ? 'Sesi fototerapi dimulai' : `Sesi fototerapi selesai (${next.photo.sec ?? 0} detik)`, at)
      }
    }
    previousRef.current = next
    setMessageLog((current) => [{ at, text: JSON.stringify(next), kind: 'telemetry' }, ...current].slice(0, 40))
  }, [addEvent])

  useEffect(() => { pendingRef.current = pending }, [pending])

  useEffect(() => {
    localStorage.setItem('icare-settings', JSON.stringify(settings))
    document.documentElement.dataset.theme = settings.theme
  }, [settings])

  useEffect(() => {
    previousRef.current = null
    setTelemetry(null)
    setSamples([])
    setLastMessageAt(null)
    setDeviceStatus(null)
    setPending(null)
    pendingRef.current = null
  }, [settings.deviceId])

  useEffect(() => {
    let active = true
    void listEvents().then((items) => { if (active) setEvents(items.sort((a, b) => a.at - b.at).slice(-1500)) }).catch(() => undefined)
    return () => { active = false }
  }, [])

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    if (source !== 'demo') return
    setConnection('connected')
    setDeviceStatus('online')
    const initial = simRef.current
    initial.setpoint = telemetry?.sp ?? 36.5
    const timer = window.setInterval(() => {
      const sim = simRef.current
      sim.tick += 1
      sim.outage = sim.tick % 115 >= 58 && sim.tick % 115 < 72
      sim.temperature += (sim.setpoint - sim.temperature) * 0.045 + (Math.random() - 0.5) * 0.09
      sim.temperature = Math.max(26.5, Math.min(38.4, sim.temperature))
      if (sim.outage) sim.soc = Math.max(18, sim.soc - 0.018)
      else sim.soc = Math.min(96, sim.soc + 0.004)
      const sensorOffset = (index: number) => Math.sin(sim.tick / 8 + index * 1.5) * 0.14 + (Math.random() - 0.5) * 0.06
      const temperature = Number(sim.temperature.toFixed(2))
      const isPhoto = sim.tick % 160 > 85 && sim.tick % 160 < 145
      const alarm = sim.emergency ? 1 : (sim.tick % 83 === 0 ? 16 : 0) | (sim.outage ? 128 : 0)
      const next: IcareTelemetry = {
        id: settings.deviceId, up: sim.tick * 2, t: temperature, sp: sim.setpoint,
        ds: [0, 1, 2, 3].map((index) => Number((temperature + sensorOffset(index)).toFixed(2))),
        sht: Number((temperature - 0.16).toFixed(2)), hum: Number((67 + Math.sin(sim.tick / 9) * 2.8).toFixed(1)),
        p: sim.outage ? 0 : Number(Math.min(100, Math.max(0, (sim.setpoint - temperature) * 28)).toFixed(0)),
        mode: sim.mode, e: Number((sim.setpoint - temperature).toFixed(2)), de: Number((Math.sin(sim.tick / 7) * 0.06).toFixed(2)),
        zc: sim.outage ? 0 : 100, alarm, rssi: -58 - Math.round(Math.abs(Math.sin(sim.tick / 11)) * 18),
        bat: { v: Number((12.7 + sim.soc * 0.012).toFixed(2)), i: sim.outage ? 1.2 : -0.18, soc: Number(sim.soc.toFixed(1)), runtime_min: Math.round(sim.soc * 4.1), cap_ah: 11 },
        grid: { pln: !sim.outage, src: sim.outage ? 'BAT' : 'PLN', ats_ok: true },
        pzem: { v: sim.outage ? null : 220.8, i: sim.outage ? null : 0.34, p: sim.outage ? null : 72.5, pf: 0.98, hz: 50, kwh: Number((0.412 + sim.tick * 0.00006).toFixed(3)) },
        energy: { pred_wh: Number((37 + Math.sin(sim.tick / 10) * 2).toFixed(1)), actual_wh: Number((36.9 + Math.cos(sim.tick / 8) * 2.2).toFixed(1)) },
        wt: { g: Number((2480 + sim.tick * 0.0007 + Math.sin(sim.tick / 180) * 0.08 + (sim.tick % 250 === 0 ? 45 : 0)).toFixed(1)) },
        photo: { on: isPhoto, sec: isPhoto ? sim.tick % 160 * 2 : 0, lux: isPhoto ? 4300 + Math.round(Math.sin(sim.tick / 3) * 180) : 0 },
      }
      acceptTelemetry(next)
    }, 2000)
    return () => window.clearInterval(timer)
  }, [source, settings.deviceId, acceptTelemetry])

  useEffect(() => {
    if (source !== 'mqtt') {
      clientRef.current?.end(true)
      clientRef.current = null
      if (source !== 'demo') setConnection('disconnected')
      return
    }
    setConnection('connecting')
    setDeviceStatus(null)
    const client = mqtt.connect(settings.brokerUrl, {
      username: settings.username || undefined,
      password: settings.password || undefined,
      reconnectPeriod: 3000,
      connectTimeout: 10000,
      clean: true,
      clientId: `icare-web-${Math.random().toString(16).slice(2, 10)}`,
    })
    clientRef.current = client
    client.on('connect', () => {
      setConnection('connected')
      const base = `icare/${settings.deviceId}`
      client.subscribe(`${base}/telemetry`, { qos: 0 })
      client.subscribe(`${base}/status`, { qos: 1 })
      setMessageLog((current) => [{ at: Date.now(), text: 'Terhubung dan berlangganan telemetry/status', kind: 'connection' }, ...current].slice(0, 40))
    })
    client.on('reconnect', () => setConnection('reconnecting'))
    client.on('offline', () => setConnection('disconnected'))
    client.on('error', () => setConnection('error'))
    client.on('message', (topic, payload) => {
      const base = `icare/${settings.deviceId}/`
      if (topic === `${base}status`) {
        const status = payload.toString()
        setDeviceStatus(status)
        setMessageLog((current) => [{ at: Date.now(), text: status, kind: 'status' }, ...current].slice(0, 40))
      }
      if (topic === `${base}telemetry`) {
        const value = parseTelemetry(payload)
        if (value && value.id === settings.deviceId) acceptTelemetry(value)
        else setMessageLog((current) => [{ at: Date.now(), text: payload.toString().slice(0, 300), kind: 'invalid' }, ...current].slice(0, 40))
      }
    })
    return () => {
      client.end(true)
      if (clientRef.current === client) clientRef.current = null
    }
  }, [source, settings.brokerUrl, settings.username, settings.password, settings.deviceId, acceptTelemetry])

  useEffect(() => {
    if (pending?.state !== 'pending') return
    const remaining = Math.max(0, pending.sentAt + 10000 - Date.now())
    const timer = window.setTimeout(() => setPending((current) => current?.sentAt === pending.sentAt ? { ...current, state: 'unconfirmed' } : current), remaining)
    return () => window.clearTimeout(timer)
  }, [pending])

  const stale = deviceStatus === 'offline' || lastMessageAt === null || now - lastMessageAt > 10000
  const online = !stale && connection === 'connected'
  const publicBroker = isPublicBroker(settings.brokerUrl)
  const controlTelemetryReady = typeof telemetry?.t === 'number' && typeof telemetry.sp === 'number'
  const controlAllowed = source === 'demo' || (online && controlTelemetryReady && (!publicBroker || settings.allowPublicControl))

  const updateSettings = useCallback((patch: Partial<DashboardSettings>) => {
    setSettings((current) => {
      const next = { ...current, ...patch }
      if (patch.deviceId && !next.devices.includes(patch.deviceId)) next.devices = [...next.devices, patch.deviceId]
      return next
    })
  }, [])

  const sendCommand = useCallback((command: Command): { ok: boolean; message?: string } => {
    const nowSent = Date.now()
    if (nowSent - lastCommandAt.current < 1000) return { ok: false, message: 'Tunggu satu detik sebelum mengirim perintah berikutnya.' }
    if (source === 'mqtt' && (!online || stale || !controlTelemetryReady)) return { ok: false, message: 'Perangkat offline, data basi, atau field suhu/setpoint belum valid.' }
    if (source === 'mqtt' && publicBroker && !settings.allowPublicControl) return { ok: false, message: 'Kontrol di broker publik terkunci. Aktifkan izin uji coba di Pengaturan hanya untuk pengujian.' }
    lastCommandAt.current = nowSent
    const topic = `icare/${settings.deviceId}/cmd/${command.kind}`
    const payload = command.kind === 'setpoint' ? command.value.toFixed(1) : command.kind === 'mode' ? command.value : String(command.value)
    const nextPending = { command, state: 'pending' as const, sentAt: nowSent }
    pendingRef.current = nextPending
    setPending(nextPending)
    addEvent('control', `Perintah ${command.kind} dikirim oleh operator web: ${payload}`)
    if (source === 'demo') {
      const sim = simRef.current
      if (command.kind === 'setpoint') sim.setpoint = command.value
      if (command.kind === 'mode') sim.mode = command.value
      if (command.kind === 'estop') sim.emergency = command.value === 1
      return { ok: true }
    }
    const client = clientRef.current
    if (!client?.connected) {
      setPending((current) => {
        const next = current ? { ...current, state: 'error' as const } : current
        pendingRef.current = next
        return next
      })
      return { ok: false, message: 'Koneksi broker belum siap.' }
    }
    client.publish(topic, payload, { qos: 1, retain: false }, (error) => {
      if (error) setPending((current) => {
        const next = current ? { ...current, state: 'error' as const } : current
        pendingRef.current = next
        return next
      })
    })
    return { ok: true }
  }, [addEvent, controlTelemetryReady, online, settings.allowPublicControl, settings.brokerUrl, settings.deviceId, source, stale])

  const resetTelemetry = useCallback(() => {
    previousRef.current = null
    setTelemetry(null)
    setSamples([])
    setLastMessageAt(null)
    setPending(null)
  }, [])

  return {
    settings, updateSettings, source, setSource, connection, telemetry, samples, lastMessageAt,
    deviceStatus, stale, online, controlAllowed, now, events, addEvent, pending, sendCommand, messageLog, resetTelemetry,
  }
}
