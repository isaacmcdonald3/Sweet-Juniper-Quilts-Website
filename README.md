# Sweet Juniper Quilts

A React and TypeScript storefront with an Express API, Supabase PostgreSQL database, and a lightweight local-first introduction. The introduction appears immediately on the customer-facing static site while it wakes the separate API service; it transitions into the homepage in place when the API and initial published data are ready.

## Architecture

- `client/` is the one customer-facing React app. Render deploys it as a **Static Site** on the custom customer domain.
- `server/` is an independently deployable Express **Web Service**. Point a dedicated API subdomain (for example, `api.yourdomain.com`) to this service.
- Storefront data uses the server configured by `VITE_API_BASE_URL`; only owner sign-in talks to Supabase Auth from the browser using the public anon key. No server secrets are sent to the client.
- The Express server uses the Supabase service-role key only on the server. Its database client bypasses RLS, so protected routes must authenticate and authorize each operation with the server middleware.
- `supabase/migrations/` contains versioned, additive SQL migrations. Row Level Security is enabled for application tables; only published catalog and homepage content have public read policies. Orders and administrative data have no public policies.
- The customer catalog, detail pages, and featured homepage pieces are read from the existing Supabase tables through the API. Public API queries explicitly filter out unpublished, archived, and made-to-order products because the server's service-role key bypasses RLS. Custom craft requests are handled by email.
- The existing `GET /api/storefront/bootstrap` contract is retained. The storefront uses `GET /api/storefront/homepage`, `GET /api/categories`, `GET /api/products`, and `GET /api/products/:slug` for its richer customer views.
- Owner sign-in uses Supabase Auth in the browser with the public anon key; all owner operations go through `/api/admin/*`, which verifies the access token and exact `OWNER_USER_ID` on the server before using its service-role database connection.
- Product and homepage media are stored and delivered by Cloudinary. Uploads pass through owner-protected API routes; Cloudinary credentials remain server-only. PayPal checkout runs in Sandbox by default; customer email notifications remain a later integration.

The intro uses three small, locally bundled original quilt-pattern illustrations in `client/public/images/intro/`, so it never needs the API or a third-party image host to render. They are illustrative stand-ins, not supplied product photography; replace them with appropriately licensed, optimized quilt and kinusaiga photos when available.

## Requirements

- Node.js 20 or newer and npm
- Supabase CLI (for linking the project and applying migrations)
- A Supabase project for database-backed API readiness

## Install and run locally

From the repository root:

```sh
npm install
```

Copy `.env.example` to `.env` and fill in the server's Supabase project URL and service-role key. Keep `.env` private and never use a service-role key in a `VITE_` variable. Then start the API and frontend:

```sh
npm run dev
```

The API listens on `http://localhost:3001`; Vite serves the frontend on `http://localhost:5173`. The opening presentation appears before any API response. It probes `/api/health` immediately to wake the service, then periodically checks `/api/ready` for database readiness. Only after readiness does it request `/api/storefront/homepage` and transition to the storefront. If the API does not become available within two minutes, the intro remains visible and offers a retry button.

The catalog search, category filter, and sorting operate on published ready-to-ship products returned by the API. Cart state exists only in memory for the current browser session; there is no local product database or localStorage persistence. The server re-reads product prices and stock at checkout, reserves inventory atomically for 30 minutes, and releases expired or abandoned reservations once per minute. A reservation is extended for 10 minutes during server-side payment capture. Made-to-order products are not sold online; customers are directed to sweetjuniperquilts@gmail.com for custom crafts.

Homepage copy is read from published rows in `homepage_content`. The Owner Dashboard manages the introduction, about copy, contact email, promotion, section visibility/order, and featured products. `home.heroMediaId`, `about.mediaId`, and `home.promotionalContent.mediaId` reference active `product_media` rows. Upload a media asset from its product editor, then select it in Homepage management. A selected media asset cannot be removed or replaced until it is unselected, preventing broken homepage references. `shipping` and `privacy` rows remain editable as custom JSON content.

Useful commands:

