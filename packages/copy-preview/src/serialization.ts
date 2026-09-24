import { createHash } from "node:crypto"
import { CopyPreviewHashSchema, type CopyPreviewHash } from "./model.ts"

export function hashCopyPreviewValue(value: unknown): CopyPreviewHash {
  return CopyPreviewHashSchema.parse(createHash("sha256").update(canonicalize(value)).digest("hex"))
}

function canonicalize(value: unknown): string {
  if (value === null) return "null"
  switch (typeof value) {
    case "boolean":
    case "number":
    case "string":
      return JSON.stringify(value)
    case "bigint":
    case "symbol":
    case "function":
    case "undefined":
      throw new CopyPreviewSerializationError("unsupported_preview_value")
    case "object":
      if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`
      if (value === null) throw new CopyPreviewSerializationError("unsupported_preview_value")
      const record = value as Readonly<Record<string, unknown>>
      return `{${Object.keys(record)
        .sort((left, right) => left.localeCompare(right))
        .map((key) => `${JSON.stringify(key)}:${canonicalize(record[key])}`)
        .join(",")}}`
    default:
      throw new CopyPreviewSerializationError("unsupported_preview_value")
  }
}

export class CopyPreviewSerializationError extends Error {
  readonly name = "CopyPreviewSerializationError"
  readonly code: "unsupported_preview_value"

  constructor(code: "unsupported_preview_value") {
    super("Copy preview hashing only supports JSON-safe values")
    this.code = code
  }
}
