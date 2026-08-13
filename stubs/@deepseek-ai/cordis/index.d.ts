/**
 * Typecheck stubs for @deepseek-ai/cordis — the subset of the real Cordis
 * surface dsh-session-hub uses. Declarations only; never shipped.
 */

export interface Context {
  /** Service store resolution (the plugin bridge reads mounted namespaces here). */
  readonly reflect: { get(name: string): unknown }
  /** Resolve a provided service by name. */
  get<K extends string>(name: K): unknown
  /** Provide a service value under a name. */
  provide(name: string, value: unknown): void
  /** Register a child plugin. */
  plugin(plugin: unknown): void
  /** Register a lifecycle effect; returns the disposer or void. */
  effect(fn: () => void | Promise<void> | (() => void) | Promise<(() => void)>, label?: string): void
  /** Inject-dependent async setup. */
  inject(deps: readonly string[], fn: (ctx: Context) => void | (() => void)): void
  /** Emit an event on this context. */
  emit(event: string, ...args: unknown[]): void
  /** Publish a service. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any
}

/** Base class for services (Service-name style plugins). */
export class Service {
  readonly ctx: Context
  constructor(ctx: Context, name: string) {
    this.ctx = ctx
    void name
  }
}