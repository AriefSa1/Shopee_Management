import type { PilotMeasurementCapture, PilotMeasurementOutcome } from "./model.ts"

export function evaluatePilotMeasurement(capture: PilotMeasurementCapture): PilotMeasurementOutcome {
  const reductionPercent = roundToTwoDecimalPlaces(
    ((capture.baselineMinutes - capture.observedMinutes) / capture.baselineMinutes) * 100,
  )

  if (reductionPercent >= capture.targetReductionPercent) {
    return { kind: "target_met", reductionPercent, targetReductionPercent: capture.targetReductionPercent }
  }
  return { kind: "target_missed", reductionPercent, targetReductionPercent: capture.targetReductionPercent }
}

function roundToTwoDecimalPlaces(value: number): number {
  return Math.round(value * 100) / 100
}
