import { createClient } from '@supabase/supabase-js';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import http from 'node:http';
import { verifyRazorpaySignature } from './paymentVerification.mjs';

const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
};

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function getConfig() {
  const required = (name) => {
    const value = process.env[name]?.trim();
    if (!value) {
      throw new Error(`Missing server environment variable: ${name}`);
    }
    return value;
  };

  const razorpayKeyId = required('RAZORPAY_KEY_ID');
  const paymentMode = (process.env.PAYMENT_MODE?.trim() || 'test').toLowerCase();
  if (paymentMode !== 'test' && paymentMode !== 'live') {
    throw new Error('PAYMENT_MODE must be test or live.');
  }
  if (paymentMode === 'test' && !razorpayKeyId.startsWith('rzp_test_')) {
    throw new Error('Test payment mode requires a Razorpay test key.');
  }

  return {
    paymentMode,
    razorpayKeyId,
    razorpayKeySecret: required('RAZORPAY_KEY_SECRET'),
    supabaseUrl: required('SUPABASE_URL'),
    supabaseServiceRoleKey: required('SUPABASE_SERVICE_ROLE_KEY'),
    payoutEncryptionKey: process.env.RIDER_PAYOUT_ENCRYPTION_KEY?.trim() ?? '',
  };
}

function createSupabaseAdmin(config) {
  return createClient(config.supabaseUrl, config.supabaseServiceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

function getRoutingConfig() {
  const required = (name) => {
    const value = process.env[name]?.trim();
    if (!value) throw new HttpError(503, `Road routing is not configured. Add ${name} to the server environment.`);
    return value;
  };

  return {
    openRouteServiceApiKey: required('OPENROUTESERVICE_API_KEY'),
    supabaseUrl: required('SUPABASE_URL'),
    supabaseServiceRoleKey: required('SUPABASE_SERVICE_ROLE_KEY'),
  };
}

function getRouteCoordinate(body, field, minimum, maximum) {
  const value = body[field];
  if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum) {
    throw new HttpError(400, 'Valid pickup and destination coordinates are required.');
  }
  return value;
}

async function computeRoadRoute(request, config) {
  const body = await readJson(request);
  const origin = {
    latitude: getRouteCoordinate(body, 'pickupLatitude', -90, 90),
    longitude: getRouteCoordinate(body, 'pickupLongitude', -180, 180),
  };
  const destination = {
    latitude: getRouteCoordinate(body, 'destinationLatitude', -90, 90),
    longitude: getRouteCoordinate(body, 'destinationLongitude', -180, 180),
  };

  let response;
  try {
    response = await fetch('https://api.heigit.org/openrouteservice/v2/directions/driving-car', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json',
        authorization: config.openRouteServiceApiKey,
      },
      body: JSON.stringify({
        coordinates: [
          [origin.longitude, origin.latitude],
          [destination.longitude, destination.latitude],
        ],
        instructions: false,
        geometry: true,
      }),
    });
  } catch {
    throw new HttpError(502, 'Road routing could not be reached. Please try again.');
  }

  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }
  if (!response.ok) {
    console.warn(`[AutoWala routing] OpenRouteService returned HTTP ${response.status}.`);
    if (response.status === 401 || response.status === 403) {
      throw new HttpError(503, 'OpenRouteService is unavailable. Check the server API key and Directions API access.');
    }
    if (response.status === 429) {
      throw new HttpError(503, 'Road routing is busy. Please try again shortly.');
    }
    throw new HttpError(502, 'Could not calculate a road route. Please try again.');
  }

  const route = payload?.routes?.[0];
  const distanceMeters = route?.summary?.distance;
  const durationSeconds = route?.summary?.duration;
  const polyline = route?.geometry;
  if (
    typeof distanceMeters !== 'number' || !Number.isFinite(distanceMeters) || distanceMeters < 0
    || typeof durationSeconds !== 'number' || !Number.isFinite(durationSeconds) || durationSeconds < 0
    || typeof polyline !== 'string' || !polyline
  ) {
    throw new HttpError(502, 'OpenRouteService did not return a usable road route. Please try again.');
  }

  return {
    distanceKm: distanceMeters / 1000,
    durationMinutes: Math.ceil(durationSeconds / 60),
    polyline,
  };
}

async function handleRoutingRequest(request, response) {
  try {
    const config = getRoutingConfig();
    sendJson(response, 200, await computeRoadRoute(request, config));
  } catch (error) {
    if (error instanceof HttpError) {
      sendJson(response, error.status, { error: error.message });
      return;
    }
    console.error('[AutoWala routing] Request failed.', error);
    sendJson(response, 500, { error: 'Road routing is temporarily unavailable. Please try again.' });
  }
}

