/** Typecheck stub: @deepseek-ai/dsh-client-locale/client (ctx.locale merge). */

declare module '@deepseek-ai/cordis' {
  interface Context {
    locale: {
      register(ns: string, dicts: { zh: unknown; en: unknown }): () => void
    }
  }
}export {}
