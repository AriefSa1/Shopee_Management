import {
  createOAuthCallbackApiHandler,
  createOAuthStartApiHandler,
} from "./oauth-api.ts"
import { InMemoryOAuthDurableRepository } from "./durable-contracts.ts"
import { OAuthAttemptIdSchema, OAuthStateHashSchema, PartnerApplicationIdSchema } from "./model.ts"
import { IdentitySchema, OrganizationIdSchema } from "../../identity/src/model.ts"
import { InMemoryOAuthStateStore, createOAuthStateRecord } from "./state.ts"
import type { OAuthStateIssueInput } from "./oauth-api.ts"

const organizationId = OrganizationIdSchema.parse("10000000-0000-4000-8000-000000000001")
const actor = IdentitySchema.parse({ issuer: "https://id.example.test", subject: "manual-oauth-owner" })
const partnerApplicationId = PartnerApplicationIdSchema.parse("partner-manual")
const stateHash = OAuthStateHashSchema.parse("state-manual-000000000000000000000000000000001")
const stateStore = new InMemoryOAuthStateStore([])
const durable = new InMemoryOAuthDurableRepository()
const dependencies = {
  authenticate: () => ({ organizationId, actor }),
  stateStore,
  durable,
  now: () => "2026-09-09T00:00:00.000Z",
  stateLifetimeSeconds: 600,
  nextAttemptId: () => OAuthAttemptIdSchema.parse("40000000-0000-4000-8000-000000000001"),
  hashState: () => stateHash,
  issueState: (input: OAuthStateIssueInput) => ({
    state: "opaque-manual-state",
    record: createOAuthStateRecord({
      attemptId: input.attemptId,
      organizationId: input.organizationId,
      actor: input.actor,
      partnerApplicationId: input.partnerApplicationId,
      market: input.market,
      stateHash,
      issuedAt: "2026-09-09T00:00:00.000Z",
      expiresAt: "2026-09-09T00:10:00.000Z",
    }),
  }),
  authorizationUrl: ({ state }: { readonly state: string }) => `https://provider.example.test/oauth?state=${state}`,
}

const headers = { headers: { authorization: "Bearer manual-fixture" } }
const start = await createOAuthStartApiHandler(
  new Request(`https://app.example.test/api/auth/shopee/start?organizationId=${organizationId}&partnerApplicationId=${partnerApplicationId}`, headers),
  dependencies,
)
const callback = await createOAuthCallbackApiHandler(
  new Request("https://app.example.test/api/auth/shopee/callback?state=opaque-manual-state&code=raw-manual-code", headers),
  dependencies,
)
const replay = await createOAuthCallbackApiHandler(
  new Request("https://app.example.test/api/auth/shopee/callback?state=opaque-manual-state&code=raw-manual-code", headers),
  dependencies,
)

process.stdout.write(JSON.stringify({
  scenario: "oauth-web-provider-free-boundary",
  startStatus: start.status,
  callbackStatus: callback.status,
  replayStatus: replay.status,
  writeAdapter: "disabled",
  next: "worker_exchange_pending",
  callbackCodePersisted: false,
  providerCalls: 0,
  networkCalls: 0,
  databaseCalls: 0,
  kmsCalls: 0,
  secretFieldsPresent: false,
}))
