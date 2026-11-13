# Parcel Open

An open-source package tracker for Mac and iPhone, with a self-hostable backend that tracks shipments from carriers worldwide.

Paste a tracking number and the carrier is detected automatically. Active deliveries show at a glance, in the app and in a desktop widget.

> **Status:** the backend is working and tested. The SwiftUI app (macOS + iOS) and the widget are next.

## Repository layout

| Folder | What | Status |
| --- | --- | --- |
| [`backend/`](backend) | TypeScript tracking API (Fastify + SQLite) | working, 23 tests |
| `app/` | SwiftUI app for macOS and iOS | planned |
| `widget/` | WidgetKit widget (macOS, iOS) | planned |

## How carrier coverage works

No free open-source library covers every carrier: carrier sites change often, and scraping them one by one breaks. Parcel Open instead plugs into tracking aggregators through interchangeable **providers**:

| Provider | Coverage (vendor claim) | Notes |
| --- | --- | --- |
| [17TRACK](https://api.17track.net/en/doc) | 2,900+ carriers | API key required, small free quota |
| [AfterShip](https://www.aftership.com/docs/tracking) | 1,000+ carriers | API key required |
| `mock` | fake data | no key needed, for development |

Providers are tried in priority order. If one refuses a number (unsupported carrier), the next one is used. Adding a provider means implementing one small interface (`TrackingProvider` in [`backend/src/domain.ts`](backend/src/domain.ts)).

Each provider has its own quotas, pricing and terms: check them before relying on one.

## Backend quick start

Requires Node.js 22.13 or later.

```bash
cd backend
npm install
cp .env.example .env     # then set API_TOKEN (openssl rand -hex 32) and a provider key
npm run dev
```

Without a provider key the server uses the offline `mock` provider. The last digit of the tracking number picks the scenario (`0` delivered, `1` out for delivery, `2` exception, `3` pending, `4` ready for pickup, `5` failed attempt, anything else in transit).

```bash
npm test          # unit and API tests
npm run build     # compile to dist/
npm start         # run the compiled server
```

## API

All `/v1` routes need `Authorization: Bearer <API_TOKEN>`. Errors look like `{"error": {"code": "...", "message": "..."}}`.

| Method | Route | Purpose |
| --- | --- | --- |
| `GET` | `/health` | Liveness (no auth) |
| `GET` | `/v1/packages?archived=false` | List packages, most urgent first |
| `POST` | `/v1/packages` | Add a package |
| `GET` | `/v1/packages/:id` | Package with full event history |
| `PATCH` | `/v1/packages/:id` | Edit `label`, `description`, `archived` |
| `DELETE` | `/v1/packages/:id` | Delete (and stop tracking at the provider) |
| `POST` | `/v1/packages/:id/refresh` | Refresh one package now |
| `POST` | `/v1/refresh` | Refresh every active package |
| `GET` | `/v1/widget?limit=5` | Compact feed for widgets |
| `POST` | `/webhooks/17track`, `/webhooks/aftership` | Provider push notifications (signature checked) |

Add a package (only `trackingNumber` is required, the carrier is auto-detected):

```bash
curl -X POST http://127.0.0.1:8787/v1/packages \
  -H "Authorization: Bearer $API_TOKEN" -H "Content-Type: application/json" \
  -d '{"trackingNumber": "1Z14V4W16890664609", "label": "1st pack"}'
```

Statuses: `unknown`, `pending`, `in_transit`, `out_for_delivery`, `available_for_pickup`, `failed_attempt`, `exception`, `delivered`, `expired`.

### Webhooks

Point your provider dashboard at `https://<your-host>/webhooks/17track` or `/webhooks/aftership`. The backend still polls every `POLL_INTERVAL_MINUTES` (default 30), so webhooks are optional. For AfterShip, set `AFTERSHIP_WEBHOOK_SECRET`.

## Security notes

- Keep `API_TOKEN` and provider keys on the server, never in the apps' source.
- The server listens on `127.0.0.1` by default. To reach it from your iPhone, put it behind HTTPS (a reverse proxy, Tailscale, or a Cloudflare Tunnel).
- There is no rate limiting yet.

## Roadmap

- [ ] SwiftUI app for macOS and iPhone (list, add sheet, detail with map)
- [ ] WidgetKit widget fed by `/v1/widget`
- [ ] Push notifications on status change (APNs)
- [ ] Carrier picker and carrier-code lookup
- [ ] Docker image

## License

[MIT](LICENSE)
