import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { OrganizationIdSchema } from "../../identity/src/model.ts"
import { RUNTIME_POLICY_VERSION } from "../../runtime-boundaries/src/runtime-boundaries.ts"
import { type KmsEnvelopeCodec, KmsMarketSchema } from "./durable-contracts.ts"
import {
  type AuthorizationGrantFixture,
  AuthorizationGrantFixtureSchema,
  CallbackCodeSchema,
  OAuthAttemptIdSchema,
  type OAuthCallbackClaim,
  OAuthStateHashSchema,
  type OfficialOAuthTokenExchangeProvider,
  PartnerApplicationIdSchema,
  ShopeeShopIdSchema,
} from "./model.ts"
import {
  executeWorkerHandoffExchange,
  type OAuthExchangeHandoff,
} from "./worker-handoff-exchange.ts"

const organizationId = OrganizationIdSchema.parse("10000000-0000-4000-8000-000000000001")
const attemptId = OAuthAttemptIdSchema.parse("20000000-0000-4000-8000-000000000001")
const partnerApplicationId = PartnerApplicationIdSchema.parse("partner-worker-handoff")
const market = KmsMarketSchema.parse("ID")

function handoff(): OAuthExchangeHandoff {
  return {
    claim: {
      attemptId,
      organizationId,
      actor: { issuer: "https://issuer.example.test", subject: "worker-owner" },
      partnerApplicationId,
      market,
      stateHash: OAuthStateHashSchema.parse("state-worker-handoff-000000000000000000000001"),
      issuedAt: "2026-09-10T00:00:00.000Z",
      expiresAt: "2026-09-10T01:00:00.000Z",
      shopId: ShopeeShopIdSchema.parse("1819834906"),
    },
    envelope: { keyVersion: 7, ciphertext: "sealed-callback-code", algorithm: "kms-envelope-v1" },
  }
}

function kms(calls: string[]): KmsEnvelopeCodec {
  return {
    async seal() {
      throw new Error("not used")
    },
    async unseal(_envelope, context) {
      calls.push(context.purpose)
      return CallbackCodeSchema.parse("raw-code-never-exposed")
    },
  }
}

describe("worker OAuth callback handoff exchange", () => {
  it("unseals only in worker, persists the evidence, and completes the handoff", async () => {
    // Given: a sealed callback handoff and provider fixture at the worker boundary.
    const kmsCalls: string[] = []
    const saved: AuthorizationGrantFixture[] = []
    const completed: string[] = []
    const provider: OfficialOAuthTokenExchangeProvider = {
      async exchange(claim: OAuthCallbackClaim) {
        assert.equal(claim.callbackCode, "raw-code-never-exposed")
        return {
          ...AuthorizationGrantFixtureSchema.parse({
            grantId: "30000000-0000-4000-8000-000000000001",
            organizationId: claim.organizationId,
            partnerApplicationId: claim.partnerApplicationId,
            grantKind: "shop_account",
            grantedAt: "2026-09-10T00:02:00.000Z",
            subjects: [
              {
                credentialSubjectId: "60000000-0000-4000-8000-000000000001",
                revision: 1,
                keyVersion: 7,
                shopIds: ["70000000-0000-4000-8000-000000000001"],
              },
            ],
          }),
          authorizedShopId: claim.shopId,
        }
      },
    }

    // When: the worker executes the durable handoff.
    const result = await executeWorkerHandoffExchange(
      { runtimeRole: "worker", policyVersion: RUNTIME_POLICY_VERSION, handoff: handoff() },
      {
        kms: kms(kmsCalls),
        provider,
        persistence: {
          kind: "external_grant_repository",
          saveGrant: async (grant) => {
            saved.push(grant)
          },
        },
        completeHandoff: async (id) => {
          completed.push(id)
        },
      },
    )

    // Then: the grant is normalized only after evidence persistence and the handoff completes.
    assert.equal(result.status, "active")
    assert.equal(saved.length, 1)
    assert.deepEqual(kmsCalls, ["oauth_callback_code"])
    assert.deepEqual(completed, [attemptId])
  })

  it("denies web before unseal or provider access", async () => {
    // Given: a web-role request with tracking dependencies.
    let unsealCalls = 0
    let providerCalls = 0
    const provider: OfficialOAuthTokenExchangeProvider = {
      async exchange() {
        providerCalls += 1
        throw new Error("must not call")
      },
    }

    // When: web attempts to execute the worker handoff.
    await assert.rejects(
      executeWorkerHandoffExchange(
        { runtimeRole: "web", policyVersion: RUNTIME_POLICY_VERSION, handoff: handoff() },
        {
          kms: {
            async seal() {
              throw new Error("not used")
            },
            async unseal() {
              unsealCalls += 1
              return CallbackCodeSchema.parse("blocked")
            },
          },
          provider,
          persistence: { kind: "external_grant_repository", saveGrant: async () => {} },
        },
      ),
      /Runtime capability denied/,
    )

    // Then: capability denial occurs before secret or provider access.
    assert.equal(unsealCalls, 0)
    assert.equal(providerCalls, 0)
  })

  it("does not persist a grant twice when the provider owns the encrypted commit", async () => {
    // Given: a provider whose successful exchange already committed the encrypted credential and grant.
    let providerCalls = 0
    const provider: OfficialOAuthTokenExchangeProvider = {
      async exchange(claim) {
        providerCalls += 1
        return {
          ...AuthorizationGrantFixtureSchema.parse({
            grantId: "30000000-0000-4000-8000-000000000003",
            organizationId: claim.organizationId,
            partnerApplicationId: claim.partnerApplicationId,
            grantKind: "shop_account",
            grantedAt: "2026-09-10T00:02:00.000Z",
            subjects: [
              {
                credentialSubjectId: "60000000-0000-4000-8000-000000000003",
                revision: 1,
                keyVersion: 7,
                shopIds: ["70000000-0000-4000-8000-000000000003"],
              },
            ],
          }),
          authorizedShopId: claim.shopId,
        }
      },
    }

    // When: the worker receives evidence from the production provider-commit path.
    const result = await executeWorkerHandoffExchange(
      { runtimeRole: "worker", policyVersion: RUNTIME_POLICY_VERSION, handoff: handoff() },
      { kms: kms([]), provider, persistence: { kind: "provider_commits" } },
    )

    // Then: the evidence is normalized without a second grant repository write.
    assert.equal(result.status, "active")
    assert.equal(providerCalls, 1)
  })
})