function sendJson(response, status, payload) {
  response.writeHead(status, {
    ...JSON_HEADERS,
    'access-control-allow-origin': '*',
    'access-control-allow-headers': 'authorization, content-type',
    'access-control-allow-methods': 'POST, OPTIONS',
  });
  response.end(JSON.stringify(payload));
}

function sendError(response, error) {
  if (error instanceof HttpError) {
    sendJson(response, error.status, { error: error.message });
    return;
  }

  console.error(error);
  sendJson(response, 500, { error: 'Payment service is temporarily unavailable.' });
}

function readJson(request) {
  return new Promise((resolve, reject) => {
    let body = '';

    request.on('data', (chunk) => {
      body += chunk.toString();
      if (body.length > 1_000_000) {
        reject(new HttpError(413, 'Request is too large.'));
        request.destroy();
      }
    });

    request.on('end', () => {
      if (!body) {
        resolve({});
        return;
      }

      try {
        resolve(JSON.parse(body));
      } catch {
        reject(new HttpError(400, 'Request body must be valid JSON.'));
      }
    });

    request.on('error', reject);
  });
}

async function requireAuthenticatedUser(request, supabase) {
  const authorization = request.headers.authorization;
  if (!authorization?.startsWith('Bearer ')) {
    throw new HttpError(401, 'Authentication is required.');
  }

  const accessToken = authorization.slice('Bearer '.length).trim();
  if (!accessToken) {
    throw new HttpError(401, 'Authentication is required.');
  }

  const { data, error } = await supabase.auth.getUser(accessToken);
  if (error || !data.user) {
    throw new HttpError(401, 'Your session has expired. Please log in again.');
  }

  return data.user;
}

function getPayoutEncryptionKey(config) {
  let key;
  try {
    key = Buffer.from(config.payoutEncryptionKey, 'base64');
  } catch {
    key = Buffer.alloc(0);
  }
  if (key.length !== 32) {
    throw new HttpError(503, 'Secure payout storage is not configured.');
  }
  return key;
}

function encryptPayoutData(config, value) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', getPayoutEncryptionKey(config), iv);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  return `v1:${iv.toString('base64')}:${cipher.getAuthTag().toString('base64')}:${encrypted.toString('base64')}`;
}

function decryptPayoutData(config, value) {
  try {
    const [version, ivPart, tagPart, encryptedPart] = value.split(':');
    if (version !== 'v1' || !ivPart || !tagPart || !encryptedPart) throw new Error('Invalid encrypted payload');
    const decipher = createDecipheriv('aes-256-gcm', getPayoutEncryptionKey(config), Buffer.from(ivPart, 'base64'));
    decipher.setAuthTag(Buffer.from(tagPart, 'base64'));
    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(encryptedPart, 'base64')),
      decipher.final(),
    ]).toString('utf8');
    return JSON.parse(decrypted);
  } catch {
    throw new HttpError(500, 'Saved payout details could not be read.');
  }
}

async function requireRider(request, supabase) {
  const user = await requireAuthenticatedUser(request, supabase);
  const { data: profile, error } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .maybeSingle();
  if (error) throw new HttpError(500, 'Could not verify rider access.');
  if (profile?.role !== 'rider') throw new HttpError(403, 'Rider access is required.');
  return user;
}

async function readRiderPayoutProfile(request, config, supabase) {
  const user = await requireRider(request, supabase);
  const { data, error } = await supabase
    .from('rider_payout_profiles')
    .select('encrypted_payload,payout_method,account_last4,updated_at')
    .eq('user_id', user.id)
    .maybeSingle();
  if (error) throw new HttpError(500, 'Could not load saved payout details.');
  if (!data) return { configured: false, payoutMethod: null, maskedDestination: null, updatedAt: null };

  const details = decryptPayoutData(config, data.encrypted_payload);
  const maskedDestination = data.payout_method === 'bank'
    ? `•••• ${data.account_last4 ?? ''}`.trim()
    : maskUpiAddress(details.upiId);
  return {
    configured: true,
    payoutMethod: data.payout_method,
    maskedDestination,
    updatedAt: data.updated_at,
  };
}

function maskUpiAddress(value) {
  if (typeof value !== 'string' || !value.includes('@')) return 'Saved UPI ID';
  const [name, provider] = value.split('@');
  return `${name.slice(0, 2)}***@${provider}`;
}

