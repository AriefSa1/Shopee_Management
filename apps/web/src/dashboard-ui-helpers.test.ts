import assert from "node:assert/strict"
import test from "node:test"
import { storeDisplayName, storeInitials } from "./dashboard-ui-helpers.ts"

test("renders a connected store when provider omits its display name", () => {
  const name = storeDisplayName({ externalShopId: "1819834906" })
  assert.equal(name, "Toko 1819834906")
  assert.equal(storeInitials(name), "T1")
})

test("keeps a provider display name when available", () => {
  assert.equal(storeDisplayName({ name: "Toko Utama", externalShopId: "1819834906" }), "Toko Utama")
  assert.equal(storeInitials("Toko Utama"), "TU")
})
