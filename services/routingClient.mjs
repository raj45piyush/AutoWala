const DEFAULT_TIMEOUT_MS = 90_000;

function isPrivateHostname(hostname) {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  const isIpv6 = normalized.includes(':');
  if (
    normalized === 'localhost'
    || normalized.endsWith('.localhost')
    || normalized.endsWith('.local')
    || normalized.endsWith('.internal')
    || (isIpv6 && (
      normalized === '::'
      || normalized === '::1'
      || normalized.startsWith('fc')
      || normalized.startsWith('fd')
      || normalized.startsWith('fe80:')
      || normalized.startsWith('::ffff:')
    ))
  ) return true;

  const octets = normalized.split('.').map(Number);
  if (octets.length !== 4 || octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) {
    return false;
  }

  const [first, second] = octets;
  return first === 0
    || first === 10
    || first === 127
    || (first === 169 && second === 254)
    || (first === 172 && second >= 16 && second <= 31)
    || (first === 192 && second === 168)
    || (first === 100 && second >= 64 && second <= 127);
}

export function resolveRoutingApiUrl(value, isProduction = false) {
  const configuredValue = typeof value === 'string' ? value.trim() : '';
  if (!configuredValue) {
    throw new Error('Road routing is not configured. Set EXPO_PUBLIC_ROUTING_API_URL to the deployed routing server URL.');
  }

  let url;
  try {
    url = new URL(configuredValue);
  } catch {
    throw new Error('Road routing URL is malformed. Set EXPO_PUBLIC_ROUTING_API_URL to a full HTTP(S) URL.');
  }

  if ((url.protocol !== 'https:' && url.protocol !== 'http:') || !url.hostname) {
    throw new Error('Road routing URL must use HTTP or HTTPS and include a hostname.');
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error('Road routing URL must not contain credentials, a query string, or a fragment.');
  }

  if (isProduction && url.protocol !== 'https:') {
    throw new Error('Production road routing must use HTTPS. Update EXPO_PUBLIC_ROUTING_API_URL.');
  }
  if (isProduction && isPrivateHostname(url.hostname)) {
    throw new Error('Production road routing cannot use a private or local network address. Set EXPO_PUBLIC_ROUTING_API_URL to the public HTTPS server URL.');
  }

  return `${url.origin}${url.pathname.replace(/\/+$/, '')}`;
}

export async function fetchRoadRoute(
  endpoint,
  accessToken,
  coordinates,
  fetchImplementation = globalThis.fetch,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  signal
) {
  const controller = new AbortController();
  let timedOut = false;
  const abortFromCaller = () => controller.abort();
  if (signal?.aborted) controller.abort();
  else signal?.addEventListener('abort', abortFromCaller, { once: true });
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  let response;
  let payload = null;
  try {
    try {
      response = await fetchImplementation(endpoint, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${accessToken}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify(coordinates),
        signal: controller.signal,
      });
    } catch (error) {
      if (signal?.aborted) {
        const abortError = new Error('Road route request was cancelled.');
        abortError.name = 'AbortError';
        throw abortError;
      }
      if (timedOut || (error instanceof Error && error.name === 'AbortError')) {
        throw new Error('Road routing timed out. Check your connection and try again.');
      }
      const detail = error instanceof Error && error.message ? ` (${error.message})` : '';
      throw new Error(`Road routing could not be reached. Check your internet connection and the configured HTTPS server URL${detail}.`);
    }

    try {
      payload = await response.json();
    } catch {
      payload = null;
    }
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', abortFromCaller);
  }

  if (!response.ok) {
    const message = typeof payload === 'object' && payload !== null && 'error' in payload && typeof payload.error === 'string'
      ? payload.error
      : 'Road routing is temporarily unavailable. Please try again.';
    throw new Error(message);
  }

  if (
    typeof payload !== 'object' || payload === null
    || !('distanceKm' in payload) || typeof payload.distanceKm !== 'number'
    || !Number.isFinite(payload.distanceKm) || payload.distanceKm < 0
    || !('durationMinutes' in payload) || typeof payload.durationMinutes !== 'number'
    || !Number.isFinite(payload.durationMinutes) || payload.durationMinutes < 0
    || !('polyline' in payload) || typeof payload.polyline !== 'string' || !payload.polyline
  ) {
    throw new Error('Road routing returned an invalid route. Please try again.');
  }

  return {
    distanceKm: payload.distanceKm,
    durationMinutes: payload.durationMinutes,
    polyline: payload.polyline,
  };
}
