# Parcel Open

An open-source package tracker for Mac and iPhone, with a self-hostable backend that tracks shipments from carriers worldwide.

Paste a tracking number and the carrier is detected automatically. Active deliveries show at a glance, in the app and in a desktop widget.

> **Status:** the backend and the macOS app work and are tested. The iPhone app and the widget are written but need Xcode to build (not yet verified on a device).

## Repository layout

| Folder | What | Status |
| --- | --- | --- |
| [`backend/`](backend) | TypeScript tracking API (Fastify + SQLite) | working, 85 tests |
| [`app/`](app) | SwiftUI app for macOS and iOS, shared `ParcelKit` package, WidgetKit widget | macOS app working, 11 tests; iOS and widget need Xcode |

## How carrier coverage works

No free open-source library covers every carrier: carrier sites change often, and scraping them one by one breaks (and is often against their terms). Parcel Open uses **free official carrier APIs**, one provider per carrier, and a tracking link for the rest. Everything below the line "Paid" is optional and never needed.

### Free

| Provider | Covers | What is free | What I could and could not confirm |
| --- | --- | --- | --- |
| `dhl` | DHL Paket, Express, eCommerce | Free key, 250 calls/day, 1 call/s ([DHL support](https://support-developer.dhl.com/support/solutions/articles/47001249492-is-the-dhl-shipment-tracking-unified-api-free-of-charge-)) | Response format checked against DHL's public demo key. Terms for commercial use not confirmed: read them on developer.dhl.com |
| `ups` | UPS small packages (`1Z…`) | Tracking API is free; the developer portal is free | Third-party guides disagree on whether a UPS shipper account number is required to create an app. Try with your normal UPS.com login. Format follows UPS's official OpenAPI files; not run with real credentials |
| `laposte` | Colissimo, Chronopost, tracked mail | A "Freemium" plan exists on [developer.laposte.fr](https://developer.laposte.fr) | Daily quota and commercial-use terms not confirmed. Field names come from open-source clients of the API; not run with a real key |
| tracking link | every carrier | always | Opens the carrier's page, or 17TRACK's public page. No fake data, no key |

Mondial Relay, Relais Colis, Vinted Go, Amazon, China Post, Thailand Post and Japan Post have no free public tracking API that I know of: they use the tracking link.

"Free" does not mean unlimited or allowed for any use: check each provider's quota and terms, especially if you use the data for a business.

### Paid or capped (optional)

| Provider | Notes |
| --- | --- |
| `ship24` | Free plan limited to 10 shipments a month, any carrier. Format from Ship24's OpenAPI file; not run with a real key |
| `17track` | Paid after a one-time allowance of 200 numbers for accounts created in 2026. Format from the documentation; not run with a real key |
| `aftership` | API access is on paid plans. Format from the official SDK types; not run with a real key |
| `mock` | Fake data, only with `PROVIDERS=mock`, for development. Packages are flagged **DEMO** in the app |

Providers are tried in this order: `dhl`, `ups`, `laposte`, `17track`, `aftership`, `ship24` (override with `PROVIDERS`). A provider that cannot handle a number is skipped. Adding a provider means implementing a small interface (`TrackingProvider` in [`backend/src/domain.ts`](backend/src/domain.ts)); `backend/src/providers/dhl.ts` is a compact example.

## Setting up provider keys

Save a key without showing it on screen, then test it. The key goes into `backend/.env` (never committed):

```bash
cd backend
npm run set-key -- DHL_API_KEY        # hidden prompt, paste the key and press Enter
npm run set-key -- LAPOSTE_API_KEY
npm run set-key -- UPS_CLIENT_ID
npm run set-key -- UPS_CLIENT_SECRET
npm run doctor                        # tests every configured key, prints only ✓ / ✗
npm start                             # restart the backend to use them
```

- **DHL:** on [developer.dhl.com](https://developer.dhl.com/api-reference/shipment-tracking), register, create an app, subscribe it to *Shipment Tracking - Unified* and copy its API key. A first key is limited to 250 calls a day.
- **UPS:** on [developer.ups.com](https://developer.ups.com), sign in with a UPS.com account, create an app with the *Tracking* product and copy its Client ID and Client Secret (the secret is shown once). If the portal insists on a shipper account number, skip UPS: its parcels will use the tracking link.
- **La Poste:** on [developer.laposte.fr](https://developer.laposte.fr), create an account and an application, subscribe it to the *Suivi* API with the free "Freemium" offer and copy the key (64 characters). It covers Colissimo and Chronopost. Mondial Relay, Relais Colis and Vinted Go have no public tracking API: use the carrier link.
- **Ship24, 17TRACK, AfterShip:** same commands with `SHIP24_API_KEY`, `TRACK17_API_KEY`, `AFTERSHIP_API_KEY`.

## Backend quick start

Requires Node.js 22.13 or later.

```bash
cd backend
npm install
cp .env.example .env     # then set API_TOKEN (openssl rand -hex 32) and a provider key
npm run dev
```

Without any provider key the server keeps packages with a tracking link and invents nothing. For development you can run with `PROVIDERS=mock` (fake data): the last digit of the tracking number picks the scenario (`0` delivered, `1` out for delivery, `2` exception, `3` pending, `4` ready for pickup, `5` failed attempt, anything else in transit).

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
| `GET` | `/v1/packages/:id` | Package with full event history and map position |
| `GET` | `/v1/carriers/detect?number=` | Carrier guessed from the tracking number |
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

Add many parcels at once with *Add several packages* (⇧⌘N): paste one tracking number per line, optionally followed by a name.

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

## Carrier and map

- **Carrier:** a quick local guess from the shape of the number (UPS `1Z…`, USPS, La Poste/Colissimo, Royal Mail, China Post, DHL, FedEx, Amazon…) is shown as soon as you paste it, and kept until the provider returns its own carrier name.
- **Map:** place names from tracking events are geocoded by the backend through [OpenStreetMap Nominatim](https://operations.osmfoundation.org/policies/nominatim/) (identifying User-Agent, one request per second, results cached in the database). Only place names such as "Lyon, France" are sent, never tracking numbers. Set `GEOCODER=off` to disable, or `GEOCODER_URL` to use your own instance.

## Security notes

- Keep `API_TOKEN` and provider keys on the server, never in the apps' source.
- The server listens on `127.0.0.1` by default. To reach it from your iPhone, put it behind HTTPS (a reverse proxy, Tailscale, or a Cloudflare Tunnel).
- There is no rate limiting yet.

## Roadmap

- [x] SwiftUI app for macOS (list, add sheet, detail with map)
- [ ] Verify the iPhone build and the WidgetKit widget in Xcode
- [ ] App icon and screenshots
- [ ] Push notifications on status change (APNs)
- [x] Carrier detection from the tracking number
- [ ] Manual carrier picker
- [ ] Docker image

## License

[MIT](LICENSE)
