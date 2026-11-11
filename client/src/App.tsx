import { useEffect, useState } from "react";
import type { StorefrontBootstrap } from "@sweet-juniper/shared";

const apiBaseUrl = (import.meta.env.VITE_API_BASE_URL || "http://localhost:3001").replace(
  /\/+$/,
  "",
);
const maxWaitMs = 120_000;
const retryDelays = [1_000, 2_000, 5_000, 8_000];

type View = "intro" | "unavailable" | "transitioning" | "storefront";

function App() {
  const [view, setView] = useState<View>("intro");
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [storefront, setStorefront] = useState<StorefrontBootstrap | null>(null);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let request: AbortController | undefined;
    const startedAt = Date.now();
    const deadlineTimer = setTimeout(() => {
      if (active) setView("unavailable");
    }, maxWaitMs);

    setView("intro");
    setElapsedSeconds(0);
    setStorefront(null);

    const elapsedTimer = setInterval(() => {
      if (active) {
        setElapsedSeconds(Math.floor((Date.now() - startedAt) / 1_000));
      }
    }, 1_000);

    async function fetchApi(path: string): Promise<Response> {
      const controller = new AbortController();
      request = controller;
      const timeout = setTimeout(() => controller.abort(), 8_000);
      try {
        return await fetch(`${apiBaseUrl}${path}`, {
          cache: "no-store",
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timeout);
        if (request === controller) request = undefined;
      }
    }

    async function checkBackend(attempt: number): Promise<void> {
      if (!active) return;
      const elapsed = Date.now() - startedAt;
      if (elapsed >= maxWaitMs) {
        setView("unavailable");
        return;
      }

      try {
        const health = await fetchApi("/api/health");
        if (Date.now() - startedAt >= maxWaitMs) {
          setView("unavailable");
          return;
        }
        if (health.ok) {
          const ready = await fetchApi("/api/ready");
          if (ready.ok) {
            const response = await fetchApi("/api/storefront/bootstrap");
            if (response.ok) {
              const data = (await response.json()) as StorefrontBootstrap;
              if (active && Date.now() - startedAt < maxWaitMs) {
                clearTimeout(deadlineTimer);
                setStorefront(data);
                setView("transitioning");
                timer = setTimeout(() => {
                  if (active) setView("storefront");
                }, 850);
              }
              return;
            }
          }
        }
      } catch {
        // Keep the presentation visible for network errors and startup timeouts.
      }

      if (!active) return;
      const wait = retryDelays[Math.min(attempt, retryDelays.length - 1)];
      if (Date.now() - startedAt + wait >= maxWaitMs) {
        if (Date.now() >= startedAt + maxWaitMs) {
          setView("unavailable");
          return;
        }
        timer = setTimeout(() => active && setView("unavailable"), Math.max(0, maxWaitMs - (Date.now() - startedAt)));
        return;
      }
      timer = setTimeout(() => void checkBackend(attempt + 1), wait);
    }

    void checkBackend(0);
    return () => {
      active = false;
      request?.abort();
      if (timer) clearTimeout(timer);
      clearTimeout(deadlineTimer);
      clearInterval(elapsedTimer);
    };
  }, [retry]);

  if (view === "storefront") {
    return <Storefront data={storefront} />;
  }

  return (
    <>
      {view === "transitioning" && <Storefront data={storefront} faded />}
      <Introduction
        unavailable={view === "unavailable"}
        waiting={elapsedSeconds >= 15}
        onRetry={() => setRetry((current) => current + 1)}
        faded={view === "transitioning"}
      />
    </>
  );
}

function Introduction({
  unavailable,
  waiting,
  faded,
  onRetry,
}: {
  unavailable: boolean;
  waiting: boolean;
  faded: boolean;
  onRetry: () => void;
}) {
  return (
    <main className={`intro ${faded ? "intro--leaving" : ""}`}>
      <div className="intro__art" aria-hidden="true">
        <div className="intro__photo intro__photo--one" />
        <div className="intro__photo intro__photo--two" />
        <div className="intro__photo intro__photo--three" />
        <div className="intro__shade" />
      </div>
      <section className="intro__content" aria-label="Welcome to Sweet Juniper Quilts">
        <a className="brand brand--light" href="/" aria-label="Sweet Juniper Quilts home">
          <span className="brand__mark" aria-hidden="true">
            ✳
          </span>
          <span>Sweet Juniper Quilts</span>
        </a>
        <p className="eyebrow">HANDMADE WITH HEART</p>
        <h1>A little warmth, stitched to last.</h1>
        <p className="intro__welcome">
          Welcome to Sweet Juniper Quilts, where thoughtful quilts and kinusaiga art bring
          color, comfort, and a little joy to everyday life.
        </p>
        <div className="intro__status" role="status" aria-live="polite">
          {unavailable ? (
            <>
              <p>Our shop is taking a little longer to open. Please try again in a moment.</p>
              <button className="retry-button" onClick={onRetry} type="button">
                Try again
              </button>
            </>
          ) : (
            <>
              <span className="loader" aria-hidden="true" />
              <span>
                {waiting ? "Thanks for your patience. We’re still getting the shop ready..." : "Preparing the shop for you..."}
              </span>
            </>
          )}
        </div>
        <span className="intro__caption">Made slowly. Meant to be cherished.</span>
      </section>
      <div className="slide-dots" aria-hidden="true">
        <span />
        <span />
        <span />
      </div>
    </main>
  );
}

function Storefront({
  data,
  faded = false,
}: {
  data: StorefrontBootstrap | null;
  faded?: boolean;
}) {
  return (
    <main className={`store ${faded ? "store--arriving" : ""}`}>
      <header className="store__header">
        <a className="brand" href="/" aria-label="Sweet Juniper Quilts home">
          <span className="brand__mark" aria-hidden="true">
            ✳
          </span>
          <span>{data?.shopName || "Sweet Juniper Quilts"}</span>
        </a>
        <span className="store__note">HANDMADE WITH HEART</span>
      </header>
      <section className="store__welcome">
        <p className="eyebrow">A WARM WELCOME</p>
        <h1>{data?.welcomeMessage || "A little warmth, stitched to last."}</h1>
        <p>Thoughtful quilts and kinusaiga art, made to bring joy to your home.</p>
      </section>
      <section className="store__collection" aria-labelledby="collection-title">
        <div>
          <p className="eyebrow">MADE WITH CARE</p>
          <h2 id="collection-title">A home for handmade</h2>
        </div>
        {data?.categories.length ? (
          <ul className="category-list">
            {data.categories.map((category) => (
              <li key={category.id}>{category.name}</li>
            ))}
          </ul>
        ) : (
          <p className="store__coming">Our collection is being prepared. Please visit again soon.</p>
        )}
      </section>
      {data?.featuredProducts.length ? (
        <section className="product-list" aria-label="Featured pieces">
          {data.featuredProducts.map((product) => (
            <article className="product-card" key={product.id}>
              {product.media[0] ? (
                <img src={product.media[0].url} alt={product.media[0].altText || product.name} />
              ) : (
                <div className="product-card__placeholder" aria-hidden="true">
                  ✳
                </div>
              )}
              <h3>{product.name}</h3>
              <p>{product.description}</p>
              <span>
                {new Intl.NumberFormat(undefined, {
                  style: "currency",
                  currency: product.currency,
                }).format(product.price)}
              </span>
            </article>
          ))}
        </section>
      ) : null}
      <footer className="store__footer">Sweet Juniper Quilts · Made slowly. Meant to be cherished.</footer>
    </main>
  );
}

export default App;