```sh
npm run build       # Type-check and build the frontend and server
npm run lint        # Lint client, server, and shared TypeScript
npm test            # Run cart-state and API tests
npm run dev:client  # Run only Vite
npm run dev:server  # Run only Express
```

## Environment configuration

`.env.example` documents the variables without containing credentials:

- `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`: public Supabase Auth configuration for the client. The anon key is not a service-role secret.
- `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`: server-only Supabase connection settings.
- `OWNER_USER_ID`: Supabase Auth user UUID allowed by the owner authorization middleware.
- `CLIENT_ORIGIN`: comma-separated allowed browser origins (local Vite origin by default).
- `SERVER_PORT`: local Express port.
- `VITE_API_BASE_URL`: API origin used by Vite at build time (defaults to `http://localhost:3001` locally).
- `PAYPAL_CLIENT_ID` and `PAYPAL_CLIENT_SECRET`: server-only PayPal REST app credentials. Use the Sandbox values first.
- `PAYPAL_MODE`: `sandbox` (default) or `live`.
- `PAYPAL_LIVE_PAYMENTS_ENABLED`: explicit safety gate; keep `false` until Sandbox testing is complete.
- `PAYPAL_WEBHOOK_ID`: server-only ID of the webhook registered for the PayPal app. Checkout remains disabled until it is configured.
- `CHECKOUT_SHIPPING_AMOUNT`: flat USD shipping charge per order (defaults to `$8.00`).

For production, set `VITE_API_BASE_URL` to the HTTPS API subdomain in the Render Static Site's build environment. Set `CLIENT_ORIGIN` on the Render Web Service to the HTTPS customer domain. Vite variables are public build-time configuration; never put credentials or private keys in them. Render static-site builds must be redeployed after changing build environment variables.

## Supabase setup and migrations

