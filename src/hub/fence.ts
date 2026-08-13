/**
 * Browser-trust fence for the hub's intercepted /api endpoints. Faithful port
 * of the harness `api-request-trust.ts` fence (DNS-rebinding Host check,
 * sec-fetch-site cross-site marker, same-origin Origin check), so requests
 * routed by the hub gateway are gated no looser than the official prefix
 * route. The hub declares its own `trustedHosts` (default: loopback only);
 * the official client-connection config is fiber-private and not readable
 * here.
 */

import type { IncomingHttpHeaders } from 'node:http'

/** The request facts the fence reads from either HTTP representation. */
interface TrustRequest {
  headers: IncomingHttpHeaders | Headers
}

function header(headers: IncomingHttpHeaders | Headers, name: string): string | undefined {
  if (headers instanceof Headers) return headers.get(name) ?? undefined
  const value = headers[name]
  return typeof value === 'string' ? value : undefined
}

/** localhost, [::1], any IPv4 in 127/8. */
export function isLoopbackHostname(hostname: string | null): boolean {
  if (hostname === null) return false
  if (hostname === 'localhost' || hostname === '::1') return true
  if (/^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname)) {
    return hostname.split('.').every(part => Number(part) <= 255)
  }
  return false
}

/** Normalized URL of a Host-header authority, or undefined when unparsable. */
function parseAuthority(authority: string): URL | undefined {
  try {
    return new URL(`http://${authority}`)
  } catch {
    return undefined
  }
}

/** Canonical `hostname` or `hostname:port` form (WHATWG normalization). */
function canonicalAuthority(entry: string, entryUrl: URL): string {
  const port = entryUrl.port !== '' ? entryUrl.port : new URL(`https://${entry}`).port
  return port === '' ? entryUrl.hostname : `${entryUrl.hostname}:${port}`
}

/** Whether the request authority matches a trustedHosts entry (exact port, or port-less host on any port). */
function isTrustedAuthority(hostUrl: URL, trustedHosts: readonly string[]): boolean {
  return trustedHosts.some((entry) => {
    const entryUrl = parseAuthority(entry)
    if (entryUrl === undefined) return false
    return canonicalAuthority(entry, entryUrl) === entryUrl.hostname
      ? entryUrl.hostname === hostUrl.hostname
      : entryUrl.host === hostUrl.host
  })
}

/**
 * Decide whether one intercepted /api request may reach the hub gateway.
 * @param request - Node HTTP or Fetch request facts (headers).
 * @param trustedHosts - non-loopback authorities this deployment serves.
 */
export function isTrustedApiRequest(request: TrustRequest, trustedHosts: readonly string[]): boolean {
  const host = header(request.headers, 'host')
  if (host === undefined) return false
  const hostUrl = parseAuthority(host)
  if (hostUrl === undefined) return false
  if (!isLoopbackHostname(hostUrl.hostname) && !isTrustedAuthority(hostUrl, trustedHosts)) return false
  if (header(request.headers, 'sec-fetch-site') === 'cross-site') return false
  const origin = header(request.headers, 'origin')
  if (origin === undefined) return true
  try {
    return new URL(origin).host === hostUrl.host
  } catch {
    return false
  }
}
