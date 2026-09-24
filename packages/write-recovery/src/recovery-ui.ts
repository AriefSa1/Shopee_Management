import { createWriteRecoveryApiHandler, type WriteRecoveryApiDependencies } from "./recovery-api.ts"

export async function createWriteRecoveryUiHandler(
  request: Request,
  dependencies: WriteRecoveryApiDependencies,
): Promise<Response> {
  const apiRequest = request.method === "POST"
    ? await buildResolveApiRequest(request)
    : new Request(request.url, { method: "GET", headers: request.headers })
  const apiResponse = await createWriteRecoveryApiHandler(apiRequest, dependencies)
  const payload = await apiResponse.json() as unknown
  return new Response(renderRecoveryPage(payload), {
    status: apiResponse.status,
    headers: { "content-type": "text/html; charset=utf-8" },
  })
}

async function buildResolveApiRequest(request: Request): Promise<Request> {
  let form: FormData
  try {
    form = await request.formData()
  } catch {
    return new Request(request.url, { method: "POST", headers: { authorization: request.headers.get("authorization") ?? "" }, body: "{" })
  }
  const organizationId = String(form.get("organizationId") ?? "")
  const operationAttemptId = String(form.get("operationAttemptId") ?? "")
  const kind = String(form.get("decision") ?? "")
  const decision = kind === "reauthenticate"
    ? { kind }
    : kind === "mark_failed"
      ? { kind, reason: String(form.get("reason") ?? "") }
      : { kind, providerReference: String(form.get("providerReference") ?? "") }
  return new Request(request.url, {
    method: "POST",
    headers: { authorization: request.headers.get("authorization") ?? "", "content-type": "application/json" },
    body: JSON.stringify({ organizationId, operationAttemptId, decision }),
  })
}

function renderRecoveryPage(payload: unknown): string {
  const page = payload as {
    readonly data?: {
      readonly organizationId?: string
      readonly attempts?: readonly Record<string, unknown>[]
      readonly canResolve?: boolean
      readonly attempt?: Record<string, unknown>
      readonly operatorId?: string
    }
    readonly error?: { readonly code?: unknown; readonly retryable?: unknown }
  }
  const title = "Shopee write recovery"
  const error = page.error
  if (error !== undefined) {
    return layout(title, `<main><h1>${title}</h1><p role="alert">Recovery request failed: ${escapeHtml(String(error.code ?? "unknown"))}</p></main>`)
  }
  const data = page.data ?? {}
  const attempts = data.attempts ?? (data.attempt === undefined ? [] : [data.attempt])
  const forms = attempts.map((attempt) => renderAttempt(attempt, data.organizationId ?? "", data.canResolve === true)).join("")
  const status = data.attempt === undefined ? "Outcome-unknown attempts" : "Recovery decision recorded"
  return layout(title, `<main><h1>${title}</h1><p>${escapeHtml(status)}</p><section>${forms || "<p>No unresolved outcome-unknown attempts.</p>"}</section></main>`)
}

function renderAttempt(attempt: Record<string, unknown>, organizationId: string, canResolve: boolean): string {
  const operationAttemptId = escapeHtml(String(attempt["operationAttemptId"] ?? ""))
  const state = escapeHtml(String(attempt["state"] ?? ""))
  const shopId = escapeHtml(String(attempt["destinationShopId"] ?? ""))
  const step = escapeHtml(String(attempt["step"] ?? ""))
  const reason = attempt["outcomeReason"] === undefined ? "" : `<p>Reason ${escapeHtml(String(attempt["outcomeReason"]))}</p>`
  if (!canResolve) return `<article><h2>${step}</h2><p>Attempt ${operationAttemptId}</p><p>Shop ${shopId}</p><p>State ${state}</p>${reason}<p>Operator resolution unavailable.</p></article>`
  return `<article><h2>${step}</h2><p>Attempt ${operationAttemptId}</p><p>Shop ${shopId}</p><p>State ${state}</p>${reason}<form method="post"><input type="hidden" name="organizationId" value="${escapeHtml(organizationId)}"><input type="hidden" name="operationAttemptId" value="${operationAttemptId}"><label>Decision <select name="decision"><option value="reauthenticate">Reauthenticate</option><option value="mark_failed">Mark failed</option><option value="confirm_succeeded">Confirm succeeded</option></select></label><label>Reason <input name="reason" maxlength="255"></label><label>Provider reference <input name="providerReference" maxlength="255"></label><button type="submit">Resolve</button></form></article>`
}

function layout(title: string, content: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title></head><body>${content}</body></html>`
}

function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;")
}
