export type SecretScanInput = {
  readonly path: string
  readonly source: string
}

export type SecretScanRule = "runtime_env_access" | "credential_identifier"

export type SecretScanFinding = {
  readonly path: string
  readonly rule: SecretScanRule
}

const RUNTIME_ENV_ACCESS = /\bprocess\.env\b/u
const CREDENTIAL_IDENTIFIER = /\b(access_token|refresh_token|partner_key|client_secret|authorization|cookie)\b/iu

export function scanSecretExposure(inputs: readonly SecretScanInput[]): readonly SecretScanFinding[] {
  return inputs.flatMap((input) => {
    const findings: SecretScanFinding[] = []
    if (RUNTIME_ENV_ACCESS.test(input.source)) {
      findings.push({ path: input.path, rule: "runtime_env_access" })
    }
    if (CREDENTIAL_IDENTIFIER.test(input.source)) {
      findings.push({ path: input.path, rule: "credential_identifier" })
    }
    return findings
  })
}
