# Sweet Juniper Quilts

A React and TypeScript storefront with an Express API, Supabase PostgreSQL database, and a lightweight local-first introduction. The introduction appears immediately on the customer-facing static site while it wakes the separate API service; it transitions into the homepage in place when the API and initial published data are ready.

## Architecture

- `client/` is the one customer-facing React app. Render deploys it as a **Static Site** on the custom customer domain.
- `server/` is an independently deployable Express **Web Service**. Point a dedicated API subdomain (for example, `api.yourdomain.com`) to this service.
- Storefront data uses the server configured by `VITE_API_BASE_URL`; only owner sign-in talks to Supabase Auth from the browser using the public anon key. No server secrets are sent to the client.
- The Express server uses the Supabase service-role key only on the server. Its database client bypasses RLS, so protected routes must authenticate and authorize each operation with the server middleware.
- `supabase/migrations/` contains versioned, additive SQL migrations. Row Level Security is enabled for application tables; only published catalog and homepage content have public read policies. Orders and administrative data have no public policies.
- The customer catalog, detail pages, and featured homepage pieces are read from the existing Supabase tables through the API. Public API queries explicitly filter out unpublished and archived products because the server's service-role key bypasses RLS.
- The existing `GET /api/storefront/bootstrap` contract is retained. The storefront uses `GET /api/storefront/homepage`, `GET /api/categories`, `GET /api/products`, and `GET /api/products/:slug` for its richer customer views.
- Owner sign-in uses Supabase Auth in the browser with the public anon key; all owner operations go through `/api/admin/*`, which verifies the access token and exact `OWNER_USER_ID` on the server before using its service-role database connection.
- Cloudinary, PayPal, and Resend credentials and operations belong on the server; integrations and commerce workflows are intentionally not implemented in this foundation.

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

The catalog search, category filter, and sorting operate on the published records returned by the API. Cart state exists only in memory for the current browser session; there is no local product database, localStorage persistence, or checkout/payment flow. Before a future checkout is added, the server must reload each product and validate its current price and available quantity from Supabase.

Homepage copy is read from published rows in `homepage_content`. The `home` row may contain `title`, `introduction`, `eyebrow`, `imageUrl`, `imageAlt`, or `videoUrl`; the `about` row may contain `title`, `body`, and `imageUrl`; `contact` may contain `email`. `shipping` and `privacy` rows may contain `title` and `body`. When a row or field is absent, the page displays temporary copy. Featured products are managed by the existing `products.is_featured` flag and their existing `product_media` rows. No new table or migration was needed for this phase.

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

   The initial migration creates catalog, media, order snapshots, payment, fulfillment, homepage, email-log, and audit tables; enables RLS; and adds only the public read policies needed for published catalog and homepage content. It does not delete or overwrite existing data. The seed file is intentionally empty.

4. Put the project URL and **service-role** key in the local `.env` file. Obtain them from the Supabase project's API settings. Never commit the key or expose it to Vite.
5. Start the app and check `http://localhost:3001/api/ready`. It returns ready only after the API can query the migrated database. `/api/health` is a lightweight process health check used to wake the Render service and does not expose database details.

### Owner dashboard setup

1. Apply all migrations with `supabase db push`, including `20261112000000_owner_dashboard.sql`. The migration adds a low-inventory threshold without changing existing product data, makes category deletion restrictive, and adds owner-only RLS policies based on the trusted `app_metadata.is_owner` JWT claim.
2. In the Supabase Dashboard, keep public sign-ups disabled. Create or invite the owner's account using the Supabase Auth user-management screen; there is no public registration page.
3. Set that user's **app metadata** (not user metadata) to include `"is_owner": true`, and set the matching Auth user UUID as `OWNER_USER_ID` on the Render Web Service. The app metadata claim enables the owner-only RLS policies; the API additionally compares the authenticated user ID with `OWNER_USER_ID`. Sign out and sign in again after changing app metadata so the new claim is in the token.
4. Configure `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` on the Render Static Site build environment. These are public client settings. Never expose `SUPABASE_SERVICE_ROLE_KEY` to the frontend.
5. Visit `/owner/login` on the customer domain. Sign in, then manage products, inventory, categories, homepage content, and read-only order details. Category archival is unpublishing; a category with linked products cannot be deleted. No owner screen can mark a payment as paid.

The server-side owner middleware verifies each bearer token with Supabase Auth and compares its user ID to `OWNER_USER_ID` before admin routes execute. The service-role key bypasses RLS, so this server-side authorization remains mandatory even with owner policies in place.

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
- Set `NODE_ENV=production`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `OWNER_USER_ID`, and `CLIENT_ORIGIN=https://yourdomain.com`.
- Add `api.yourdomain.com` as a custom domain to this Web Service and configure its DNS as Render instructs. Render terminates HTTPS for both services.

The two services deploy independently from the same GitHub repository. The frontend boot animation remains usable while the Web Service starts; the client hides startup/network errors and only shows a friendly retry message. After applying a database migration, redeploy the API only if its code changed; no Render rebuild is required for product, category, inventory, or homepage-content changes.

## Scope and next steps

The customer homepage, published catalog, product detail pages, and in-memory cart are implemented, as are owner sign-in, product/category administration, low-inventory alerts, homepage content management, and read-only orders. Secure media uploads, order fulfillment actions, customer checkout, PayPal, and Resend delivery remain future work. Before production, configure and protect the Supabase owner account, apply the new migration, supply licensed quilt/kinusaiga photos and business contact/policy text, and verify the HTTPS API origin/CORS settings.
