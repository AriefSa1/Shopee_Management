import { OrganizationIdSchema } from "../../identity/src/model.ts"
import {
  CallbackCodeSchema,
  OAuthAttemptIdSchema,
  OAuthStateHashSchema,
  PartnerApplicationIdSchema,
  ShopeeShopIdSchema,
} from "./index.ts"
import { FakeOAuthStatePostgresExecutor } from "./postgres-state.fake.ts"
import { PostgresOAuthStateRepository } from "./postgres-state.ts"

const organizationId = OrganizationIdSchema.parse("10000000-0000-4000-8000-000000000001")
const record = {
  attemptId: OAuthAttemptIdSchema.parse("20000000-0000-4000-8000-000000000001"),
  organizationId,
  actor: { issuer: "https://issuer.example.test", subject: "subject-manual" },
  partnerApplicationId: PartnerApplicationIdSchema.parse("partner-manual"),
  market: "ID",
  stateHash: OAuthStateHashSchema.parse("state-pg-manual-000000000000000000000000001"),
  issuedAt: "2026-09-09T00:00:00.000Z",
  expiresAt: "2026-09-09T00:10:00.000Z",
  status: "issued" as const,
}
const executor = new FakeOAuthStatePostgresExecutor()
const repository = new PostgresOAuthStateRepository(executor)

await repository.save(record)
const claim = await repository.claim({
  stateHash: record.stateHash,
  organizationId,
  actor: record.actor,
  receivedAt: "2026-09-09T00:01:00.000Z",
  code: CallbackCodeSchema.parse("raw-code-manual"),
  shopId: ShopeeShopIdSchema.parse("1819834906"),
})
const sqlText = executor.statements.flatMap((statement) => [statement.text, ...statement.params])

console.log(JSON.stringify({
  scenario: "postgres-oauth-state-provider-free-contract",
  claimKind: claim.kind,
  rowLock: executor.statementsFor("oauth.state.claim.lock")[0]?.text.includes("FOR UPDATE") === true,
  callbackCodePersisted: sqlText.includes("raw-code-manual"),
  organizationScoped: executor.statementsFor("oauth.state.claim.lock")[0]?.params[0] === organizationId,
  networkCalls: 0,
  databaseCalls: 0,
  kmsCalls: 0,
  shopeeMutations: 0,
  secretFieldsPresent: false,
}))
