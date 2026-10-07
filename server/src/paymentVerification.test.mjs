import assert from 'node:assert/strict';
import {
  createRazorpaySignature,
  verifyRazorpaySignature,
} from './paymentVerification.mjs';

const orderId = 'order_test_123';
const paymentId = 'pay_test_123';
const secret = 'server-only-test-secret';
const signature = createRazorpaySignature(orderId, paymentId, secret);

assert.equal(verifyRazorpaySignature({ orderId, paymentId, signature, secret }), true);
assert.equal(verifyRazorpaySignature({
  orderId,
  paymentId,
  signature: `${signature.slice(0, -1)}0`,
  secret,
}), false);

console.log('Razorpay signature verification tests passed.');
