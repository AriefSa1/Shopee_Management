import assert from "node:assert/strict"
import { describe, it } from "node:test"
import type {
  PostgresExecutor,
  SqlRow,
  SqlStatement,
} from "../../../packages/delivery/src/postgres-delivery.ts"
import { OrganizationIdSchema } from "../../../packages/identity/src/model.ts"
import { ShopeeCatalogProviderError } from "../../../packages/integrations/src/shopee-product-catalog.ts"
import type { ShopeeProductDetailReader } from "../../../packages/integrations/src/shopee-product-detail.ts"
import type { OAuthWebAuthContext } from "../../../packages/oauth/src/oauth-api.ts"
import { createProductDetailApiHandler } from "./product-detail-api.ts"

const organizationId = OrganizationIdSchema.parse("10000000-0000-4000-8000-000000000001")
const context: OAuthWebAuthContext = {
  organizationId,
  actor: { issuer: "https://app.example.test/x", subject: "op" },
}
const shopId = "30000000-0000-4000-8000-000000000001"

class FakeExecutor implements PostgresExecutor {
  readonly statements: SqlStatement[] = []
  private readonly rows: readonly SqlRow[]
  constructor(rows: readonly SqlRow[]) {
    this.rows = rows
  }
  async query(statement: SqlStatement): Promise<readonly SqlRow[]> {
    this.statements.push(statement)
    return this.rows
  }
  async transaction<T>(work: (executor: PostgresExecutor) => Promise<T>): Promise<T> {
    return work(this)
  }
}

const okReader: ShopeeProductDetailReader = {
  async readItemDetail(request) {
    return {
      itemId: request.itemId,
      raw: {
        base_info: { response: { item_id: request.itemId } },
        model_list: {},
        extra_info: {},
        promotion: {},
      },
    }
  },
}
const req = (qs: string) =>
  new Request("https://app.example.test/api/catalog/item" + qs, {
    headers: { accept: "application/json" },
  })

describe("product detail API", () => {
  it("returns every raw section for an authorized shop and item", async () => {
    const executor = new FakeExecutor([{ id: shopId }])
    const response = await createProductDetailApiHandler(req(`?shopId=${shopId}&itemId=99`), {
      authenticate: () => context,
      executor,
      reader: okReader,
    })
    assert.equal(response.status, 200)
    const body = (await response.json()) as {
      data: { itemId: number; raw: Record<string, unknown> }
    }
    assert.equal(body.data.itemId, 99)
    assert.deepEqual(Object.keys(body.data.raw).sort(), [
      "base_info",
      "extra_info",
      "model_list",
      "promotion",
    ])
  })

  it("requires an authenticated operator", async () => {
    const executor = new FakeExecutor([{ id: shopId }])
    const response = await createProductDetailApiHandler(req(`?shopId=${shopId}&itemId=99`), {
      authenticate: () => null,
      executor,
      reader: okReader,
    })
    assert.equal(response.status, 401)
    assert.equal(executor.statements.length, 0)
  })

  it("rejects an invalid item id", async () => {
    const executor = new FakeExecutor([{ id: shopId }])
    const response = await createProductDetailApiHandler(req(`?shopId=${shopId}&itemId=abc`), {
      authenticate: () => context,
      executor,
      reader: okReader,
    })
    assert.equal(response.status, 400)
  })

  it("denies a shop outside the operator organization", async () => {
    const executor = new FakeExecutor([])
    const response = await createProductDetailApiHandler(req(`?shopId=${shopId}&itemId=99`), {
      authenticate: () => context,
      executor,
      reader: okReader,
    })
    assert.equal(response.status, 403)
  })

  it("maps provider failures to a safe 502", async () => {
    const executor = new FakeExecutor([{ id: shopId }])
    const failing: ShopeeProductDetailReader = {
      async readItemDetail() {
        throw new ShopeeCatalogProviderError("catalog_access_refresh_failed", "req-1")
      },
    }
    const response = await createProductDetailApiHandler(req(`?shopId=${shopId}&itemId=99`), {
      authenticate: () => context,
      executor,
      reader: failing,
    })
    assert.equal(response.status, 502)
    const body = (await response.json()) as { error: { code: string; providerCode: string } }
    assert.equal(body.error.code, "catalog_provider_unavailable")
    assert.equal(body.error.providerCode, "catalog_access_refresh_failed")
  })
})
