import { Hono } from "hono"
import {
  type CatalogApiDependencies,
  createCatalogApiHandler,
} from "../../../packages/catalog/src/catalog-api.ts"
import {
  type CopyPreviewApiDependencies,
  createCopyPreviewApiHandler,
} from "../../../packages/copy-preview/src/copy-preview-api.ts"
import type { HealthResponse, ReadinessResponse } from "../../../packages/domain/src/health.ts"
import type { DatabaseReadinessProbe } from "../../../packages/domain/src/readiness.ts"
import {
  createOAuthCallbackApiHandler,
  createOAuthStartApiHandler,
  type OAuthWebApiDependencies,
} from "../../../packages/oauth/src/oauth-api.ts"
import {
  createStagingMeasurementApiHandler,
  type StagingMeasurementApiDependencies,
} from "../../../packages/staging/src/measurement-api.ts"
import {
  createStagingApiHandler,
  type StagingApiDependencies,
} from "../../../packages/staging/src/staging-api.ts"
import { createStagingUiHandler } from "../../../packages/staging/src/staging-ui.ts"
import {
  createWriteRecoveryApiHandler,
  type WriteRecoveryApiDependencies,
} from "../../../packages/write-recovery/src/recovery-api.ts"
import { createWriteRecoveryUiHandler } from "../../../packages/write-recovery/src/recovery-ui.ts"
import { createDashboardUiHandler } from "./dashboard-ui.ts"
import { createStoresApiHandler, type StoreApiDependencies } from "./stores-api.ts"

export function createWebApp(
  database: DatabaseReadinessProbe,
  catalog?: CatalogApiDependencies,
  oauth?: OAuthWebApiDependencies,
  staging?: StagingApiDependencies,
  writeRecovery?: WriteRecoveryApiDependencies,
  stagingMeasurement?: StagingMeasurementApiDependencies,
  copyPreview?: CopyPreviewApiDependencies,
  stores?: StoreApiDependencies,
): Hono {
  const app = new Hono()

  app.get("/health", (context) =>
    context.json({ service: "web", status: "ok" } satisfies HealthResponse),
  )
  app.get("/ready", async (context) => {
    const databaseReadiness = await database.check()
    const readiness = {
      service: "web",
      status: databaseReadiness.state === "ready" ? "ready" : "not_ready",
      dependencies: { database: databaseReadiness },
    } satisfies ReadinessResponse
    return context.json(readiness, readiness.status === "ready" ? 200 : 503)
  })
  app.get("/", async () => createDashboardUiHandler(database, oauth !== undefined))
  if (catalog !== undefined) {
    app.get("/api/catalog", (context) => createCatalogApiHandler(context.req.raw, catalog))
  }
  if (stores !== undefined) {
    app.get("/api/stores", (context) => createStoresApiHandler(context.req.raw, stores))
  }
  if (oauth !== undefined) {
    app.get("/api/auth/shopee/start", (context) =>
      createOAuthStartApiHandler(context.req.raw, oauth),
    )
    app.get("/api/auth/shopee/callback", (context) =>
      createOAuthCallbackApiHandler(context.req.raw, oauth),
    )
  }
  if (staging !== undefined) {
    app.get("/api/staging/alpha", (context) => createStagingApiHandler(context.req.raw, staging))
    app.get("/staging/alpha", (context) => createStagingUiHandler(context.req.raw, staging))
  }
  if (writeRecovery !== undefined) {
    app.get("/api/write-recovery/outcome-unknown", (context) =>
      createWriteRecoveryApiHandler(context.req.raw, writeRecovery),
    )
    app.post("/api/write-recovery/outcome-unknown", (context) =>
      createWriteRecoveryApiHandler(context.req.raw, writeRecovery),
    )
    app.get("/write-recovery/outcome-unknown", (context) =>
      createWriteRecoveryUiHandler(context.req.raw, writeRecovery),
    )
    app.post("/write-recovery/outcome-unknown", (context) =>
      createWriteRecoveryUiHandler(context.req.raw, writeRecovery),
    )
  }
  if (stagingMeasurement !== undefined) {
    app.get("/api/staging/pilot-measurements", (context) =>
      createStagingMeasurementApiHandler(context.req.raw, stagingMeasurement),
    )
    app.post("/api/staging/pilot-measurements", (context) =>
      createStagingMeasurementApiHandler(context.req.raw, stagingMeasurement),
    )
  }
  if (copyPreview !== undefined) {
    app.post("/api/copy-preview", (context) =>
      createCopyPreviewApiHandler(context.req.raw, copyPreview),
    )
  }

  return app
}
