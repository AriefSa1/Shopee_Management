export type { KmsEnvelopeBackend } from "./credential-encryption.ts"
export {
  createRuntimeBoundKmsEnvelopeCodec,
  KmsEnvelopeAccessError,
} from "./credential-encryption.ts"
export type {
  DurableCredentialSubject,
  EncryptedCredentialEnvelope,
  KmsEncryptionContext,
  KmsEnvelopeCodec,
  KmsMarket,
  OAuthAttemptRecord,
  OAuthDurableRepository,
  RefreshOutcome,
  RefreshPersistenceRequest,
} from "./durable-contracts.ts"
export {
  InMemoryOAuthDurableRepository,
  KmsEncryptionContextSchema,
  KmsMarketSchema,
  OAuthReauthenticationRequiredError,
} from "./durable-contracts.ts"
export type { ShopBindingDecision, ShopBindingRequest } from "./grants.ts"
export { authorizeShopCredentialBinding, normalizeAuthorizationGrant } from "./grants.ts"
export type {
  AuthorizationGrant,
  AuthorizationGrantFixture,
  AuthorizationGrantId,
  CallbackCode,
  CredentialSubject,
  CredentialSubjectId,
  OAuthAttemptId,
  OAuthCallbackClaim,
  OAuthMarket,
  OAuthRefreshToken,
  OAuthStateHash,
  OAuthStateRecord,
  OfficialOAuthTokenExchangeProvider,
  PartnerApplicationId,
  ShopeeShopId,
  SafeOAuthAttempt,
  ShopCredentialBinding,
  WorkerExchangeEvidence,
} from "./model.ts"
export {
  AuthorizationGrantFixtureSchema,
  AuthorizationGrantIdSchema,
  CallbackCodeSchema,
  CredentialSubjectIdSchema,
  OAuthAttemptIdSchema,
  OAuthMarketSchema,
  OAuthRefreshTokenSchema,
  OAuthStateHashSchema,
  PartnerApplicationIdSchema,
  ShopeeShopIdSchema,
  WorkerExchangeEvidenceSchema,
} from "./model.ts"
export type {
  OAuthStateIssue,
  OAuthStateIssueInput,
  OAuthWebApiDependencies,
  OAuthWebAuthContext,
} from "./oauth-api.ts"
export {
  createOAuthCallbackApiHandler,
  createOAuthStartApiHandler,
} from "./oauth-api.ts"
export type {
  OAuthExchangeProjection,
  OAuthExchangeProjectionInput,
} from "./oauth-callback-handoff.ts"
export { createOAuthExchangeCommand } from "./oauth-callback-handoff.ts"
export type { OAuthGrantPersistenceError } from "./postgres-grants.ts"
export { PostgresOAuthGrantRepository } from "./postgres-grants.ts"
export type {
  OAuthCallbackHandoffOptions,
  OAuthCallbackHandoffResult,
} from "./postgres-oauth-callback-handoff.ts"
export { PostgresOAuthCallbackHandoff } from "./postgres-oauth-callback-handoff.ts"
export type {
  OAuthExchangeClaimInput,
  OAuthExchangeLease,
} from "./postgres-oauth-exchange-queue.ts"
export {
  OAuthExchangeLeaseError,
  PostgresOAuthExchangeQueue,
} from "./postgres-oauth-exchange-queue.ts"
export { PostgresOAuthStateRepository } from "./postgres-state.ts"
export type { PostgresOAuthExchangeCommitterInput } from "./postgres-oauth-exchange-committer.ts"
export { PostgresOAuthExchangeCommitter, ShopeeOAuthExchangeCommitError } from "./postgres-oauth-exchange-committer.ts"
export type { OAuthShopConnection } from "./postgres-shop-connection-resolver.ts"
export {
  OAuthShopConnectionResolutionError,
  PostgresOAuthShopConnectionResolver,
} from "./postgres-shop-connection-resolver.ts"
export type { PostgresWorkerTokenRefreshRequest } from "./postgres-worker-refresh.ts"
export { executeWorkerOnlyPostgresCredentialRefresh } from "./postgres-worker-refresh.ts"
export type { CredentialRotationDecision, CredentialRotationRequest } from "./rotation.ts"
export { rotateCredentialSubject } from "./rotation.ts"
export type { CreateOAuthStateInput, OAuthStateClaimDecision, OAuthStateStore } from "./state.ts"
export {
  claimOAuthCallback,
  createOAuthStateRecord,
  InMemoryOAuthStateStore,
  parseOAuthCallbackInput,
  toSafeOAuthAttempt,
} from "./state.ts"
export type { WorkerTokenExchangeRequest } from "./worker-exchange.ts"
export {
  executeWorkerOnlyTokenExchange,
  executeWorkerOnlyTokenExchangeEvidence,
  toAuthorizationGrantFixture,
} from "./worker-exchange.ts"
export type {
  OAuthExchangeHandoff,
  WorkerHandoffExchangeDependencies,
} from "./worker-handoff-exchange.ts"
export { executeWorkerHandoffExchange } from "./worker-handoff-exchange.ts"
export type {
  OAuthExchangeFailureReason,
  OAuthExchangeWorkerInput,
  OAuthExchangeWorkerLoopDependencies,
  OAuthExchangeWorkerLoopInput,
  OAuthExchangeWorkerLoopResult,
  OAuthExchangeWorkerQueue,
  OAuthExchangeWorkerResult,
} from "./worker-handoff-runner.ts"
export {
  OAuthExchangeWorkerLoopError,
  runOAuthExchangeWorkerLoop,
  runOAuthExchangeWorkerOnce,
} from "./worker-handoff-runner.ts"
export type {
  OfficialOAuthTokenRefreshProvider,
  WorkerTokenRefreshDecision,
  WorkerTokenRefreshRequest,
} from "./worker-refresh.ts"
export { executeWorkerOnlyTokenRefresh, OAuthRefreshOutcomeUnknownError } from "./worker-refresh.ts"