async function saveRiderPayoutProfile(request, config, supabase) {
  const user = await requireRider(request, supabase);
  const body = await readJson(request);
  const payoutMethod = body.payoutMethod;
  let details;
  let accountLast4 = null;

  if (payoutMethod === 'bank') {
    const accountHolder = requiredString(body.accountHolder, 'Account holder');
    const accountNumber = requiredString(body.accountNumber, 'Account number').replace(/\s/g, '');
    const ifsc = requiredString(body.ifsc, 'IFSC').toUpperCase();
    if (accountHolder.length > 100 || !/^\d{9,18}$/.test(accountNumber) || !/^[A-Z]{4}0[A-Z0-9]{6}$/.test(ifsc)) {
      throw new HttpError(400, 'Enter a valid account holder, account number, and IFSC.');
    }
    details = { payoutMethod, accountHolder, accountNumber, ifsc };
    accountLast4 = accountNumber.slice(-4);
  } else if (payoutMethod === 'upi') {
    const upiId = requiredString(body.upiId, 'UPI ID').toLowerCase();
    if (upiId.length > 256 || !/^[a-z0-9._-]{2,100}@[a-z0-9.-]{2,64}$/.test(upiId)) {
      throw new HttpError(400, 'Enter a valid UPI ID.');
    }
    details = { payoutMethod, upiId };
  } else {
    throw new HttpError(400, 'Choose a bank account or UPI payout method.');
  }

  const encryptedPayload = encryptPayoutData(config, details);
  const { error } = await supabase.from('rider_payout_profiles').upsert({
    user_id: user.id,
    encrypted_payload: encryptedPayload,
    payout_method: payoutMethod,
    account_last4: accountLast4,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'user_id' });
  if (error) throw new HttpError(500, 'Payout details could not be saved.');
  return { configured: true, payoutMethod, maskedDestination: payoutMethod === 'bank' ? `•••• ${accountLast4}` : maskUpiAddress(details.upiId), updatedAt: new Date().toISOString() };
}

function requiredString(value, field) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new HttpError(400, `${field} is required.`);
  }
  return value.trim();
}

function validateRazorpayId(value, prefix, field) {
  const id = requiredString(value, field);
  if (!new RegExp(`^${prefix}[A-Za-z0-9_-]+$`).test(id)) {
    throw new HttpError(400, `${field} is invalid.`);
  }
  return id;
}

function getExpectedAmount(ride) {
  if (ride.status !== 'completed') {
    throw new HttpError(409, 'This ride is not completed and payable yet.');
  }

  const amount = Number(ride.final_fare ?? ride.estimated_fare);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new HttpError(409, 'This ride does not have a payable fare yet.');
  }

  return Math.round(amount * 100) / 100;
}

function assertClientAmount(body, expectedAmount) {
  if (body.amount === undefined) {
    return;
  }

  const requestedAmount = Number(body.amount);
  if (!Number.isFinite(requestedAmount) || requestedAmount <= 0) {
    throw new HttpError(400, 'The requested amount is invalid.');
  }

  if (Math.round(requestedAmount * 100) !== Math.round(expectedAmount * 100)) {
    throw new HttpError(409, 'The ride fare has changed. Please refresh and try again.');
  }
}

async function getRideForPassenger(supabase, rideId, userId) {
  const { data: ride, error } = await supabase
    .from('rides')
    .select('id, passenger_id, status, estimated_fare, final_fare')
    .eq('id', rideId)
    .maybeSingle();

  if (error) {
    throw new HttpError(500, 'Could not validate the ride.');
  }
  if (!ride) {
    throw new HttpError(404, 'Ride not found.');
  }
  if (ride.passenger_id !== userId) {
    throw new HttpError(403, 'You can only pay for your own ride.');
  }

  return ride;
}

async function getPaymentForRide(supabase, rideId) {
  const { data: payment, error } = await supabase
    .from('payments')
    .select('id, ride_id, user_id, payer_id, amount, payment_status, status, razorpay_order_id, razorpay_payment_id, transaction_reference, provider_payment_id')
    .eq('ride_id', rideId)
    .maybeSingle();

  if (error) {
    throw new HttpError(500, 'Could not load the payment record. Run the latest schema migration first.');
  }

  return payment;
}

function toSafeOrderResponse(paymentId, orderId, amountPaise) {
  return {
    paymentId,
    orderId,
    amount: amountPaise,
    currency: 'INR',
  };
}

function razorpayAuth(config) {
  return `Basic ${Buffer.from(`${config.razorpayKeyId}:${config.razorpayKeySecret}`).toString('base64')}`;
}

