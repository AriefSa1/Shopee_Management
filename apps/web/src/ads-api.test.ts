import assert from "node:assert/strict"
import { test } from "node:test"
import type { PostgresExecutor } from "../../../packages/delivery/src/postgres-delivery.ts"
import {
  IdentitySchema,
  OrganizationIdSchema,
  ShopIdSchema,
} from "../../../packages/identity/src/model.ts"
import type { ShopeeAdsReader } from "../../../packages/integrations/src/shopee-ads.ts"
import { createAdsDailyApiHandler } from "./ads-api.ts"

const shopId = ShopIdSchema.parse("20000000-0000-4000-8000-000000000001")
const organizationId = OrganizationIdSchema.parse("10000000-0000-4000-8000-000000000001")
const auth = {
  organizationId,
  actor: IdentitySchema.parse({ issuer: "https://id.example.test", subject: "operator" }),
}
const request = () => new Request(`http://localhost/api/ads/daily?shopId=${shopId}&days=7`)

function executor(rows: readonly { id: string }[]): PostgresExecutor {
  const result: PostgresExecutor = {
    query: async () => rows,
    transaction: async (work) => work(result),
  }
  return result
}

// The /api/ads/daily handler only calls readDaily; the other reader methods are
// stubbed so mocks satisfy the ShopeeAdsReader interface.
const otherAdsReads: Omit<ShopeeAdsReader, "readDaily"> = {
  readProductCampaignIds: async () => ({ campaigns: [], hasNextPage: false }),
  readProductCampaignSettings: async () => [],
  readGmsDeletedItems: async () => ({ itemIds: [], hasNextPage: false }),
  readGmsCampaignPerformance: async () => ({ report: {} }),
  readGmsItemPerformance: async () => ({ items: [], hasNextPage: false }),
  readGmsRaw: async () => ({ campaignPerformance: {}, itemPerformance: {}, deletedItems: {} }),
}

test("rejects unauthenticated and cross-organization Ads reads before provider access", async () => {
  let reads = 0
  const reader: ShopeeAdsReader = {
    readDaily: async () => {
      reads += 1
      return { daily: [], partial: false }
    },
    ...otherAdsReads,
  }
  const unauthenticated = await createAdsDailyApiHandler(request(), {
    authenticate: () => null,
    executor: executor([{ id: shopId }]),
    reader,
  })
  assert.equal(unauthenticated.status, 401)

  const inaccessible = await createAdsDailyApiHandler(request(), {
    authenticate: () => auth,
    executor: executor([]),
    reader,
  })
  assert.equal(inaccessible.status, 403)
  assert.equal(reads, 0)
})

test("uses the previous seven Jakarta calendar dates for the selected shop", async () => {
  let actual: { shopId: string; startDate: string; endDate: string } | undefined
  const response = await createAdsDailyApiHandler(request(), {
    authenticate: () => auth,
    executor: executor([{ id: shopId }]),
    reader: {
      readDaily: async (input) => {
        actual = input
        return { daily: [{ date: "23-09-2026", expense: 0 }], partial: false }
      },
      ...otherAdsReads,
    },
    now: () => new Date("2026-09-24T00:30:00Z"),
  })
  assert.equal(response.status, 200)
  assert.deepEqual(actual, { shopId, startDate: "17-09-2026", endDate: "23-09-2026" })
  assert.equal(response.headers.get("cache-control"), "no-store")
  assert.deepEqual(await response.json(), {
    data: {
      shopId,
      startDate: "17-09-2026",
      endDate: "23-09-2026",
      daily: [{ date: "23-09-2026", expense: 0 }],
      partial: false,
    },
  })
})
