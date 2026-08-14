/** Typecheck stub: @deepseek-ai/dsh-client-ui-slots (slot registry + locale map). */

/** Merge point for plugin locale namespaces. */
export interface LocaleNamespaceMap {}

declare module '@deepseek-ai/cordis' {
  interface Context {
    slots: {
      /** Register one slot entry (component + props injector). */
      register(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        options: {
          name: string
          id?: string
          key?: string
          priority?: number
          order?: number
          label?: string | (() => string)
          locale?: string
          inject: () => Record<string, unknown>
        },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        component: any,
      ): void
      /** Register into a slot another package owns. */
      inject(slot: string, register: () => void): void
    }
  }
}