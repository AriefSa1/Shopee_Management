import { createHmac, timingSafeEqual } from "node:crypto"
import { z } from "zod"
import { IdentitySchema, OrganizationIdSchema } from "../../../packages/identity/src/model.ts"
import type { OAuthWebAuthContext } from "../../../packages/oauth/src/oauth-api.ts"

const SESSION_COOKIE = "shopee_internal_session"

const EnvironmentSchema = z
  .object({
    INTERNAL_ORGANIZATION_ID: OrganizationIdSchema,
    INTERNAL_AUTH_SUBJECT: z.string().trim().min(1).max(255),
    INTERNAL_LOGIN_TOKEN: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
    WEB_SESSION_SECRET: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
    WEB_SESSION_LIFETIME_SECONDS: z.coerce.number().int().min(300).max(2_592_000).default(2_592_000),
    PUBLIC_BASE_URL: z.string().url(),
  })
  .strict()

const LoginSchema = z
  .object({
    loginToken: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  })
  .strict()

const SessionPayloadSchema = z
  .object({
    version: z.literal(1),
    organizationId: OrganizationIdSchema,
    actor: IdentitySchema,
    expiresAt: z.number().int().positive(),
  })
  .strict()
  .readonly()

export type InternalSessionConfig = {
  readonly organizationId: ReturnType<typeof OrganizationIdSchema.parse>
  readonly actor: ReturnType<typeof IdentitySchema.parse>
  readonly loginToken: Buffer
  readonly sessionSecret: Buffer
  readonly lifetimeSeconds: number
}

export type InternalSessionService = {
  readonly authenticate: (request: Request) => OAuthWebAuthContext | null
  readonly login: (request: Request) => Promise<Response>
  readonly logout: () => Response
}

export class InternalSessionConfigurationError extends Error {
  readonly name = "InternalSessionConfigurationError"
  readonly fieldNames: readonly string[]

  constructor(fieldNames: readonly string[]) {
    super("Internal operator session configuration is invalid")
    this.fieldNames = fieldNames
  }
}

export function parseInternalSessionConfig(
  environment: Readonly<Record<string, string | undefined>>,
): InternalSessionConfig {
  const parsed = EnvironmentSchema.safeParse({
    INTERNAL_ORGANIZATION_ID: environment["INTERNAL_ORGANIZATION_ID"],
    INTERNAL_AUTH_SUBJECT: environment["INTERNAL_AUTH_SUBJECT"],
    INTERNAL_LOGIN_TOKEN: environment["INTERNAL_LOGIN_TOKEN"],
    WEB_SESSION_SECRET: environment["WEB_SESSION_SECRET"],
    WEB_SESSION_LIFETIME_SECONDS: environment["WEB_SESSION_LIFETIME_SECONDS"],
    PUBLIC_BASE_URL: environment["PUBLIC_BASE_URL"],
  })
  if (!parsed.success) {
    throw new InternalSessionConfigurationError([
      ...new Set(parsed.error.issues.map((issue) => String(issue.path[0] ?? "environment"))),
    ])
  }
  const baseUrl = new URL(parsed.data.PUBLIC_BASE_URL)
  if (baseUrl.protocol !== "https:" || baseUrl.username !== "" || baseUrl.password !== "") {
    throw new InternalSessionConfigurationError(["PUBLIC_BASE_URL"])
  }
  const loginToken = Buffer.from(parsed.data.INTERNAL_LOGIN_TOKEN, "base64url")
  const sessionSecret = Buffer.from(parsed.data.WEB_SESSION_SECRET, "base64url")
  if (
    loginToken.byteLength !== 32 ||
    sessionSecret.byteLength !== 32 ||
    loginToken.toString("base64url") !== parsed.data.INTERNAL_LOGIN_TOKEN ||
    sessionSecret.toString("base64url") !== parsed.data.WEB_SESSION_SECRET
  ) {
    throw new InternalSessionConfigurationError(["INTERNAL_LOGIN_TOKEN", "WEB_SESSION_SECRET"])
  }
  return {
    organizationId: parsed.data.INTERNAL_ORGANIZATION_ID,
    actor: IdentitySchema.parse({
      issuer: new URL("/internal-auth", baseUrl).toString().replace(/\/$/u, ""),
      subject: parsed.data.INTERNAL_AUTH_SUBJECT,
    }),
    loginToken,
    sessionSecret,
    lifetimeSeconds: parsed.data.WEB_SESSION_LIFETIME_SECONDS,
  }
}

