import type { CatalogApiDependencies } from "../../../packages/catalog/src/catalog-api.ts"
import type { PostgresExecutor } from "../../../packages/delivery/src/postgres-delivery.ts"
import type { DatabaseReadinessProbe } from "../../../packages/domain/src/readiness.ts"
import type { ShopeeProductDetailReader } from "../../../packages/integrations/src/shopee-product-detail.ts"
import type { OAuthWebApiDependencies } from "../../../packages/oauth/src/oauth-api.ts"
import { createWebApp } from "./app.ts"
import { createConnectionStatusApiHandler } from "./connection-status-api.ts"
import type { InternalSessionService } from "./internal-session.ts"
import { createProductDetailApiHandler } from "./product-detail-api.ts"
import {
  createShopeeConnectionUiHandler,
  type ShopeeConnectionUiConfig,
} from "./shopee-connection-ui.ts"
import type { StoreApiDependencies } from "./stores-api.ts"

export type ProductionWebAppDependencies = {
  readonly database: DatabaseReadinessProbe
  readonly oauth: OAuthWebApiDependencies
  readonly session: InternalSessionService
  readonly connection: ShopeeConnectionUiConfig
  readonly executor?: PostgresExecutor
  readonly catalog?: CatalogApiDependencies
  readonly productDetailReader?: ShopeeProductDetailReader
  readonly spaPublicDir?: string
}

export function createProductionWebApp(dependencies: ProductionWebAppDependencies) {
  if (dependencies.executor === undefined || dependencies.catalog === undefined) {
    const app = createWebApp(
      dependencies.database,
      undefined,
      dependencies.oauth,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      dependencies.spaPublicDir,
    )
    app.post("/api/session/login", (context) => dependencies.session.login(context.req.raw))
    app.post("/api/session/logout", () => dependencies.session.logout())
    app.get("/api/session/status", (context) =>
      Response.json(
        { authenticated: dependencies.session.authenticate(context.req.raw) !== null },
        { headers: { "cache-control": "no-store" } },
      ),
    )
    app.get("/connect/shopee", () => createShopeeConnectionUiHandler(dependencies.connection))
    return app
  }
  const executor = dependencies.executor
  const baseCatalog = dependencies.catalog
  const stores: StoreApiDependencies = { authenticate: dependencies.session.authenticate, executor }
  const catalog: CatalogApiDependencies = {
    ...baseCatalog,
    authenticate: async (request) => {
      const context = dependencies.session.authenticate(request)
      if (context === null) return null
      const rows = await executor.query({
        name: "web.catalog.authorize_shops",
        text: "SELECT id FROM shop_connections WHERE organization_id = $1 AND status = 'active'",
        params: [context.organizationId],
      })
      return {
        organizationId: context.organizationId,
        accessibleShopIds: rows
          .map((row) => String(row["id"]))
          .filter((value) => value.length > 0) as never[],
        capability: baseCatalog.adapter.capability,
      }
    },
  }
  const app = createWebApp(
    dependencies.database,
    catalog,
    dependencies.oauth,
    undefined,
    undefined,
    undefined,
    undefined,
    stores,
    dependencies.spaPublicDir,
  )
  app.post("/api/session/login", (context) => dependencies.session.login(context.req.raw))
  app.post("/api/session/logout", () => dependencies.session.logout())
  app.get("/api/session/status", (context) =>
    Response.json(
      { authenticated: dependencies.session.authenticate(context.req.raw) !== null },
      { headers: { "cache-control": "no-store" } },
    ),
  )
  app.get("/connect/shopee", () => createShopeeConnectionUiHandler(dependencies.connection))
  app.get("/api/connections", (context) =>
    createConnectionStatusApiHandler(context.req.raw, {
      authenticate: dependencies.session.authenticate,
      executor,
    }),
  )
  const productDetailReader = dependencies.productDetailReader
  if (productDetailReader !== undefined) {
    app.get("/api/catalog/item", (context) =>
      createProductDetailApiHandler(context.req.raw, {
        authenticate: dependencies.session.authenticate,
        executor,
        reader: productDetailReader,
      }),
    )
  }
  return app
}
