import { createHash, randomBytes, randomUUID } from "node:crypto"
import { z } from "zod"
import type { PostgresExecutor, SqlRow } from "../../../packages/delivery/src/postgres-delivery.ts"
import { buildShopeeSellerAuthorizationUrl } from "../../../packages/integrations/src/shopee-authorization-url.ts"
import {
  createOAuthStateRecord,
  createRuntimeBoundKmsEnvelopeCodec,
  InMemoryOAuthDurableRepository,
  InMemoryOAuthStateStore,
  OAuthAttemptIdSchema,
  OAuthStateHashSchema,
  type OAuthWebApiDependencies,
  type OAuthWebAuthContext,
  PartnerApplicationIdSchema,
  PostgresOAuthCallbackHandoff,
  PostgresOAuthStateRepository,
} from "../../../packages/oauth/src/index.ts"
import { RUNTIME_POLICY_VERSION } from "../../../packages/runtime-boundaries/src/runtime-boundaries.ts"
import {
  createEnvironmentAesGcmEnvelopeBackend,
  parseWorkerCredentialEncryptionConfig,
  type WorkerCredentialEncryptionConfig,
} from "../../worker/src/adapters/environment-aes-gcm-envelope-backend.ts"
import type { InternalSessionService } from "./internal-session.ts"

const EnvironmentSchema = z
  .object({
    PUBLIC_BASE_URL: z.string().url(),
    SHOPEE_PARTNER_ID: z.string().regex(/^[1-9][0-9]*$/),
    SHOPEE_PARTNER_APPLICATION_ID: z.string().uuid(),
    CREDENTIAL_ENCRYPTION_KEY_VERSION: z.coerce.number().int().positive().default(1),
    OAUTH_STATE_LIFETIME_SECONDS: z.coerce.number().int().min(60).max(600).default(600),
  })
  .strict()

export type LiveOAuthWebConfig = {
  readonly publicBaseUrl: string
  readonly redirectUri: string
  readonly partnerId: string
  readonly partnerApplicationId: ReturnType<typeof PartnerApplicationIdSchema.parse>
  readonly credentialEncryptionKeyVersion: number
  readonly credentialEncryption: WorkerCredentialEncryptionConfig
  readonly stateLifetimeSeconds: number
}

export type LiveOAuthWebDependenciesInput = {
  readonly config: LiveOAuthWebConfig
  readonly executor: PostgresExecutor
  readonly session: InternalSessionService
}

export class LiveOAuthWebConfigurationError extends Error {
  readonly name = "LiveOAuthWebConfigurationError"
  readonly fieldNames: readonly string[]

  constructor(fieldNames: readonly string[]) {
    super("Live OAuth web configuration is invalid")
    this.fieldNames = fieldNames
  }
}

export function parseLiveOAuthWebConfig(
  environment: Readonly<Record<string, string | undefined>>,
): LiveOAuthWebConfig {
  const parsed = EnvironmentSchema.safeParse({
    PUBLIC_BASE_URL: environment["PUBLIC_BASE_URL"],
    SHOPEE_PARTNER_ID: environment["SHOPEE_PARTNER_ID"],
    SHOPEE_PARTNER_APPLICATION_ID: environment["SHOPEE_PARTNER_APPLICATION_ID"],
    CREDENTIAL_ENCRYPTION_KEY_VERSION: environment["CREDENTIAL_ENCRYPTION_KEY_VERSION"],
    OAUTH_STATE_LIFETIME_SECONDS: environment["OAUTH_STATE_LIFETIME_SECONDS"],
  })
  if (!parsed.success) {
    throw new LiveOAuthWebConfigurationError([
      ...new Set(parsed.error.issues.map((issue) => String(issue.path[0] ?? "environment"))),
    ])
  }
  const publicBaseUrl = new URL(parsed.data.PUBLIC_BASE_URL)
  if (
    publicBaseUrl.protocol !== "https:" ||
    publicBaseUrl.username !== "" ||
    publicBaseUrl.password !== "" ||
    publicBaseUrl.pathname !== "/" ||
    publicBaseUrl.search !== "" ||
    publicBaseUrl.hash !== ""
  ) {
    throw new LiveOAuthWebConfigurationError(["PUBLIC_BASE_URL"])
  }
  return {
    publicBaseUrl: publicBaseUrl.origin,
    redirectUri: new URL("/api/auth/shopee/callback", publicBaseUrl).toString(),
    partnerId: parsed.data.SHOPEE_PARTNER_ID,
    partnerApplicationId: PartnerApplicationIdSchema.parse(
      parsed.data.SHOPEE_PARTNER_APPLICATION_ID,
    ),
    credentialEncryptionKeyVersion: parsed.data.CREDENTIAL_ENCRYPTION_KEY_VERSION,
    credentialEncryption: parseWorkerCredentialEncryptionConfig(environment),
    stateLifetimeSeconds: parsed.data.OAUTH_STATE_LIFETIME_SECONDS,
  }
}

