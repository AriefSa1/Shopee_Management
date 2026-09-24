import { z } from "zod"
import {
  OrganizationIdSchema,
  type OrganizationId,
} from "../../identity/src/model.ts"
import {
  PilotMeasurementCaptureSchema,
  type PilotMeasurementCapture,
} from "./model.ts"
import {
  PilotMeasurementIdSchema,
  type PilotMeasurementId,
  type PilotMeasurementRecord,
} from "./postgres-measurement.ts"
import { evaluatePilotMeasurement } from "./measurement.ts"

export type StagingMeasurementAuthContext = {
  readonly organizationId: OrganizationId
  readonly actorId: string
  readonly canRead: boolean
  readonly canCapture: boolean
}

export type StagingMeasurementRepository = {
  readonly saveMeasurement: (record: PilotMeasurementRecord) => Promise<void>
  readonly readMeasurement: (scope: { readonly organizationId: OrganizationId }, measurementId: PilotMeasurementId) => Promise<PilotMeasurementRecord | null>
}

export type StagingMeasurementApiDependencies = {
  readonly authenticate: (request: Request) => StagingMeasurementAuthContext | null
  readonly repository: StagingMeasurementRepository
  readonly nextMeasurementId: () => PilotMeasurementId
}

const MeasurementQuerySchema = z.object({
  organizationId: OrganizationIdSchema,
  measurementId: PilotMeasurementIdSchema,
}).strict()

const MeasurementCaptureRequestSchema = z.object({
  organizationId: OrganizationIdSchema,
  capturedAt: z.string().datetime({ offset: true }),
  workflow: z.literal("multi_store_product_management"),
  baselineMinutes: z.number().finite().positive(),
  observedMinutes: z.number().finite().nonnegative(),
  sampleCount: z.number().int().positive(),
  targetReductionPercent: z.number().finite().min(50, "Pilot target must be at least 50%").max(100),
}).strict()

export async function createStagingMeasurementApiHandler(
  request: Request,
  dependencies: StagingMeasurementApiDependencies,
): Promise<Response> {
  if (!hasBearer(request)) return json({ error: { code: "authentication_required" } }, 401)
  const context = dependencies.authenticate(request)
  if (context === null) return json({ error: { code: "authentication_required" } }, 401)
  if (request.method === "GET") return readMeasurement(request, context, dependencies)
  if (request.method === "POST") return captureMeasurement(request, context, dependencies)
  return json({ error: { code: "method_not_allowed" } }, 405)
}

async function readMeasurement(
  request: Request,
  context: StagingMeasurementAuthContext,
  dependencies: StagingMeasurementApiDependencies,
): Promise<Response> {
  if (!context.canRead) return json({ error: { code: "measurement_read_forbidden" } }, 403)
  const parsed = MeasurementQuerySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams))
  if (!parsed.success) return json({ error: { code: "invalid_measurement_request" } }, 400)
  if (parsed.data.organizationId !== context.organizationId) return json({ error: { code: "organization_mismatch" } }, 403)
  try {
    const record = await dependencies.repository.readMeasurement({ organizationId: context.organizationId }, parsed.data.measurementId)
    if (record === null) return json({ error: { code: "measurement_not_found" } }, 404)
    if (record.capture.organizationId !== context.organizationId || record.measurementId !== parsed.data.measurementId) {
      return json({ error: { code: "measurement_scope_mismatch" } }, 403)
    }
    return json({ data: record }, 200)
  } catch (error) {
    if (error instanceof Error) return json({ error: { code: "measurement_state_unavailable", retryable: true } }, 502)
    throw error
  }
}

async function captureMeasurement(
  request: Request,
  context: StagingMeasurementAuthContext,
  dependencies: StagingMeasurementApiDependencies,
): Promise<Response> {
  if (!context.canCapture) return json({ error: { code: "measurement_capture_forbidden" } }, 403)
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return json({ error: { code: "invalid_measurement_request" } }, 400)
  }
  const parsed = MeasurementCaptureRequestSchema.safeParse(body)
  if (!parsed.success) return json({ error: { code: "invalid_measurement_request" } }, 400)
  if (parsed.data.organizationId !== context.organizationId) return json({ error: { code: "organization_mismatch" } }, 403)
  const capture: PilotMeasurementCapture = PilotMeasurementCaptureSchema.parse(parsed.data)
  const record: PilotMeasurementRecord = {
    measurementId: dependencies.nextMeasurementId(),
    capture,
    outcome: evaluatePilotMeasurement(capture),
  }
  try {
    await dependencies.repository.saveMeasurement(record)
    return json({ data: record }, 201)
  } catch (error) {
    if (error instanceof Error && /duplicate/i.test(error.message)) return json({ error: { code: "measurement_duplicate" } }, 409)
    if (error instanceof Error) return json({ error: { code: "measurement_persistence_unavailable", retryable: true } }, 502)
    throw error
  }
}

function hasBearer(request: Request): boolean {
  return request.headers.get("authorization")?.startsWith("Bearer ") === true
}

function json(body: object, status: 200 | 201 | 400 | 401 | 403 | 404 | 405 | 409 | 502): Response {
  return Response.json(body, { status })
}