1. Install the [Supabase CLI](https://supabase.com/docs/guides/cli) and create a Supabase project.
2. Link this checkout to the project:

   ```sh
   supabase login
   supabase link --project-ref YOUR_PROJECT_REF
   ```

3. Apply the committed migrations:

   ```sh
   supabase db push
   ```

   The initial migration creates catalog, media, order snapshots, payment, fulfillment, homepage, email-log, and audit tables; enables RLS; and adds public read policies for published content. Later migrations add owner policies and media poster/removal metadata without replacing existing media records. The media migration updates the public policy so removed assets are no longer returned. Migrations do not delete or overwrite existing records. The seed file is intentionally empty.

4. Put the project URL and **service-role** key in the local `.env` file. Obtain them from the Supabase project's API settings. Never commit the key or expose it to Vite.
5. Start the app and check `http://localhost:3001/api/ready`. It returns ready only after the API can query the migrated database. `/api/health` is a lightweight process health check used to wake the Render service and does not expose database details.

### Owner dashboard setup

1. Apply all migrations with `supabase db push`, including `20261112000000_owner_dashboard.sql`, `20261113000000_media_management.sql`, and `20261114000000_paypal_checkout.sql`. The owner migration adds a low-inventory threshold, restrictive category deletion, and owner-only RLS policies; the media migration adds poster and cleanup metadata; the checkout migration adds inventory reservations and PayPal order/refund records.
2. In the Supabase Dashboard, keep public sign-ups disabled. Create or invite the owner's account using the Supabase Auth user-management screen; there is no public registration page.
3. Set that user's **app metadata** (not user metadata) to include `"is_owner": true`, and set the matching Auth user UUID as `OWNER_USER_ID` on the Render Web Service. The app metadata claim enables the owner-only RLS policies; the API additionally compares the authenticated user ID with `OWNER_USER_ID`. Sign out and sign in again after changing app metadata so the new claim is in the token.
4. Configure `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` on the Render Static Site build environment. These are public client settings. Never expose `SUPABASE_SERVICE_ROLE_KEY` to the frontend.
5. Visit `/owner/login` on the customer domain. Sign in, then manage products, inventory, categories, homepage content, and orders, fulfillment, tracking, and PayPal refunds. Category archival is unpublishing; a category with linked products cannot be deleted. No owner screen can manually mark a payment as paid or refunded.

The server-side owner middleware verifies each bearer token with Supabase Auth and compares its user ID to `OWNER_USER_ID` before admin routes execute. The service-role key bypasses RLS, so this server-side authorization remains mandatory even with owner policies in place.

### Cloudinary setup

1. Create or sign in to a Cloudinary account at [cloudinary.com](https://cloudinary.com/). In the Cloudinary Console, open the product environment's **API Keys** settings. Copy the **Cloud name**, **API Key**, and **API Secret**. The API Secret is private; never add it to a `VITE_` variable, the static site's build environment, or client code.
2. Set `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, and `CLOUDINARY_API_SECRET` only in the local server `.env` or the Render **Web Service** environment. The server requires all three values together. The API Key is also kept server-side.
3. Optional upload caps are `CLOUDINARY_IMAGE_MAX_BYTES` (default 15,000,000 bytes) and `CLOUDINARY_VIDEO_MAX_BYTES` (default 90,000,000 bytes). Both are per-file limits; the video cap leaves room for multipart request overhead on the API host. The server accepts JPEG, PNG, WebP, and AVIF images, and MP4, WebM, and QuickTime/MOV videos. Your Cloudinary account plan may impose lower limits.
4. An owner session is required for every upload, replacement, poster, and cleanup operation. The API validates the media type and size, uploads to Cloudinary from memory, and saves the immutable Cloudinary asset ID, delivery public ID, HTTPS URL, ordering, primary-image, poster, and cleanup state in the existing `product_media` table. Render's local filesystem is not used for permanent media. The browser receives upload progress but never Cloudinary credentials.
5. In **Products**, edit a saved product to add, preview, reorder, replace, or remove media. Set an image as primary and upload or replace video posters there. In **Homepage management**, select active media belonging to published products for the introduction, about section, and promotion. Media selected on the homepage must be unselected before it can be removed or replaced.
6. The **Media library** lists product asset IDs and pending cleanup work. A database backup preserves those records and references, but it does **not** back up the actual files in Cloudinary; arrange Cloudinary backups/export separately if needed.

### PayPal Sandbox setup and test purchases

1. Sign in at [PayPal Developer](https://developer.paypal.com/), open **Apps & Credentials**, select **Sandbox**, and create a REST app for Sweet Juniper Quilts. Copy the app's **Client ID** and **Secret**. Keep the Secret server-only.
2. In the same Sandbox app, create a webhook pointing to `https://YOUR_API_HOST/api/paypal/webhook`. Subscribe to `PAYMENT.CAPTURE.COMPLETED`, `PAYMENT.CAPTURE.DENIED`, and `PAYMENT.CAPTURE.REFUNDED`. Copy the generated **Webhook ID**. Localhost is not reachable by PayPal; use a deployed HTTPS Sandbox API or a secure HTTPS tunnel for local tests.
3. Set `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, `PAYPAL_WEBHOOK_ID`, `PAYPAL_MODE=sandbox`, and `PAYPAL_LIVE_PAYMENTS_ENABLED=false` in the API's local `.env` or Render **Web Service** environment. Set `CHECKOUT_SHIPPING_AMOUNT=8.00` for the current flat rate, or configure the shop's chosen flat charge. Never put the Secret in a `VITE_` variable or Static Site build settings.
4. In PayPal Developer **Sandbox Accounts**, use a Sandbox personal account to act as the buyer and the app's Sandbox business account as the merchant. PayPal login at checkout must use the Sandbox buyer credentials, not a real PayPal account.
5. Apply all migrations, including `20261114000000_paypal_checkout.sql`, then restart/redeploy the API. A `GET /api/checkout/config` response should report `configured: true` and `mode: "sandbox"`; it reports false until credentials and webhook ID are present.
6. Add a published, in-stock **Ready to ship** product. Add one or more products to the bag, proceed to checkout, enter test contact and shipping details, review the server-verified line items and total, then pay using the PayPal Sandbox personal account. The customer confirmation appears only after the API verifies the completed PayPal order and capture and commits the order and inventory changes in Supabase.
7. Verify the order in **Owner Dashboard → Orders**. Search and filter it, open the detail panel, add a carrier/tracking number, mark it shipped, and use the refund/cancel controls to exercise server-side Sandbox refunds.
8. Before any Live configuration, verify these cases in Sandbox: single- and multi-product purchase; buyer cancellation; declined/failing payment; edited browser prices; repeated capture requests and duplicate webhook deliveries; two buyers racing for the final unit; abandoned checkout and automatic stock release after 30 minutes; order visibility in the dashboard; and historical snapshots after changing a product's price. Use separate test products/accounts or restore test inventory between cases. Webhook delivery can be inspected and resent from the PayPal Developer dashboard.

The API creates and captures PayPal orders itself and confirms capture status, amount, currency, and reservation identifiers from PayPal's Orders API; a browser return alone never confirms an order. Webhook signatures are verified using PayPal's verification endpoint and the configured webhook ID. Duplicate event IDs are stored once and capture processing is idempotent. Ready-to-ship quantities are held by a Postgres transaction; the 30-minute pre-capture hold is released by the API cleanup job, including after service restart. Capture atomically moves the hold to a 10-minute non-cancellable state so a concurrent cancel cannot release stock while PayPal is processing; failed or stalled captures are released after that deadline. Refund records are written only after PayPal confirms the refund. The owner UI cannot manually alter payment status.

Do not set `PAYPAL_MODE=live` or enable `PAYPAL_LIVE_PAYMENTS_ENABLED` until all test cases are complete and the merchant's live app and live webhook have been configured and reviewed. This phase does not activate Live payments or begin the next development phase.

## Render deployment

Create two Render services from this GitHub repository; do not point the customer domain at the sleeping API. The customer stays on the same static-site domain after the intro fades—the frontend calls the API in the background rather than redirecting to the backend host.

**Static Site (customer domain)**

- Root directory: repository root
- Build command: `npm ci && npm run build --workspace @sweet-juniper/shared && npm run build --workspace @sweet-juniper/client`
- Publish directory: `client/dist`
- Build environment: `VITE_API_BASE_URL=https://api.yourdomain.com`
- Build environment: `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` from the Supabase project
- Add the custom customer domain to this Static Site and configure its DNS as Render instructs.
- Add an SPA rewrite from `/*` to `/index.html` with status `200`.

**Web Service (API subdomain)**

- Root directory: repository root
- Build command: `npm ci --include=dev && npm run build --workspace @sweet-juniper/shared && npm run build --workspace @sweet-juniper/server`
- Start command: `npm run start --workspace @sweet-juniper/server`
- Set `NODE_ENV=production`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `OWNER_USER_ID`, `CLIENT_ORIGIN=https://yourdomain.com`, and the three server-only Cloudinary credentials. Add PayPal Sandbox credentials, webhook ID, and `PAYPAL_MODE=sandbox` after completing the Sandbox app setup.
- Optionally set the Cloudinary per-file size limits on the Web Service. Do not copy Cloudinary credentials to the Static Site.
- Add `api.yourdomain.com` as a custom domain to this Web Service and configure its DNS as Render instructs. Render terminates HTTPS for both services.

The two services deploy independently from the same GitHub repository. The frontend boot animation remains usable while the Web Service starts; the client hides startup/network errors and only shows a friendly retry message. After applying a database migration, redeploy the API only if its code changed; no Render rebuild is required for product, category, inventory, or homepage-content changes.

## Scope and next steps

The customer homepage, published ready-to-ship catalog, product detail pages, in-memory cart, PayPal Sandbox checkout, verified webhook handling, inventory reservations, order snapshots, and owner order fulfillment/refund tools are implemented. Before production, configure and protect the Supabase owner account, apply all migrations (including `20261114000000_paypal_checkout.sql`), configure Cloudinary and PayPal Sandbox on the API service, supply licensed quilt/kinusaiga photos and business contact/policy text, and verify the HTTPS API origin/CORS settings. Complete the documented Sandbox test matrix before considering Live payments. Customer and owner email notifications remain future work.
