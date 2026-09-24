import {
  AuthorizationGrantFixtureSchema,
  CallbackCodeSchema,
  InMemoryOAuthStateStore,
  OAuthAttemptIdSchema,
  OAuthStateHashSchema,
  PartnerApplicationIdSchema,
  ShopeeShopIdSchema,
  claimOAuthCallback,
  createOAuthStateRecord,
  executeWorkerOnlyTokenExchange,
  toSafeOAuthAttempt,
} from "./index.ts"
import { IdentitySchema, OrganizationIdSchema, ShopIdSchema } from "../../identity/src/model.ts"
import { RUNTIME_POLICY_VERSION } from "../../runtime-boundaries/src/runtime-boundaries.ts"

class OAuthManualQaError extends Error {
  readonly name = "OAuthManualQaError"
  readonly reason: "callback_claim_failed"

  constructor(reason: "callback_claim_failed") {
    super("OAuth manual QA callback claim failed")
    this.reason = reason
  }
}

const organizationId = OrganizationIdSchema.parse("10000000-0000-4000-8000-000000000001")
const actor = IdentitySchema.parse({ issuer: "https://id.example.test", subject: "owner-manual" })
const shopA = ShopIdSchema.parse("30000000-0000-4000-8000-000000000001")
const shopB = ShopIdSchema.parse("30000000-0000-4000-8000-000000000002")
const stateHash = OAuthStateHashSchema.parse("state-hash-manual-000000000000000000000000000001")

const states = new InMemoryOAuthStateStore([
  createOAuthStateRecord({
    attemptId: OAuthAttemptIdSchema.parse("40000000-0000-4000-8000-000000000002"),
    organizationId,
    actor,
    partnerApplicationId: PartnerApplicationIdSchema.parse("partner-app-manual"),
    market: "ID",
    stateHash,
    issuedAt: "2026-09-09T00:00:00.000Z",
    expiresAt: "2026-09-09T00:10:00.000Z",
  }),
])

const claimed = claimOAuthCallback(
  {
    stateHash,
    organizationId,
    actor,
    receivedAt: "2026-09-09T00:05:00.000Z",
    code: CallbackCodeSchema.parse("manual-callback-code-canary"),
    shopId: ShopeeShopIdSchema.parse("1819834906"),
  },
  states,
)

if (claimed.kind !== "claimed") {
  throw new OAuthManualQaError("callback_claim_failed")
}

const grant = await executeWorkerOnlyTokenExchange(
  { runtimeRole: "worker", policyVersion: RUNTIME_POLICY_VERSION, claim: claimed.claim },
  {
    async exchange(claim) {
      return {
        ...AuthorizationGrantFixtureSchema.parse({
        grantId: "50000000-0000-4000-8000-000000000002",
        organizationId,
        partnerApplicationId: PartnerApplicationIdSchema.parse("partner-app-manual"),
        grantKind: "main_account",
        grantedAt: "2026-09-09T00:05:00.000Z",
        subjects: [
          {
            credentialSubjectId: "60000000-0000-4000-8000-000000000002",
            revision: 1,
            keyVersion: 1,
            shopIds: [shopA, shopB],
          },
        ],
        }),
        authorizedShopId: claim.shopId,
      }
    },
  },
)

const safeAttempt = toSafeOAuthAttempt(states.get(stateHash))
console.log(
  JSON.stringify({
    scenario: "official-oauth-provider-fixture",
    callback: safeAttempt === undefined ? "missing" : safeAttempt.status,
    grant: { kind: grant.grantKind, subjectCount: grant.subjects.length, bindingCount: grant.bindings.length },
    secretFieldsPresent: false,
    networkCalls: 0,
  }),
)
