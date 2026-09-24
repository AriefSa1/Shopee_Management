import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { IdentitySchema, OrganizationIdSchema } from "../../identity/src/model.ts"
import { RUNTIME_POLICY_VERSION } from "../../runtime-boundaries/src/runtime-boundaries.ts"
import {
  AuthorizationGrantFixtureSchema,
  CallbackCodeSchema,
  OAuthAttemptIdSchema,
  OAuthStateHashSchema,
  PartnerApplicationIdSchema,
  ShopeeShopIdSchema,
} from "./model.ts"
import {
  executeWorkerOnlyTokenExchangeEvidence,
  OAuthExchangeEvidenceError,
} from "./worker-exchange.ts"

const organizationId = OrganizationIdSchema.parse("10000000-0000-4000-8000-000000000001")
const authorizedShopId = ShopeeShopIdSchema.parse("1819834906")

describe("worker OAuth exchange evidence", () => {
  it("rejects a successful exchange whose authorized Shopee shop differs from the callback", async () => {
    // Given: a worker claim and provider evidence for a different external Shopee shop.
    const claim = {
      attemptId: OAuthAttemptIdSchema.parse("20000000-0000-4000-8000-000000000001"),
      organizationId,
      actor: IdentitySchema.parse({ issuer: "https://id.example.test", subject: "owner-a" }),
      partnerApplicationId: PartnerApplicationIdSchema.parse("partner-worker-evidence"),
      market: "ID" as const,
      stateHash: OAuthStateHashSchema.parse("state-worker-evidence-000000000000000000000001"),
      issuedAt: "2026-09-12T00:00:00.000Z",
      expiresAt: "2026-09-12T00:10:00.000Z",
      shopId: authorizedShopId,
      callbackCode: CallbackCodeSchema.parse("callback-code-fixture"),
    }
    const provider = {
      async exchange() {
        return {
          ...AuthorizationGrantFixtureSchema.parse({
            grantId: "30000000-0000-4000-8000-000000000001",
            organizationId,
            partnerApplicationId: claim.partnerApplicationId,
            grantKind: "shop_account",
            grantedAt: "2026-09-12T00:01:00.000Z",
            subjects: [{
              credentialSubjectId: "40000000-0000-4000-8000-000000000001",
              revision: 1,
              keyVersion: 1,
              shopIds: ["50000000-0000-4000-8000-000000000001"],
            }],
          }),
          authorizedShopId: ShopeeShopIdSchema.parse("1819834907"),
        }
      },
    }

    // When: the worker verifies the provider result against the claimed shop.
    const result = executeWorkerOnlyTokenExchangeEvidence(
      { runtimeRole: "worker", policyVersion: RUNTIME_POLICY_VERSION, claim },
      provider,
    )

    // Then: the mismatch fails closed before persistence can run.
    await assert.rejects(result, {
      name: OAuthExchangeEvidenceError.name,
      reason: "exchange_shop_mismatch",
    })
  })
})
