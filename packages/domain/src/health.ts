export const SERVICE_NAMES = ["web", "worker"] as const

export type ServiceName = (typeof SERVICE_NAMES)[number]

export type DatabaseReadiness =
  | { readonly state: "missing"; readonly reason: "configuration_missing" }
  | { readonly state: "configured_unverified"; readonly reason: "connectivity_not_probed" }
  | { readonly state: "unavailable"; readonly reason: "connectivity_failed" }
  | { readonly state: "ready"; readonly reason: "probe_succeeded" }

export type HealthResponse = {
  readonly service: ServiceName
  readonly status: "ok"
}

export type ReadinessResponse = {
  readonly service: ServiceName
  readonly status: "ready" | "not_ready"
  readonly dependencies: {
    readonly database: DatabaseReadiness
  }
}