async function razorpayRequest(config, path, options = {}) {
  const response = await fetch(`https://api.razorpay.com/v1${path}`, {
    ...options,
    headers: {
      authorization: razorpayAuth(config),
      'content-type': 'application/json',
      ...(options.headers ?? {}),
    },
  });

  const text = await response.text();
  let payload = {};
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    payload = {};
  }

  if (!response.ok) {
    const description = payload?.error?.description;
    throw new HttpError(502, typeof description === 'string' ? description : 'Razorpay request failed.');
  }

  return payload;
}

async function createOrder(config, rideId, userId, amountPaise) {
  const order = await razorpayRequest(config, '/orders', {
    method: 'POST',
    body: JSON.stringify({
      amount: amountPaise,
      currency: 'INR',
      receipt: `aw-${rideId}`.slice(0, 40),
      notes: {
        ride_id: rideId,
        user_id: userId,
      },
    }),
  });

  if (typeof order.id !== 'string' || typeof order.amount !== 'number' || order.amount !== amountPaise) {
    throw new HttpError(502, 'Razorpay returned an invalid order.');
  }

  return order;
}

async function createPaymentOrder(request, config, supabase) {
  const body = await readJson(request);
  const user = await requireAuthenticatedUser(request, supabase);
  const rideId = requiredString(body.rideId, 'rideId');
  const ride = await getRideForPassenger(supabase, rideId, user.id);
  const expectedAmount = getExpectedAmount(ride);
  assertClientAmount(body, expectedAmount);
  const amountPaise = Math.round(expectedAmount * 100);
  const existing = await getPaymentForRide(supabase, rideId);

  if (existing?.payment_status === 'paid') {
    throw new HttpError(409, 'This ride has already been paid.');
  }

  if ((existing?.payment_status === 'pending' || existing?.payment_status === 'processing') && existing.razorpay_order_id) {
    if (Number(existing.amount) === expectedAmount) {
      return toSafeOrderResponse(existing.id, existing.razorpay_order_id, amountPaise);
    }
    await markPaymentFailed(supabase, existing, 'Ride fare changed before checkout completed');
  }

  const order = await createOrder(config, rideId, user.id, amountPaise);
  const pendingFields = {
    ride_id: rideId,
    user_id: user.id,
    payer_id: user.id,
    amount: expectedAmount,
    payment_status: 'processing',
    status: 'processing',
    razorpay_order_id: order.id,
    razorpay_payment_id: null,
    transaction_reference: null,
    provider: 'razorpay',
    provider_payment_id: null,
  };

  const result = existing
    ? await supabase.from('payments').update(pendingFields).eq('id', existing.id).select('id').single()
    : await supabase.from('payments').insert(pendingFields).select('id').single();

  if (result.error || !result.data) {
    throw new HttpError(500, 'Could not save the pending payment.');
  }

  return toSafeOrderResponse(result.data.id, order.id, amountPaise);
}

async function fetchRazorpayPayment(config, paymentId) {
  return razorpayRequest(config, `/payments/${paymentId}`);
}

async function markPaymentFailed(supabase, payment, reason = null) {
  if (payment.payment_status === 'paid') {
    return payment;
  }

  const { data, error } = await supabase
    .from('payments')
    .update({
      payment_status: 'failed',
      status: 'failed',
      transaction_reference: reason,
    })
    .eq('id', payment.id)
    .neq('payment_status', 'paid')
    .select('*')
    .maybeSingle();

  if (error) {
    throw new HttpError(500, 'Could not update the failed payment.');
  }

  return data ?? payment;
}

