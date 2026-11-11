import {
  PRODUCTION_GATEWAY_HOST,
  PRODUCTION_GATEWAY_UPSTREAM,
  createProductionGatewaySignature,
  requestHostIs,
  stripProductionGatewayHeaders,
} from '../../worker/src/production-gateway';

export interface GatewayEnv {
  KINO_GATEWAY_SECRET?: string;
}

function response(status: number): Response {
  return new Response(null, {
    status,
    headers: { 'Cache-Control': 'no-store' },
  });
}

const gatewayWorker = {
  async fetch(request: Request, env: GatewayEnv): Promise<Response> {
    if (!requestHostIs(request, PRODUCTION_GATEWAY_HOST)) return response(404);

    const ip = request.headers.get('CF-Connecting-IP');
    const signature = await createProductionGatewaySignature(
      request,
      ip ?? '',
      env.KINO_GATEWAY_SECRET ?? '',
    );
    if (!signature) return response(503);

    const sourceUrl = new URL(request.url);
    const upstreamUrl = new URL(PRODUCTION_GATEWAY_UPSTREAM);
    upstreamUrl.pathname = sourceUrl.pathname;
    upstreamUrl.search = sourceUrl.search;

    const upstreamRequest = new Request(upstreamUrl, request);
    upstreamRequest.headers.delete('host');
    upstreamRequest.headers.delete('CF-Connecting-IP');
    stripProductionGatewayHeaders(upstreamRequest.headers);
    upstreamRequest.headers.set(
      'X-Kino-Gateway-Timestamp',
      signature.timestamp,
    );
    upstreamRequest.headers.set('X-Kino-Gateway-IP', signature.ip);
    upstreamRequest.headers.set(
      'X-Kino-Gateway-Signature',
      signature.signature,
    );

    const upstreamResponse = await fetch(upstreamRequest, {
      redirect: 'manual',
      cache: 'no-store',
    });
    const headers = new Headers(upstreamResponse.headers);
    headers.set('Cache-Control', 'no-store');
    return new Response(upstreamResponse.body, {
      status: upstreamResponse.status,
      statusText: upstreamResponse.statusText,
      headers,
    });
  },
};

export default gatewayWorker;
