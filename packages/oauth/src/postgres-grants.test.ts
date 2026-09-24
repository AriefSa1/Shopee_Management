import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { describe, it } from "node:test"
import { OrganizationIdSchema, ShopIdSchema } from "../../identity/src/model.ts"
import { AuthorizationGrantFixtureSchema, AuthorizationGrantIdSchema } from "./model.ts"
import { FakeOAuthGrantPostgresExecutor } from "./postgres-grants.fake.ts"
import { PostgresOAuthGrantRepository } from "./postgres-grants.ts"

const organizationId = OrganizationIdSchema.parse("10000000-0000-4000-8000-000000000001")
const otherOrganizationId = OrganizationIdSchema.parse("10000000-0000-4000-8000-000000000009")
const shopA = ShopIdSchema.parse("30000000-0000-4000-8000-000000000001")
const shopB = ShopIdSchema.parse("30000000-0000-4000-8000-000000000002")
const grantId = AuthorizationGrantIdSchema.parse("50000000-0000-4000-8000-000000000001")
const grant = AuthorizationGrantFixtureSchema.parse({
  grantId,
  organizationId,
  partnerApplicationId: "partner-app-fixture",
  grantKind: "main_account",
  grantedAt: "2026-09-10T00:00:00.000Z",
  subjects: [{
    credentialSubjectId: "60000000-0000-4000-8000-000000000001",
    revision: 1,
    keyVersion: 2,
    shopIds: [shopA, shopB],
  }],
})

describe("PostgreSQL OAuth grant persistence contract", () => {
  it("round-trips a multi-shop grant atomically", async () => {
    const executor = new FakeOAuthGrantPostgresExecutor()
    const repository = new PostgresOAuthGrantRepository(executor)
    await repository.saveGrant(grant)
    assert.deepEqual(await repository.getGrant(organizationId, grantId), grant)
    assert.equal(executor.statementsFor("oauth.grant.insert").length, 1)
    assert.equal(executor.statementsFor("oauth.grant.subject.insert").length, 1)
    assert.equal(executor.statementsFor("oauth.grant.subject.shop.insert").length, 2)
  })

  it("does not cross-read a grant from another organization", async () => {
    const executor = new FakeOAuthGrantPostgresExecutor()
    const repository = new PostgresOAuthGrantRepository(executor)
    await repository.saveGrant(grant)
    assert.equal(await repository.getGrant(otherOrganizationId, grantId), undefined)
  })

  it("preserves independent credential subjects and shop bindings", async () => {
    const executor = new FakeOAuthGrantPostgresExecutor()
    const repository = new PostgresOAuthGrantRepository(executor)
    const independent = AuthorizationGrantFixtureSchema.parse({
      ...grant,
      subjects: [
        { credentialSubjectId: "60000000-0000-4000-8000-000000000011", revision: 1, keyVersion: 1, shopIds: [shopA] },
        { credentialSubjectId: "60000000-0000-4000-8000-000000000012", revision: 1, keyVersion: 1, shopIds: [shopB] },
      ],
    })
    await repository.saveGrant(independent)
    const loaded = await repository.getGrant(organizationId, grantId)
    assert.deepEqual(loaded?.subjects.map((subject) => subject.shopIds), [[shopA], [shopB]])
  })

  it("keeps the migration composite scopes and excludes token columns", () => {
    const migration = readFileSync(new URL("../../../db/migrations/0012_oauth_grants.sql", import.meta.url), "utf8")
    assert.match(migration, /PRIMARY KEY \(organization_id, grant_id\)/)
    assert.match(migration, /FOREIGN KEY \(organization_id, shop_id\)/)
    assert.match(migration, /oauth_grant_subject_shops/)
    assert.doesNotMatch(migration, /access_token|refresh_token|callback_code|partner_key/i)
  })
})
