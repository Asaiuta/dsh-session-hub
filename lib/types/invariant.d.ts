/**
 * Shared assertions for dsh-session-hub. Kept dependency-free so the
 * invariant entry stays a leaf module (mirrors the harness packages).
 */
export declare function invariant(condition: unknown, message: string): asserts condition;
