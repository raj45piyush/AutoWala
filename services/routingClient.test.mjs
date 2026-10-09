import assert from 'node:assert/strict';
import test from 'node:test';

import { fetchRoadRoute, resolveRoutingApiUrl } from './routingClient.mjs';

const routeInput = {
  pickupLatitude: 12.9716,
  pickupLongitude: 77.5946,
  destinationLatitude: 12.9352,
  destinationLongitude: 77.6245,
};

test('routing URL rejects missing configuration', () => {
  assert.throws(() => resolveRoutingApiUrl(undefined), /not configured.*EXPO_PUBLIC_ROUTING_API_URL/i);
});

test('routing URL rejects malformed values', () => {
  assert.throws(() => resolveRoutingApiUrl('not a URL'), /malformed/i);
});

test('production routing URL requires public HTTPS', () => {
  assert.throws(() => resolveRoutingApiUrl('http://routing.example.com', true), /must use HTTPS/i);
  assert.throws(() => resolveRoutingApiUrl('https://10.20.135.243:8787', true), /private or local/i);
  assert.throws(() => resolveRoutingApiUrl('https://[fc00::1]', true), /private or local/i);
  assert.equal(resolveRoutingApiUrl('https://autowala-routing.example.com/', true), 'https://autowala-routing.example.com');
});

test('routing request reports network failures with an actionable message', async () => {
  await assert.rejects(
    fetchRoadRoute('https://routing.example.com/api/routes/compute', 'token', routeInput, async () => {
      throw new TypeError('Host unreachable');
    }, 100),
    /could not be reached.*internet connection.*Host unreachable/i,
  );
});

test('routing request reports HTTP errors from the server', async () => {
  await assert.rejects(
    fetchRoadRoute('https://routing.example.com/api/routes/compute', 'token', routeInput, async () =>
      new Response(JSON.stringify({ error: 'OpenRouteService is unavailable.' }), { status: 503 }),
    100),
    /OpenRouteService is unavailable/i,
  );
});

test('routing request times out', async () => {
  await assert.rejects(
    fetchRoadRoute('https://routing.example.com/api/routes/compute', 'token', routeInput, (_url, options) =>
      new Promise((_resolve, reject) => {
        options.signal.addEventListener('abort', () => {
          const error = new Error('aborted');
          error.name = 'AbortError';
          reject(error);
        }, { once: true });
      }),
    5),
    /timed out/i,
  );
});