async function verifyPayment(request, config, supabase) {
  const body = await readJson(request);
  const user = await requireAuthenticatedUser(request, supabase);
  const rideId = requiredString(body.rideId, 'rideId');
  const razorpayOrderId = validateRazorpayId(body.razorpayOrderId, 'order_', 'razorpayOrderId');
  const razorpayPaymentId = validateRazorpayId(body.razorpayPaymentId, 'pay_', 'razorpayPaymentId');
  const razorpaySignature = requiredString(body.razorpaySignature, 'razorpaySignature');
  const ride = await getRideForPassenger(supabase, rideId, user.id);
  const expectedAmount = getExpectedAmount(ride);
  const payment = await getPaymentForRide(supabase, rideId);

  if (!payment || payment.user_id !== user.id) {
    throw new HttpError(404, 'Payment order not found.');
  }

  if (payment.payment_status === 'paid') {
    if (payment.razorpay_payment_id === razorpayPaymentId) {
      return { paymentId: payment.id, rideId, status: 'paid', amount: payment.amount };
    }
    throw new HttpError(409, 'This ride has already been paid with another payment.');
  }

  if (payment.razorpay_order_id !== razorpayOrderId) {
    throw new HttpError(400, 'The Razorpay order does not match this ride.');
  }

  if (!verifyRazorpaySignature({
    orderId: payment.razorpay_order_id,
    paymentId: razorpayPaymentId,
    signature: razorpaySignature,
    secret: config.razorpayKeySecret,
  })) {
    throw new HttpError(400, 'Payment signature verification failed.');
  }

  const gatewayPayment = await fetchRazorpayPayment(config, razorpayPaymentId);
  if (
    gatewayPayment.id !== razorpayPaymentId
    || gatewayPayment.order_id !== payment.razorpay_order_id
    || gatewayPayment.currency !== 'INR'
    || gatewayPayment.amount !== Math.round(expectedAmount * 100)
  ) {
    throw new HttpError(400, 'The verified payment does not match this ride.');
  }

  if (gatewayPayment.status !== 'captured') {
    if (gatewayPayment.status === 'failed') {
      await markPaymentFailed(supabase, payment, 'Razorpay payment failed');
      throw new HttpError(402, 'Razorpay payment failed.');
    }
    throw new HttpError(409, 'Payment is not captured yet.');
  }

  const { data: updatedPayment, error } = await supabase
    .from('payments')
    .update({
      payment_status: 'paid',
      status: 'paid',
      razorpay_payment_id: razorpayPaymentId,
      transaction_reference: razorpayPaymentId,
      provider_payment_id: razorpayPaymentId,
    })
    .eq('id', payment.id)
    .eq('payment_status', 'pending')
    .select('id, ride_id, amount, payment_status')
    .maybeSingle();

  if (error) {
    throw new HttpError(500, 'Could not finalize the verified payment.');
  }

  if (!updatedPayment) {
    const currentPayment = await getPaymentForRide(supabase, rideId);
    if (currentPayment?.payment_status === 'paid' && currentPayment.razorpay_payment_id === razorpayPaymentId) {
      return { paymentId: currentPayment.id, rideId, status: 'paid', amount: currentPayment.amount };
    }
    throw new HttpError(409, 'The payment was already processed or is no longer pending.');
  }

  return {
    paymentId: updatedPayment.id,
    rideId: updatedPayment.ride_id,
    status: 'paid',
    amount: updatedPayment.amount,
  };
}

async function failPayment(request, supabase) {
  const body = await readJson(request);
  const user = await requireAuthenticatedUser(request, supabase);
  const rideId = requiredString(body.rideId, 'rideId');
  const payment = await getPaymentForRide(supabase, rideId);

  if (!payment || payment.user_id !== user.id) {
    throw new HttpError(404, 'Payment order not found.');
  }

  if (body.razorpayOrderId && body.razorpayOrderId !== payment.razorpay_order_id) {
    throw new HttpError(400, 'The Razorpay order does not match this ride.');
  }

  const failedPayment = await markPaymentFailed(
    supabase,
    payment,
    typeof body.reason === 'string' ? body.reason.slice(0, 200) : 'Checkout was cancelled or failed'
  );

  return {
    paymentId: failedPayment.id,
    rideId,
    status: failedPayment.payment_status,
  };
}

async function handleRequest(request, response) {
  if (request.method === 'OPTIONS') {
    sendJson(response, 204, {});
    return;
  }

  if (request.method === 'GET' && request.url === '/health') {
    sendJson(response, 200, { ok: true });
    return;
  }

  if (request.method !== 'POST') {
    sendJson(response, 405, { error: 'Method not allowed.' });
    return;
  }

  if (request.url === '/api/routes/compute') {
    await handleRoutingRequest(request, response);
    return;
  }

  const config = getConfig();
  const supabase = createSupabaseAdmin(config);

  if (request.url === '/api/payments/orders') {
    sendJson(response, 200, await createPaymentOrder(request, config, supabase));
    return;
  }

  if (request.url === '/api/payments/verify') {
    sendJson(response, 200, await verifyPayment(request, config, supabase));
    return;
  }

  if (request.url === '/api/payments/failed') {
    sendJson(response, 200, await failPayment(request, supabase));
    return;
  }

  if (request.url === '/api/payout/profile/read') {
    sendJson(response, 200, await readRiderPayoutProfile(request, config, supabase));
    return;
  }

  if (request.url === '/api/payout/profile/save') {
    sendJson(response, 200, await saveRiderPayoutProfile(request, config, supabase));
    return;
  }

  sendJson(response, 404, { error: 'Not found.' });
}

const port = Number(process.env.PAYMENT_SERVER_PORT ?? 8787);
const server = http.createServer((request, response) => {
  void handleRequest(request, response).catch((error) => sendError(response, error));
});

server.listen(port, '0.0.0.0', () => {
  console.log(`AutoWala payment server listening on port ${port}`);
});
