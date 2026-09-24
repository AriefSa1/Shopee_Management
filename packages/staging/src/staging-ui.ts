import { createStagingApiHandler, type StagingApiDependencies } from "./staging-api.ts"

export async function createStagingUiHandler(
  request: Request,
  dependencies: StagingApiDependencies,
): Promise<Response> {
  const apiResponse = await createStagingApiHandler(request, dependencies)
  const body = await apiResponse.json() as { readonly data?: Record<string, unknown>; readonly error?: Record<string, unknown> }
  const title = apiResponse.ok ? "Staging Read-only Alpha" : "Staging Alpha unavailable"
  const content = apiResponse.ok && body.data !== undefined
    ? renderWorkflow(body.data)
    : `<p role="alert">${escapeHtml(JSON.stringify(body.error ?? { code: "staging_unavailable" }))}</p>`
  return new Response(`<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title></head><body><main><h1>${escapeHtml(title)}</h1>${content}</main></body></html>`, {
    status: apiResponse.status,
    headers: { "content-type": "text/html; charset=utf-8" },
  })
}

function renderWorkflow(data: Record<string, unknown>): string {
  const writeGate = data["writeGate"] as Record<string, unknown> | undefined
  const holdControl = data["holdControl"] as Record<string, unknown> | undefined
  const rollbackControl = data["rollbackControl"] as Record<string, unknown> | undefined
  const environment = data["environment"]
  const shopId = data["shopId"]
  const mutationPolicy = data["mutationPolicy"]
  const allowedOperations = data["allowedOperations"]
  const blockedOperations = data["blockedOperations"]
  return `<p data-environment="${escapeHtml(String(environment ?? "unknown"))}">Environment: ${escapeHtml(String(environment ?? "unknown"))}</p><p>Shop: ${escapeHtml(String(shopId ?? "unknown"))}</p><p>Mutation policy: <strong>${escapeHtml(String(mutationPolicy ?? "blocked"))}</strong></p><section><h2>Write gate</h2><p>${escapeHtml(JSON.stringify(writeGate ?? {}))}</p></section><section><h2>Hold control</h2><p>${escapeHtml(JSON.stringify(holdControl ?? {}))}</p></section><section><h2>Rollback control</h2><p>${escapeHtml(JSON.stringify(rollbackControl ?? {}))}</p></section><section><h2>Allowed operations</h2><p>${escapeHtml(JSON.stringify(allowedOperations ?? []))}</p></section><section><h2>Blocked operations</h2><p>${escapeHtml(JSON.stringify(blockedOperations ?? []))}</p></section><p>Mutation controls are unavailable in read-only alpha.</p>`
}

function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;")
}
