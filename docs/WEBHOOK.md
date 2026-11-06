# Booking webhook: integration spec for the booking website

Give this page to whoever operates the booking website. OPERAFlow accepts signed booking events. It never
polls or scrapes the website.

## Endpoint

`POST https://<operaflow-host>/api/webhooks/bookings/WEBSITE_WEBHOOK`, with header `Content-Type: application/json`.

An OPERAFlow administrator issues the signing secret under **Booking sources → Booking website (webhook) →
Issue signing secret**. The secret is shown once. Rotating it invalidates the old one immediately.

## Signing

```
X-OperaFlow-Timestamp: <unix time in seconds>
X-OperaFlow-Signature: sha256=<hex HMAC-SHA256(secret, "<timestamp>.<raw request body>")>
```

Requests older or newer than 5 minutes are rejected (`WEBHOOK_TOLERANCE_SECONDS`). Sign the exact bytes you send.

Node.js example:

```js
const body = JSON.stringify(event);
const ts = Math.floor(Date.now() / 1000);
const sig = crypto.createHmac('sha256', SECRET).update(`${ts}.${body}`).digest('hex');
await fetch(URL, { method: 'POST', body, headers: { 'Content-Type': 'application/json', 'X-OperaFlow-Timestamp': ts, 'X-OperaFlow-Signature': `sha256=${sig}` } });
```

## Event

```json
{
  "eventId": "unique-per-event, reused on retries",
  "eventType": "booking.created | booking.updated | booking.cancelled",
  "occurredAt": "2026-11-07T08:00:00Z",
  "booking": {
    "externalRef": "WEB-500",
    "updatedAt": "2026-11-07T08:00:00Z",
    "bookingDate": "2026-11-07T07:58:12Z",
    "leadGuestName": "Jane Doe",
    "guestEmail": "jane@example.com",
    "guestPhone": "+971500000000",
    "hotelName": "Marina Hotel", "hotelCity": "Dubai", "hotelCountry": "AE",
    "supplierCode": "SUP1",
    "checkIn": "2026-12-01", "checkOut": "2026-12-04",
    "adults": 2, "children": 0, "rooms": 1, "roomType": "Deluxe King", "boardBasis": "BB",
    "currency": "AED", "sellingAmount": "2600.00", "costAmount": "2100.00", "taxAmount": "120.00",
    "status": "CONFIRMED", "paymentStatus": "PAID", "confirmationStatus": "CONFIRMED", "confirmationNumber": "HTL-1"
  }
}
```

- Required for a new booking: `externalRef`, `leadGuestName`, `checkIn`, `checkOut`, `currency`. Updates may send only the fields that changed. Omitted fields are left as they are.
- `hotelName`, `hotelCity` and `hotelCountry` must be sent together.
- `supplierCode` must exist in OPERAFlow's supplier directory.
- Never send card numbers or other payment-instrument data. There is no field for them.

## Responses and retries

| Status | Meaning | Retry? |
|---|---|---|
| 200 `{"status":"processed"}` | Applied. `result.action` is `created`, `updated`, `unchanged` or `stale` (older than the data already held) | No |
| 200 `{"status":"duplicate"}` | This `eventId` was already processed | No |
| 400 / 422 | Invalid envelope or booking data (details in `issues`) | Fix, then resend with the same `eventId` |
| 401 | Bad signature or timestamp | Check the secret and clock |
| 404 | Source not set up, or no secret issued | Contact an OPERAFlow admin |
| 409 | The same event is being processed right now | Retry after a few seconds |
| 5xx | Temporary failure | Retry with backoff, same `eventId` |

Ordering: events are applied by `booking.updatedAt`. A late-arriving older update is ignored.