export function createInternalSessionService(
  config: InternalSessionConfig,
  now: () => number = Date.now,
): InternalSessionService {
  return {
    authenticate(request): OAuthWebAuthContext | null {
      const token = readCookie(request.headers.get("cookie"), SESSION_COOKIE)
      if (token === undefined) return null
      const [encodedPayload, signature, extra] = token.split(".")
      if (encodedPayload === undefined || signature === undefined || extra !== undefined)
        return null
      const expected = createHmac("sha256", config.sessionSecret).update(encodedPayload).digest()
      const observed = Buffer.from(signature, "base64url")
      if (observed.byteLength !== expected.byteLength || !timingSafeEqual(observed, expected))
        return null
      const payload = parsePayload(encodedPayload)
      if (payload === null || payload.expiresAt <= Math.floor(now() / 1_000)) return null
      if (
        payload.organizationId !== config.organizationId ||
        payload.actor.issuer !== config.actor.issuer ||
        payload.actor.subject !== config.actor.subject
      )
        return null
      return { organizationId: payload.organizationId, actor: payload.actor }
    },
    async login(request): Promise<Response> {
      const input = await parseLogin(request)
      if (input === null)
        return Response.json({ error: { code: "invalid_login_request" } }, { status: 400 })
      const observed = Buffer.from(input.loginToken, "base64url")
      if (
        observed.byteLength !== config.loginToken.byteLength ||
        !timingSafeEqual(observed, config.loginToken)
      ) {
        return Response.json({ error: { code: "authentication_failed" } }, { status: 401 })
      }
      const expiresAt = Math.floor(now() / 1_000) + config.lifetimeSeconds
      const encodedPayload = Buffer.from(
        JSON.stringify({
          version: 1,
          organizationId: config.organizationId,
          actor: config.actor,
          expiresAt,
        }),
      ).toString("base64url")
      const signature = createHmac("sha256", config.sessionSecret)
        .update(encodedPayload)
        .digest("base64url")
      return new Response(null, {
        status: 204,
        headers: {
          "set-cookie": `${SESSION_COOKIE}=${encodedPayload}.${signature}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${config.lifetimeSeconds}`,
          "cache-control": "no-store",
        },
      })
    },
    logout(): Response {
      return new Response(null, {
        status: 204,
        headers: {
          "set-cookie": `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`,
          "cache-control": "no-store",
        },
      })
    },
  }
}

async function parseLogin(request: Request): Promise<z.infer<typeof LoginSchema> | null> {
  try {
    const parsed = LoginSchema.safeParse(await request.json())
    return parsed.success ? parsed.data : null
  } catch (error) {
    if (error instanceof SyntaxError) return null
    throw error
  }
}

function parsePayload(encodedPayload: string): z.infer<typeof SessionPayloadSchema> | null {
  try {
    const parsed = SessionPayloadSchema.safeParse(
      JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8")),
    )
    return parsed.success ? parsed.data : null
  } catch (error) {
    if (error instanceof SyntaxError) return null
    throw error
  }
}

function readCookie(header: string | null, name: string): string | undefined {
  if (header === null) return undefined
  for (const entry of header.split(";")) {
    const separator = entry.indexOf("=")
    if (separator < 1) continue
    if (entry.slice(0, separator).trim() === name) return entry.slice(separator + 1).trim()
  }
  return undefined
}
