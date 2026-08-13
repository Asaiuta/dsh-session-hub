/**
 * Shared assertions for dsh-session-hub. Kept dependency-free so the
 * invariant entry stays a leaf module (mirrors the harness packages).
 */

export function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`dsh-session-hub: ${message}`)
}