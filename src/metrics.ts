import type { Sample } from './domain'

export interface TemperatureMetrics {
  count: number
  average: number | null
  standardDeviation: number | null
  steadyStateError: number | null
  mae: number | null
  rmse: number | null
  peakDeviation: number | null
  withinHalfDegree: number | null
  withinQuarterDegree: number | null
  maxSensorSpread: number | null
  overshoot: number | null
  settlingTimeSeconds: number | null
}

const mean = (values: number[]): number | null => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)

export function calculateTemperatureMetrics(samples: Sample[]): TemperatureMetrics {
  const valid = samples.filter(({ telemetry }) => finite(telemetry.t) && finite(telemetry.sp))
  const temperatures = valid.map(({ telemetry }) => telemetry.t as number)
  const errors = valid.map(({ telemetry }) => (telemetry.sp as number) - (telemetry.t as number))
  const average = mean(temperatures)
  const mae = mean(errors.map(Math.abs))
  const rmse = errors.length ? Math.sqrt(mean(errors.map((error) => error ** 2)) as number) : null
  const deviations = errors.map(Math.abs)
  const standardDeviation = average === null ? null : Math.sqrt(mean(temperatures.map((value) => (value - average) ** 2)) as number)
  const spreads = samples.flatMap(({ telemetry }) => {
    const sensors = telemetry.ds?.filter(finite) ?? []
    return sensors.length > 1 ? [Math.max(...sensors) - Math.min(...sensors)] : []
  })
  const setpoint = valid.at(-1)?.telemetry.sp as number | undefined
  const peakTemperature = temperatures.length ? Math.max(...temperatures) : null
  const start = valid[0]
  const end = valid.at(-1)
  const heating = start && end && finite(start.telemetry.t) && finite(end.telemetry.sp) && start.telemetry.t < end.telemetry.sp
  let settlingTimeSeconds: number | null = null
  if (heating && valid.length > 1) {
    let lastOutOfBand = -1
    for (let index = 0; index < valid.length; index += 1) {
      const sample = valid[index]
      if (Math.abs((sample.telemetry.t as number) - (sample.telemetry.sp as number)) > 0.2) lastOutOfBand = index
    }
    const settledAt = lastOutOfBand + 1
    if (settledAt < valid.length) settlingTimeSeconds = (valid[settledAt].receivedAt - valid[0].receivedAt) / 1000
  }

  return {
    count: valid.length,
    average,
    standardDeviation,
    steadyStateError: mean(errors),
    mae,
    rmse,
    peakDeviation: deviations.length ? Math.max(...deviations) : null,
    withinHalfDegree: valid.length ? deviations.filter((value) => value <= 0.5).length / valid.length * 100 : null,
    withinQuarterDegree: valid.length ? deviations.filter((value) => value <= 0.25).length / valid.length * 100 : null,
    maxSensorSpread: spreads.length ? Math.max(...spreads) : null,
    overshoot: setpoint === undefined || peakTemperature === null ? null : Math.max(0, peakTemperature - setpoint),
    settlingTimeSeconds,
  }
}

export function calculatePairMetrics(pairs: Array<{ predicted: number; actual: number }>) {
  const valid = pairs.filter(({ predicted, actual }) => finite(predicted) && finite(actual))
  const errors = valid.map(({ predicted, actual }) => predicted - actual)
  return {
    count: valid.length,
    mae: mean(errors.map(Math.abs)),
    rmse: errors.length ? Math.sqrt(mean(errors.map((error) => error ** 2)) as number) : null,
  }
}
