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

## Deploy the routing and payment API

The repository includes a Render Blueprint at `render.yaml`. It deploys this existing Node server as a public web service in Singapore and exposes Render's HTTPS URL. The route handler calls OpenRouteService for real road distance, duration, and encoded geometry.

Minimum deployment steps:

1. In Render, create a Blueprint from the repository containing `render.yaml` and select the Free plan.
2. Enter the existing server values when Render prompts for the `sync: false` variables. Use the existing payout encryption key; do not generate a replacement if encrypted payout records already exist. Never put these values in Expo/EAS variables or the repository.
3. Deploy and wait for the `/health` check to pass. The configured service URL is `https://autowala-routing-api-acbde20a.onrender.com`; if Render assigns a different hostname, update `EXPO_PUBLIC_ROUTING_API_URL` in `eas.json` to that deployed HTTPS URL.
4. Verify `https://<deployed-host>/health` returns `{"ok":true}`, then open Book Ride on an Android device and confirm a real route is calculated before creating an APK.

The mobile client requires a public HTTPS base URL in `EXPO_PUBLIC_ROUTING_API_URL`; production builds reject missing, malformed, HTTP, and private-network URLs. The expected value is set in both EAS build profiles and `.env.example`.

Render Free supports Node web services, but sleeps after 15 minutes without traffic and takes about a minute to wake. Render documents Free as unsuitable for production applications. The mobile routing request allows 90 seconds for a cold start plus a route calculation; this does not provide an uptime guarantee.
