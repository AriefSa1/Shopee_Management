import type { AuthorizationGrant, CredentialSubject, CredentialSubjectId } from "./model.ts"

export type CredentialRotationRequest = {
  readonly grant: AuthorizationGrant
  readonly credentialSubjectId: CredentialSubjectId
  readonly expectedRevision: number
  readonly outcome: "rotated" | "outcome_unknown"
  readonly keyVersion: number
}

export type CredentialRotationDecision =
  | { readonly kind: "rotated"; readonly subject: CredentialSubject }
  | { readonly kind: "reauth_required"; readonly reason: "rotation_outcome_unknown" }
  | {
      readonly kind: "denied"
      readonly reason: "credential_subject_not_found" | "stale_credential_revision"
    }

export function rotateCredentialSubject(
  request: CredentialRotationRequest,
): CredentialRotationDecision {
  const subject = request.grant.subjects.find(
    (candidate) => candidate.credentialSubjectId === request.credentialSubjectId,
  )
  if (subject === undefined) return { kind: "denied", reason: "credential_subject_not_found" }
  if (subject.revision !== request.expectedRevision) {
    return { kind: "denied", reason: "stale_credential_revision" }
  }
  switch (request.outcome) {
    case "rotated":
      return {
        kind: "rotated",
        subject: { ...subject, revision: subject.revision + 1, keyVersion: request.keyVersion },
      }
    case "outcome_unknown":
      return { kind: "reauth_required", reason: "rotation_outcome_unknown" }
    default:
      return assertNever(request.outcome)
  }
}

function assertNever(value: never): never {
  throw new TypeError(`Unhandled credential rotation outcome: ${String(value)}`)
}
