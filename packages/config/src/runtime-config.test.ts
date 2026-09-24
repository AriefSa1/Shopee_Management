import assert from "node:assert/strict"
import { describe, it } from "node:test"
import {
  ConfigValidationError,
  getSafeConfigurationDiagnostics,
  parseMigrationConfig,
  parseReadonlySupportConfig,
  parseWebConfig,
  parseWorkerConfig,
} from "./runtime-config.ts"

describe("runtime configuration", () => {
  it("rejects missing production configuration without exposing environment values", () => {
    // Given: production input with a secret canary but no database configuration.
    const secretCanary = "must-never-appear-in-errors"
    const environment = {
      APP_ENV: "production",
      SHOPEE_PARTNER_KEY: secretCanary,
    }

    // When: the worker boundary parses it.
    const action = (): void => {
      parseWorkerConfig(environment)
    }

    // Then: it fails closed, names the missing field, and does not expose the canary.
    assert.throws(action, ConfigValidationError)
    assert.throws(action, /DATABASE_URL/)
    assert.doesNotThrow(() => {
      try {
        action()
      } catch (error) {
        assert.ok(error instanceof Error)
        assert.equal(error.message.includes(secretCanary), false)
      }
    })
  })

  it("rejects malformed port input using field names rather than values", () => {
    // Given: an invalid worker port value.
    const malformedValue = "not-a-port-secret-canary"

    // When: the worker boundary parses it.
    const action = (): void => {
      parseWorkerConfig({ WORKER_PORT: malformedValue })
    }

    // Then: the field is identified without reflecting the malformed value.
    assert.throws(action, /WORKER_PORT/)
    assert.doesNotThrow(() => {
      try {
        action()
      } catch (error) {
        assert.ok(error instanceof Error)
        assert.equal(error.message.includes(malformedValue), false)
      }
    })
  })

  it("does not include worker-only Shopee secrets in web configuration", () => {
    // Given: a process environment containing a secret canary.
    const secretCanary = "worker-only-secret-canary"

    // When: web configuration is parsed.
    const config = parseWebConfig({ SHOPEE_PARTNER_KEY: secretCanary })

    // Then: the web result contains only its allowlisted server runtime fields.
    assert.equal(JSON.stringify(config).includes(secretCanary), false)
    assert.deepEqual(Object.keys(config), ["service", "appEnvironment", "host", "port"])
  })

  it("uses the platform port for a hosted web process when WEB_PORT is absent", () => {
    // Given: a managed hosting runtime that supplies only the conventional PORT variable.
    const environment = {
      APP_ENV: "production",
      DATABASE_URL: "https://db.example.test",
      PORT: "4310",
    }

    // When: the web process configuration is parsed without a dedicated WEB_PORT.
    const config = parseWebConfig(environment)

    // Then: the managed platform port is used without exposing any environment values.
    assert.equal(config.port, 4310)
  })

  it("separates migration and readonly-support configuration modes", () => {
    const migration = parseMigrationConfig({
      APP_ENV: "test",
      DATABASE_URL: "https://db.example.test",
    })
    const readonlySupport = parseReadonlySupportConfig({ APP_ENV: "test" })

    assert.equal(migration.mode, "migration")
    assert.equal(migration.databaseUrl, "https://db.example.test")
    assert.equal(readonlySupport.mode, "readonly-support")
    assert.equal("databaseUrl" in readonlySupport, false)
    assert.throws(() => parseMigrationConfig({ APP_ENV: "test" }), /DATABASE_URL/)
  })

  it("returns safe diagnostics containing field names only", () => {
    const secretCanary = "diagnostic-secret-canary"

    const diagnostics = getSafeConfigurationDiagnostics("worker", {
      APP_ENV: "production",
      WORKER_PORT: "not-a-port",
      SHOPEE_PARTNER_KEY: secretCanary,
    })

    assert.deepEqual(diagnostics, {
      mode: "worker",
      status: "invalid",
      fieldNames: ["DATABASE_URL", "WORKER_PORT"],
    })
    assert.equal(JSON.stringify(diagnostics).includes(secretCanary), false)
  })
})
