/**
 * Browser-trust fence for the hub's intercepted /api endpoints. Faithful port
 * of the harness `api-request-trust.ts` fence (DNS-rebinding Host check,
 * sec-fetch-site cross-site marker, same-origin Origin check), so requests
 * routed by the hub gateway are gated no looser than the official prefix
 * route. The hub declares its own `trustedHosts` (default: loopback only);
 * the official client-connection config is fiber-private and not readable
 * here.
 */
import type { IncomingHttpHeaders } from 'node:http';
/** The request facts the fence reads from either HTTP representation. */
interface TrustRequest {
    headers: IncomingHttpHeaders | Headers;
}
/** localhost, [::1], any IPv4 in 127/8. */
export declare function isLoopbackHostname(hostname: string | null): boolean;
/**
 * Decide whether one intercepted /api request may reach the hub gateway.
 * @param request - Node HTTP or Fetch request facts (headers).
 * @param trustedHosts - non-loopback authorities this deployment serves.
 */
export declare function isTrustedApiRequest(request: TrustRequest, trustedHosts: readonly string[]): boolean;
export {};
