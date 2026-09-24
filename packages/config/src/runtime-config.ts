import { z } from "zod"

const APP_ENVIRONMENTS = ["development", "test", "production"] as const

const emptyToUndefined = (value: unknown): unknown => (value === "" ? undefined : value)

const runtimeEnvironmentSchema = z.object({
  APP_ENV: z.enum(APP_ENVIRONMENTS).default("development"),
  DATABASE_URL: z.preprocess(emptyToUndefined, z.string().url().optional()),
})

const webEnvironmentSchema = runtimeEnvironmentSchema.extend({
  WEB_HOST: z.string().min(1).default("127.0.0.1"),
  WEB_PORT: z.coerce.number().int().min(0).max(65_535).default(3000),
})

const workerEnvironmentSchema = runtimeEnvironmentSchema.extend({
  WORKER_HOST: z.string().min(1).default("127.0.0.1"),
  WORKER_PORT: z.coerce.number().int().min(0).max(65_535).default(3001),
})

const migrationEnvironmentSchema = runtimeEnvironmentSchema
const readonlySupportEnvironmentSchema = runtimeEnvironmentSchema

export const RUNTIME_MODES = ["web", "worker", "migration", "readonly-support"] as const
export type RuntimeMode = (typeof RUNTIME_MODES)[number]

export class ConfigValidationError extends Error {
  readonly name = "ConfigValidationError"
  readonly fieldNames: readonly string[]

  constructor(fieldNames: readonly string[]) {
    super(`Invalid or missing configuration: ${fieldNames.join(", ")}`)
    this.fieldNames = fieldNames
  }
}

export type WebConfig = {
  readonly service: "web"
  readonly appEnvironment: (typeof APP_ENVIRONMENTS)[number]
  readonly host: string
  readonly port: number
  readonly databaseUrl?: string
}

export type WorkerConfig = {
  readonly service: "worker"
  readonly appEnvironment: (typeof APP_ENVIRONMENTS)[number]
  readonly host: string
  readonly port: number
  readonly databaseUrl?: string
}

export type MigrationConfig = {
  readonly mode: "migration"
  readonly appEnvironment: (typeof APP_ENVIRONMENTS)[number]
  readonly databaseUrl: string
}

export type ReadonlySupportConfig = {
  readonly mode: "readonly-support"
  readonly appEnvironment: (typeof APP_ENVIRONMENTS)[number]
  readonly databaseUrl?: string
}

export type RuntimeConfig = WebConfig | WorkerConfig | MigrationConfig | ReadonlySupportConfig

function issueFieldNames(error: z.ZodError): readonly string[] {
  return [...new Set(error.issues.map((issue) => String(issue.path[0] ?? "environment")))]
}

function requireProductionDatabase(
  appEnvironment: (typeof APP_ENVIRONMENTS)[number],
  databaseUrl: string | undefined,
): void {
  if (appEnvironment === "production" && databaseUrl === undefined) {
    throw new ConfigValidationError(["DATABASE_URL"])
  }
}

export function parseWebConfig(environment: NodeJS.ProcessEnv): WebConfig {
  const result = webEnvironmentSchema.safeParse({
    APP_ENV: environment["APP_ENV"],
    DATABASE_URL: environment["DATABASE_URL"],
    WEB_HOST: environment["WEB_HOST"],
    WEB_PORT: environment["WEB_PORT"] ?? environment["PORT"],
  })
  if (!result.success) {
    throw new ConfigValidationError(issueFieldNames(result.error))
  }

  requireProductionDatabase(result.data.APP_ENV, result.data.DATABASE_URL)
  return {
    service: "web",
    appEnvironment: result.data.APP_ENV,
    host: result.data.WEB_HOST,
    port: result.data.WEB_PORT,
    ...(result.data.DATABASE_URL === undefined ? {} : { databaseUrl: result.data.DATABASE_URL }),
  }
}

export function parseWorkerConfig(environment: NodeJS.ProcessEnv): WorkerConfig {
  const result = workerEnvironmentSchema.safeParse({
    APP_ENV: environment["APP_ENV"],
    DATABASE_URL: environment["DATABASE_URL"],
    WORKER_HOST: environment["WORKER_HOST"],
    WORKER_PORT: environment["WORKER_PORT"],
  })
  if (!result.success) {
    throw new ConfigValidationError(issueFieldNames(result.error))
  }

  requireProductionDatabase(result.data.APP_ENV, result.data.DATABASE_URL)
  return {
    service: "worker",
    appEnvironment: result.data.APP_ENV,
    host: result.data.WORKER_HOST,
    port: result.data.WORKER_PORT,
    ...(result.data.DATABASE_URL === undefined ? {} : { databaseUrl: result.data.DATABASE_URL }),
  }
}

export function parseMigrationConfig(environment: NodeJS.ProcessEnv): MigrationConfig {
  const result = migrationEnvironmentSchema.safeParse({
    APP_ENV: environment["APP_ENV"],
    DATABASE_URL: environment["DATABASE_URL"],
  })
  if (!result.success) {
    throw new ConfigValidationError(issueFieldNames(result.error))
  }
  if (result.data.DATABASE_URL === undefined) {
    throw new ConfigValidationError(["DATABASE_URL"])
  }
  return {
    mode: "migration",
    appEnvironment: result.data.APP_ENV,
    databaseUrl: result.data.DATABASE_URL,
  }
}

export function parseReadonlySupportConfig(environment: NodeJS.ProcessEnv): ReadonlySupportConfig {
  const result = readonlySupportEnvironmentSchema.safeParse({
    APP_ENV: environment["APP_ENV"],
    DATABASE_URL: environment["DATABASE_URL"],
  })
  if (!result.success) {
    throw new ConfigValidationError(issueFieldNames(result.error))
  }
  requireProductionDatabase(result.data.APP_ENV, result.data.DATABASE_URL)
  return {
    mode: "readonly-support",
    appEnvironment: result.data.APP_ENV,
    ...(result.data.DATABASE_URL === undefined ? {} : { databaseUrl: result.data.DATABASE_URL }),
  }
}

export function parseRuntimeConfig(
  mode: RuntimeMode,
  environment: NodeJS.ProcessEnv,
): RuntimeConfig {
  switch (mode) {
    case "web":
      return parseWebConfig(environment)
    case "worker":
      return parseWorkerConfig(environment)
    case "migration":
      return parseMigrationConfig(environment)
    case "readonly-support":
      return parseReadonlySupportConfig(environment)
    default:
      return assertNever(mode)
  }
}

export type SafeConfigurationDiagnostics =
  | { readonly mode: RuntimeMode; readonly status: "valid"; readonly fieldNames: readonly [] }
  | {
      readonly mode: RuntimeMode
      readonly status: "invalid"
      readonly fieldNames: readonly string[]
    }

export function getSafeConfigurationDiagnostics(
  mode: RuntimeMode,
  environment: NodeJS.ProcessEnv,
): SafeConfigurationDiagnostics {
  try {
    parseRuntimeConfig(mode, environment)
    return { mode, status: "valid", fieldNames: [] }
  } catch (error) {
    if (error instanceof ConfigValidationError) {
      const productionDatabaseMissing =
        environment["APP_ENV"] === "production" &&
        emptyToUndefined(environment["DATABASE_URL"]) === undefined
      const fieldNames = productionDatabaseMissing
        ? [...new Set(["DATABASE_URL", ...error.fieldNames])]
        : error.fieldNames
      return { mode, status: "invalid", fieldNames }
    }
    throw error
  }
}

function assertNever(value: never): never {
  throw new Error(`Unsupported runtime mode: ${String(value)}`)
}
