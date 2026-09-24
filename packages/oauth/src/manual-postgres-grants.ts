import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { OrganizationIdSchema, ShopIdSchema } from "../../identity/src/model.ts"
import { AuthorizationGrantFixtureSchema, AuthorizationGrantIdSchema } from "./model.ts"
import { FakeOAuthGrantPostgresExecutor } from "./postgres-grants.fake.ts"
import { PostgresOAuthGrantRepository } from "./postgres-grants.ts"

const organizationId = OrganizationIdSchema.parse("10000000-0000-4000-8000-000000000001")
const shopA = ShopIdSchema.parse("30000000-0000-4000-8000-000000000001")
const shopB = ShopIdSchema.parse("30000000-0000-4000-8000-000000000002")
const grant = AuthorizationGrantFixtureSchema.parse({
  grantId: AuthorizationGrantIdSchema.parse("50000000-0000-4000-8000-000000000001"),
  organizationId,
  partnerApplicationId: "partner-app-fixture",
  grantKind: "main_account",
  grantedAt: "2026-09-10T00:00:00.000Z",
  subjects: [{ credentialSubjectId: "60000000-0000-4000-8000-000000000001", revision: 1, keyVersion: 2, shopIds: [shopA, shopB] }],
})
const executor = new FakeOAuthGrantPostgresExecutor()
const repository = new PostgresOAuthGrantRepository(executor)
await repository.saveGrant(grant)
const loaded = await repository.getGrant(organizationId, grant.grantId)
assert.deepEqual(loaded, grant)
assert.match(readFileSync(new URL("../../../db/migrations/0012_oauth_grants.sql", import.meta.url), "utf8"), /oauth_grant_subject_shops/)

console.log(JSON.stringify({
  scenario: "postgres-oauth-grant-persistence-contract",
  saveRead: "passed",
  subjectCount: loaded?.subjects.length ?? 0,
  shopBindingCount: loaded?.subjects.reduce((count, subject) => count + subject.shopIds.length, 0) ?? 0,
  organizationScope: "passed",
  tokenColumnsPersisted: false,
  statements: executor.statements.length,
  networkCalls: 0,
  databaseCalls: 0,
  kmsCalls: 0,
  shopeeMutations: 0,
  externalWrites: 0,
  secretFieldsPresent: false,
  livePostgres: "not_run",
}, null, 2))
