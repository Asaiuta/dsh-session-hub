/** Typecheck stubs for @deepseek-ai/dsh-typert-registry/types. */

/** A host service model member (manifest model). */
export interface TypertModelServiceMember {
  readonly kind: 'method'
  readonly name: string
  readonly signature: string
}

export interface TypertModelService {
  readonly key: string
  readonly exportName: string
  readonly description: string
  readonly tags: readonly string[]
  readonly members: readonly TypertModelServiceMember[]
  readonly types: readonly unknown[]
}

/** The strict host contribution registered via `ctx.typert.register`. */
export interface TypertContribution {
  readonly package: string
  readonly face: 'host'
  readonly schemas: readonly unknown[]
  readonly model: {
    readonly services: readonly TypertModelService[]
    readonly events: readonly unknown[]
    readonly objects: readonly unknown[]
  }
  readonly invocations: readonly import('@deepseek-ai/dsh-typert-protocol').InvocationDescriptor[]
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    typert: {
      register(contribution: TypertContribution): () => Promise<void>
    }
  }
}