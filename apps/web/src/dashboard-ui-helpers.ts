export function storeDisplayName(store: { readonly name?: unknown; readonly externalShopId?: unknown }): string {
  if (typeof store.name === "string" && store.name.trim().length > 0) return store.name.trim()
  if (typeof store.externalShopId === "string" && store.externalShopId.trim().length > 0) return `Toko ${store.externalShopId.trim()}`
  return "Toko terhubung"
}

export function storeInitials(name: string): string {
  const initials = name
    .split(/\s+/u)
    .filter((part) => part.length > 0)
    .map((part) => part[0] ?? "")
    .slice(0, 2)
    .join("")
    .toUpperCase()
  return initials || "T"
}
