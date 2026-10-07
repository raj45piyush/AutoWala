# AutoWala payment server

This is a separate server-side API. It must not be bundled into the Expo app.

Configure the variables from the repository root `.env.server.example` in the server deployment environment. The server requires:

- `RAZORPAY_KEY_ID`
- `RAZORPAY_KEY_SECRET`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

Run it from this directory after installing the server dependency:

```bash
npm install
npm start
```

Endpoints:

- `POST /api/payments/orders` — authenticated passenger; body `{ "rideId": "...", "amount": 123 }`. The server ignores an untrusted amount and validates it against the completed ride fare.
- `POST /api/payments/verify` — authenticated passenger; verifies the stored order ID, Razorpay HMAC signature, payment amount, order, and captured status before marking the Supabase payment as paid.
- `POST /api/payments/failed` — authenticated passenger; records a checkout failure without ever marking a payment paid.
- `GET /health` — health check.

The mobile app sends the Supabase access token as a Bearer token. The service-role key and Razorpay secret remain server-only.
