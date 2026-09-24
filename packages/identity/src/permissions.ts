export const PERMISSIONS = [
  "read_catalog_analytics_status",
  "create_edit_validate_preview",
  "confirm_publish",
  "manual_sync",
  "manage_shop_connections",
  "manage_memberships_roles_settings",
  "read_full_audit_export",
  "read_safe_audit",
  "replay_dlq_recovery",
] as const

export type Permission = (typeof PERMISSIONS)[number]

export function roleAllows(
  role: "owner" | "admin" | "staff",
  permission: Permission,
  recoveryApproval: boolean,
): boolean {
  switch (permission) {
    case "read_catalog_analytics_status":
    case "create_edit_validate_preview":
      return true
    case "confirm_publish":
    case "manual_sync":
      return role === "owner" || role === "admin"
    case "manage_shop_connections":
    case "manage_memberships_roles_settings":
    case "read_full_audit_export":
      return role === "owner"
    case "read_safe_audit":
      return role === "owner" || role === "admin"
    case "replay_dlq_recovery":
      return role === "owner" || (role === "admin" && recoveryApproval)
    default:
      return assertNever(permission)
  }
}

function assertNever(value: never): never {
  throw new TypeError(`Unhandled permission: ${String(value)}`)
}
