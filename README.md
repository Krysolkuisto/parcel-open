# Parcel Open

An open-source package tracker for Mac and iPhone, with a self-hostable backend that tracks shipments from carriers worldwide.

Paste a tracking number and the carrier is detected automatically. Active deliveries show at a glance, in the app and in a desktop widget.

> **Status:** the backend and the macOS app work and are tested. The iPhone app and the widget are written but need Xcode to build (not yet verified on a device).

## Repository layout

| Folder | What | Status |
| --- | --- | --- |
| [`backend/`](backend) | TypeScript tracking API (Fastify + SQLite) | working, 23 tests |
| [`app/`](app) | SwiftUI app for macOS and iOS, shared `ParcelKit` package, WidgetKit widget | macOS app working, 9 tests; iOS and widget need Xcode |

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

## The apps

One SwiftUI codebase for Mac and iPhone, in English and French. It looks like Parcel: a list of deliveries with a status icon, a detail view with the tracking timeline and a map, and a short add form (Reference, Carrier, Description). Carriers are detected automatically.

### Run the Mac app (no Xcode needed)

```bash
cd backend && npm install && cp .env.example .env   # set API_TOKEN, start with: npm run dev
cd ../app && ./scripts/build-mac-app.sh && open build/ParcelOpen.app
```

On first launch, enter the server address (`http://127.0.0.1:8787`) and your `API_TOKEN`. Use `swift test` in `app/` to run the tests.

### iPhone and widget (Xcode required)

The iOS app and the desktop widget are WidgetKit/iOS targets, which only Xcode can build.

```bash
brew install xcodegen
cd app && xcodegen && open ParcelOpen.xcodeproj
```

1. Install Xcode, then pick the `ParcelOpen` scheme.
2. Under *Signing & Capabilities*, set your Team for both targets. Change the bundle ids and the App Group (`group.com.krysolkuisto.parcelopen` in `project.yml`) if you use your own.
3. Run on a Mac or an iPhone, then add the *Parcel Open* widget from the widget gallery.

The app and its widget share the server address and token through the App Group. The token is stored there, inside the app's sandbox, rather than in the Keychain, so that the widget can fetch data by itself.

An iPhone cannot reach `127.0.0.1` on your Mac. Run the backend somewhere reachable over HTTPS (a small server, Tailscale, or a Cloudflare Tunnel), or use your Mac's local address on the same Wi-Fi.

## Security notes

- Keep `API_TOKEN` and provider keys on the server, never in the apps' source.
- The server listens on `127.0.0.1` by default. To reach it from your iPhone, put it behind HTTPS (a reverse proxy, Tailscale, or a Cloudflare Tunnel).
- There is no rate limiting yet.

## Roadmap

- [x] SwiftUI app for macOS (list, add sheet, detail with map)
- [ ] Verify the iPhone build and the WidgetKit widget in Xcode
- [ ] App icon and screenshots
- [ ] Push notifications on status change (APNs)
- [ ] Carrier picker and carrier-code lookup
- [ ] Docker image

## License

[MIT](LICENSE)