export function createLiveOAuthWebDependencies(
  input: LiveOAuthWebDependenciesInput,
): OAuthWebApiDependencies {
  const stateRepository = new PostgresOAuthStateRepository(input.executor)
  const codec = createRuntimeBoundKmsEnvelopeCodec({
    runtimeRole: "web",
    policyVersion: RUNTIME_POLICY_VERSION,
    backend: createEnvironmentAesGcmEnvelopeBackend(input.config.credentialEncryption),
  })
  const handoff = new PostgresOAuthCallbackHandoff(input.executor, codec, {
    keyVersion: input.config.credentialEncryptionKeyVersion,
    nextIds: () => ({ commandId: randomUUID(), eventId: randomUUID() }),
  })
  return {
    authenticate: input.session.authenticate,
    authorize: (request, context) => authorizeOwner(request, context, input),
    stateStore: new InMemoryOAuthStateStore([]),
    persistState: (record) => stateRepository.save(record),
    callbackHandoff: (callback) => handoff.accept(callback),
    durable: new InMemoryOAuthDurableRepository(),
    now: () => new Date().toISOString(),
    stateLifetimeSeconds: input.config.stateLifetimeSeconds,
    nextAttemptId: () => OAuthAttemptIdSchema.parse(randomUUID()),
    hashState: (state) =>
      OAuthStateHashSchema.parse(createHash("sha256").update(state).digest("hex")),
    issueState: (stateInput) => {
      const state = randomBytes(32).toString("base64url")
      return {
        state,
        record: createOAuthStateRecord(stateInput),
      }
    },
    authorizationUrl: ({ state }) =>
      buildShopeeSellerAuthorizationUrl({
        partnerId: input.config.partnerId,
        redirectUri: input.config.redirectUri,
        state,
      }),
  }
}

async function authorizeOwner(
  request: Request,
  context: OAuthWebAuthContext,
  input: LiveOAuthWebDependenciesInput,
): Promise<boolean> {
  if (new URL(request.url).pathname.endsWith("/start")) {
    const selectedPartnerApplication = new URL(request.url).searchParams.get("partnerApplicationId")
    if (selectedPartnerApplication !== input.config.partnerApplicationId) return false
  }
  const rows = await input.executor.query({
    name: "oauth.web.owner.authorize",
    text: `SELECT memberships.role
      FROM users
      INNER JOIN memberships ON memberships.user_id = users.id
      WHERE users.oidc_issuer = $1 AND users.oidc_subject = $2
        AND memberships.organization_id = $3
        AND memberships.status = 'active' AND memberships.role = 'owner'`,
    params: [context.actor.issuer, context.actor.subject, context.organizationId],
  })
  return rows.some((row) => isOwner(row))
}

function isOwner(row: SqlRow): boolean {
  return row["role"] === "owner"
}
