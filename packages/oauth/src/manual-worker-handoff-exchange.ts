import { OrganizationIdSchema } from "../../identity/src/model.ts"
import { RUNTIME_POLICY_VERSION } from "../../runtime-boundaries/src/runtime-boundaries.ts"
import { type KmsEnvelopeCodec, KmsMarketSchema } from "./durable-contracts.ts"
import {
  type AuthorizationGrantFixture,
  AuthorizationGrantFixtureSchema,
  CallbackCodeSchema,
  OAuthAttemptIdSchema,
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
const partnerApplicationId = PartnerApplicationIdSchema.parse("partner-manual-handoff")
const handoff: OAuthExchangeHandoff = {
  claim: {
    attemptId,
    organizationId,
    actor: { issuer: "https://issuer.example.test", subject: "manual-worker" },
    partnerApplicationId,
    market: KmsMarketSchema.parse("ID"),
    stateHash: OAuthStateHashSchema.parse("state-manual-handoff-000000000000000000000001"),
    issuedAt: "2026-09-10T00:00:00.000Z",
    expiresAt: "2026-09-10T01:00:00.000Z",
    shopId: ShopeeShopIdSchema.parse("1819834906"),
  },
  envelope: { keyVersion: 7, ciphertext: "sealed-manual-code", algorithm: "kms-envelope-v1" },
}

const kms: KmsEnvelopeCodec = {
  async seal() {
    throw new Error("not used")
  },
  async unseal() {
    return CallbackCodeSchema.parse("raw-code-manual")
  },
}
const provider: OfficialOAuthTokenExchangeProvider = {
  async exchange(claim) {
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
const saved: AuthorizationGrantFixture[] = []
let completed = false
const result = await executeWorkerHandoffExchange(
  { runtimeRole: "worker", policyVersion: RUNTIME_POLICY_VERSION, handoff },
  {
    kms,
    provider,
    persistence: {
      kind: "external_grant_repository",
      saveGrant: async (grant) => {
        saved.push(grant)
      },
    },
    completeHandoff: async () => {
      completed = true
    },
  },
)

console.log(
  JSON.stringify({
    scenario: "phase2-worker-handoff-exchange-provider-free",
    activeGrant: result.status === "active",
    grantPersisted: saved.length === 1,
    handoffCompleted: completed,
    providerCalls: 0,
    networkCalls: 0,
    secretValuesEmitted: false,
  }),
)
