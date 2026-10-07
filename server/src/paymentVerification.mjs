import { createHmac, timingSafeEqual } from 'node:crypto';

export function createRazorpaySignature(orderId, paymentId, secret) {
  return createHmac('sha256', secret)
    .update(`${orderId}|${paymentId}`)
    .digest('hex');
}

export function verifyRazorpaySignature({ orderId, paymentId, signature, secret }) {
  if (!orderId || !paymentId || !signature || !secret) {
    return false;
  }

  const expected = createRazorpaySignature(orderId, paymentId, secret);
  const expectedBuffer = Buffer.from(expected, 'utf8');
  const receivedBuffer = Buffer.from(signature.trim().toLowerCase(), 'utf8');

  return expectedBuffer.length === receivedBuffer.length
    && timingSafeEqual(expectedBuffer, receivedBuffer);
}
