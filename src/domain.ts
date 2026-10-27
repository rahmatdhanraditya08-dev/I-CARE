export type Numeric = number | null | undefined

export interface BatteryTelemetry {
  v?: Numeric
  i?: Numeric
  soc?: Numeric
  runtime_min?: Numeric
  cap_ah?: Numeric
}

export interface GridTelemetry {
  pln?: boolean | null
  src?: 'PLN' | 'BAT' | 'NONE' | string | null
  ats_ok?: boolean | null
}

export interface PzemTelemetry {
  v?: Numeric
  i?: Numeric
  p?: Numeric
  pf?: Numeric
  hz?: Numeric
  kwh?: Numeric
}

export interface IcareTelemetry {
  id?: string
  up?: Numeric
  t?: Numeric
  sp?: Numeric
  ds?: Array<Numeric>
  sht?: Numeric
  hum?: Numeric
  p?: Numeric
  mode?: 'fuzzy' | 'pid' | string | null
  e?: Numeric
  de?: Numeric
  zc?: Numeric
  alarm?: number | null
  rssi?: Numeric
  bat?: BatteryTelemetry | null
  grid?: GridTelemetry | null
  pzem?: PzemTelemetry | null
  energy?: { pred_wh?: Numeric; actual_wh?: Numeric; [key: string]: unknown } | null
  wt?: { g?: Numeric; [key: string]: unknown } | null
  photo?: { on?: boolean | null; sec?: Numeric; lux?: Numeric; [key: string]: unknown } | null
  cam?: string | null
  [key: string]: unknown
}

export interface Sample {
  receivedAt: number
  telemetry: IcareTelemetry
}

export interface DecodedAlarm {
  bit: number
  value: number
  label: string
  severity: 'critical' | 'warning'
}

export type Command =
  | { kind: 'setpoint'; value: number }
  | { kind: 'mode'; value: 'fuzzy' | 'pid' }
  | { kind: 'estop'; value: 0 | 1 }

const ALARM_DEFINITIONS: Record<number, Omit<DecodedAlarm, 'bit' | 'value'>> = {
  0: { label: 'Emergency off aktif', severity: 'critical' },
  1: { label: 'Overheat (>38 °C)', severity: 'critical' },
  2: { label: 'Zero-cross hilang', severity: 'critical' },
  3: { label: 'Semua sensor hilang', severity: 'critical' },
  4: { label: 'Ada sensor tidak dipakai (rusak/outlier)', severity: 'warning' },
  5: { label: 'Selisih antar sensor > 2 °C', severity: 'warning' },
  6: { label: 'Baterai rendah', severity: 'warning' },
  7: { label: 'PLN padam (berjalan di baterai)', severity: 'warning' },
  8: { label: 'Kesalahan ATS / sumber tidak valid', severity: 'critical' },
}

export function decodeAlarms(mask: number | null | undefined): DecodedAlarm[] {
  if (!Number.isFinite(mask) || !mask || mask < 0) return []
  const alarms: DecodedAlarm[] = []
  for (let bit = 0; bit <= 52; bit += 1) {
    const value = 2 ** bit
    if (Math.floor(mask / value) % 2 === 1) {
      alarms.push({ bit, value, ...(ALARM_DEFINITIONS[bit] ?? { label: `Alarm #${bit}`, severity: 'warning' }) })
    }
  }
  return alarms
}

export function parseTelemetry(payload: string | Uint8Array): IcareTelemetry | null {
  try {
    const text = typeof payload === 'string' ? payload : new TextDecoder().decode(payload)
    const value: unknown = JSON.parse(text)
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return null
    const telemetry = value as IcareTelemetry
    return typeof telemetry.id === 'string' && telemetry.id.length > 0 ? telemetry : null
  } catch {
    return null
  }
}

export function isPublicBroker(url: string): boolean {
  try {
    return new URL(url).hostname.toLowerCase() === 'broker.hivemq.com'
  } catch {
    return false
  }
}

export function isCommandConfirmed(command: Command, telemetry: IcareTelemetry): boolean {
  if (command.kind === 'setpoint') {
    return typeof telemetry.sp === 'number' && Math.abs(telemetry.sp - command.value) <= 0.05
  }
  if (command.kind === 'mode') return telemetry.mode === command.value
  const estopActive = (((telemetry.alarm ?? 0) & 1) !== 0)
  return command.value === 1 ? estopActive : !estopActive
}

export function optionalFieldPresent(telemetry: IcareTelemetry | null, field: string): boolean {
  return telemetry !== null && Object.prototype.hasOwnProperty.call(telemetry, field) && telemetry[field] !== undefined
}
