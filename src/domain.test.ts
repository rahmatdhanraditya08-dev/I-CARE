import { describe, expect, it } from 'vitest'
import { decodeAlarms, isCommandConfirmed, isPublicBroker, parseTelemetry } from './domain'
import { calculatePairMetrics, calculateTemperatureMetrics } from './metrics'
import type { Sample } from './domain'

const sample = (at: number, t: number, sp = 36): Sample => ({ receivedAt: at, telemetry: { t, sp, ds: [t - 0.1, t + 0.1] } })

describe('alarm decoder', () => {
  it('decodes known and unknown bits without failing', () => {
    expect(decodeAlarms(64 | 256 | 512).map(({ label }) => label)).toEqual([
      'Baterai rendah', 'Kesalahan ATS / sumber tidak valid', 'Alarm #9',
    ])
  })
  it('ignores empty alarms and handles malformed JSON', () => {
    expect(decodeAlarms(null)).toEqual([])
    expect(parseTelemetry('{oops')).toBeNull()
    expect(parseTelemetry('{}')).toBeNull()
  })
})

describe('broker host safety', () => {
  it('detects the actual public broker hostname', () => {
    expect(isPublicBroker('wss://broker.hivemq.com:8884/mqtt')).toBe(true)
    expect(isPublicBroker('wss://user@broker.hivemq.com:8884/mqtt')).toBe(true)
    expect(isPublicBroker('wss://broker.hivemq.com.example.invalid/mqtt')).toBe(false)
    expect(isPublicBroker('not a url')).toBe(false)
  })
})

describe('evaluation metrics', () => {
  it('calculates MAE, RMSE, overshoot, and settling time', () => {
    const result = calculateTemperatureMetrics([sample(0, 35), sample(1000, 36.3), sample(2000, 36.1)])
    expect(result.mae).toBeCloseTo(0.4667, 3)
    expect(result.rmse).toBeCloseTo(Math.sqrt((1 ** 2 + 0.3 ** 2 + 0.1 ** 2) / 3))
    expect(result.steadyStateError).toBeCloseTo(0.2, 3)
    expect(result.overshoot).toBeCloseTo(0.3)
    expect(result.settlingTimeSeconds).toBe(2)
  })
  it('calculates paired energy prediction error', () => {
    expect(calculatePairMetrics([{ predicted: 4, actual: 3 }, { predicted: 7, actual: 5 }])).toEqual({
      count: 2, mae: 1.5, rmse: Math.sqrt(2.5),
    })
  })
})

describe('command confirmation', () => {
  it('uses the contract tolerance and emergency-stop bit', () => {
    expect(isCommandConfirmed({ kind: 'setpoint', value: 36.5 }, { sp: 36.54 })).toBe(true)
    expect(isCommandConfirmed({ kind: 'mode', value: 'pid' }, { mode: 'pid' })).toBe(true)
    expect(isCommandConfirmed({ kind: 'estop', value: 1 }, { alarm: 1 })).toBe(true)
    expect(isCommandConfirmed({ kind: 'estop', value: 0 }, { alarm: 0 })).toBe(true)
  })
})
