/**
 * Node-side wire client for one remote dsh web deployment.
 *
 * The harness ships this exact carrier pair for browsers (HTTP up +
 * WebSocket down, see client/connection/src/client/web-api-client.ts); this
 * subclass redirects both legs at an absolute origin. Node fetch carries no
 * Origin/Sec-Fetch-* markers, so the remote's browser-trust fence admits the
 * calls when the Host header is loopback (tunnel) or one of the remote's
 * derived/configured trusted authorities — exactly the non-browser path the
 * fence documents (api-request-trust.ts).
 */
import type { ApiProxy, HostFrame, MuxFrame, RpcRequest } from '@deepseek-ai/dsh-host-apiproxy';
import { AbstractApiClient } from '@deepseek-ai/dsh-host-apiproxy';
/**
 * Remote /api carrier: unary/respond use Node fetch against the remote
 * origin; mux/host use one WebSocket each, mirroring WebApiClient.
 */
export declare class RemoteApiClient extends AbstractApiClient {
    private readonly origin;
    constructor(origin: string);
    protected resolveBase(): string;
    protected doFetch(input: URL, init?: RequestInit): Promise<Response>;
    /**
     * Unary RPC to any wire domain (settings/credentials/llm/…), envelope in
     * the standard client-request shape. Privileged methods pass the remote
     * fence when the Host is loopback (SSH tunnel) or a declared trusted
     * authority — the same Node non-browser path the fence documents.
     * @returns the parsed ServerResponse document.
     */
    call(method: string, payload: unknown, signal?: AbortSignal): Promise<import('@deepseek-ai/dsh-host-apiproxy').RpcResponse<unknown>>;
    protected openMux(_payload: Parameters<ApiProxy['events']['mux']>[0]['payload'], signal: AbortSignal, onOpen?: () => void): AsyncIterable<RpcRequest<MuxFrame>>;
    protected openHost(_payload: Parameters<ApiProxy['events']['host']>[0]['payload'], signal: AbortSignal, onOpen?: () => void): AsyncIterable<RpcRequest<HostFrame>>;
    private readSocket;
}
