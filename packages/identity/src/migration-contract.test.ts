import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { describe, it } from "node:test"

const migration = readFileSync(
  new URL("../../../db/migrations/0001_identity.sql", import.meta.url),
  "utf8",
).replaceAll("\r\n", "\n")

describe("identity migration organization boundaries", () => {
  it("normalizes audit subject shops behind composite organization-scoped foreign keys", () => {
    // Given: the Phase 1 identity migration source.
    const childTableMatch = migration.match(
      /CREATE TABLE audit_event_shops \([\s\S]*?\n\);/,
    )

    // When: the migration contract is inspected without a database or credentials.
    assert.ok(childTableMatch)
    const childTable = childTableMatch[0]

    // Then: subject shops cannot be represented as an unscoped UUID array.
    assert.equal(migration.includes("subject_shop_ids"), false)
    assert.match(childTable, /PRIMARY KEY \(event_id, shop_id\)/)
    assert.match(
      childTable,
      /FOREIGN KEY \(event_id, organization_id\)\s+REFERENCES audit_events \(event_id, organization_id\)/,
    )
    assert.match(
      childTable,
      /FOREIGN KEY \(organization_id, shop_id\)\s+REFERENCES shop_connections \(organization_id, id\)/,
    )
    assert.match(migration, /UNIQUE \(event_id, organization_id\)/)
  })

  it("rejects non-authorization subjects and preserves append-only audit rows", () => {
    // Given: the child-table trigger and parent/child mutation guards.
    // When: the migration contract is inspected for hostile write paths.
    // Then: subject rows are authorization-only and neither table is mutable/deletable.
    assert.match(
      migration,
      /IF event_kind_value IS DISTINCT FROM 'authorization_decision'/,
    )
    assert.match(
      migration,
      /CREATE TRIGGER audit_event_shops_authorization_only\s+BEFORE INSERT ON audit_event_shops/,
    )
    assert.match(
      migration,
      /CREATE TRIGGER audit_events_no_update_or_delete\s+BEFORE UPDATE OR DELETE ON audit_events/,
    )
    assert.match(
      migration,
      /CREATE TRIGGER audit_event_shops_no_update_or_delete\s+BEFORE UPDATE OR DELETE ON audit_event_shops/,
    )
  })
})
