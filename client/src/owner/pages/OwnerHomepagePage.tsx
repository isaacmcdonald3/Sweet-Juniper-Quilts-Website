import { useEffect, useMemo, useState } from "react";
import type {
  AdminHomepageContent,
  AdminHomepageMedia,
  AdminProduct,
} from "@sweet-juniper/shared";
import { requestAdminJson } from "../../services/admin-api";
import { useAdminResource } from "../use-admin-resource";

type ContentObject = Record<string, unknown>;
type HomepageDraft = {
  home: ContentObject;
  about: ContentObject;
  contact: ContentObject;
  published: Record<string, boolean>;
};

const editableSections = ["categories", "featured", "about", "promotion", "contact"];
const defaultSectionOrder = [...editableSections];
const sectionLabels: Record<string, string> = {
  categories: "Categories",
  featured: "Featured products",
  about: "Our story",
  promotion: "Promotion",
  contact: "Contact",
};

function asObject(value: unknown): ContentObject {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as ContentObject
    : {};
}

function asText(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function asStringArray(value: unknown, fallback: string[]): string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string")
    ? value
    : fallback;
}

function contentRow(rows: AdminHomepageContent[], key: string): AdminHomepageContent | undefined {
  return rows.find((row) => row.contentKey === key);
}

function productPayload(product: AdminProduct, isFeatured: boolean) {
  return {
    name: product.name,
    description: product.description,
    price: product.price,
    categoryId: product.categoryId,
    subcategory: product.subcategory,
    inventoryQuantity: product.inventoryQuantity,
    lowInventoryThreshold: product.lowInventoryThreshold,
    fulfillmentType: product.fulfillmentType,
    isPublished: product.isPublished,
    isFeatured,
    isArchived: Boolean(product.archivedAt),
  };
}

export function OwnerHomepagePage() {
  const content = useAdminResource<AdminHomepageContent[]>("/api/admin/homepage-content");
  const products = useAdminResource<AdminProduct[]>("/api/admin/products");
  const homepageMedia = useAdminResource<AdminHomepageMedia[]>("/api/admin/homepage-media");
  const [draft, setDraft] = useState<HomepageDraft | null>(null);
  const [featuredIds, setFeaturedIds] = useState<string[]>([]);
  const [extraDrafts, setExtraDrafts] = useState<Record<string, { contentText: string; isPublished: boolean }>>({});
  const [newKey, setNewKey] = useState("");
  const [newContent, setNewContent] = useState("{}");
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!content.data) return;
    const home = contentRow(content.data, "home");
    const about = contentRow(content.data, "about");
    const contact = contentRow(content.data, "contact");
    setDraft({
      home: asObject(home?.content),
      about: asObject(about?.content),
      contact: asObject(contact?.content),
      published: {
        home: home?.isPublished ?? true,
        about: about?.isPublished ?? true,
        contact: contact?.isPublished ?? true,
      },
    });
  }, [content.data]);

  useEffect(() => {
    if (products.data) setFeaturedIds(products.data.filter((product) => product.isFeatured).map((product) => product.id));
  }, [products.data]);

  const mediaOptions = useMemo(() => (products.data || [])
    .filter((product) => product.isPublished && !product.archivedAt)
    .flatMap((product) => product.media.map((media) => ({
      ...media,
      productName: product.name,
    })))
    .concat((homepageMedia.data || []).map((media) => ({
      ...media,
      productName: "Homepage library",
    }))), [homepageMedia.data, products.data]);

  function updateSection(section: "home" | "about" | "contact", key: string, value: unknown) {
    setDraft((current) => {
      if (!current) return current;
      const nextSection = { ...current[section] };
      if (value === undefined || value === "") delete nextSection[key];
      else nextSection[key] = value;
      return { ...current, [section]: nextSection };
    });
  }

  function updatePromotion(key: string, value: unknown) {
    const promotion = { ...asObject(draft?.home.promotionalContent) };
    if (value === undefined || value === "") delete promotion[key];
    else promotion[key] = value;
    updateSection("home", "promotionalContent", promotion);
  }

  function getSectionVisibility(): Record<string, boolean> {
    const stored = asObject(draft?.home.sectionVisibility);
    return Object.fromEntries(editableSections.map((section) => [section, stored[section] !== false]));
  }

  function sectionOrder(): string[] {
    const stored = asStringArray(draft?.home.sectionOrder, defaultSectionOrder);
    return [...new Set([...stored.filter((section) => editableSections.includes(section)), ...defaultSectionOrder])];
  }

  async function saveSection(key: "home" | "about" | "contact") {
    if (!draft) return;
    setBusy(key);
    setMessage("");
    setError("");
    try {
      await requestAdminJson<void>(`/api/admin/homepage-content/${key}`, {
        method: "PUT",
        body: { content: draft[key], isPublished: draft.published[key] },
      });
      setMessage(`The ${key} homepage section was saved.`);
      content.reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : `The ${key} section could not be saved.`);
    } finally {
      setBusy("");
    }
  }

  async function saveFeaturedProducts() {
    const publicProducts = (products.data || []).filter((product) => product.isPublished && !product.archivedAt);
    const selected = new Set(featuredIds);
    setBusy("featured");
    setMessage("");
    setError("");
    try {
      for (const product of publicProducts) {
        await requestAdminJson<AdminProduct>(`/api/admin/products/${product.id}`, {
          method: "PATCH",
          body: productPayload(product, selected.has(product.id)),
        });
      }
      setMessage("Featured products were updated.");
      products.reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Featured products could not be saved.");
      products.reload();
    } finally {
      setBusy("");
    }
  }

  async function saveExtra(key: string, value: { contentText: string; isPublished: boolean }) {
    let parsedContent: unknown;
    try {
      parsedContent = JSON.parse(value.contentText) as unknown;
    } catch {
      setError(`“${key}” must contain valid JSON.`);
      return false;
    }
    setBusy(key);
    setError("");
    setMessage("");
    try {
      await requestAdminJson<void>(`/api/admin/homepage-content/${encodeURIComponent(key)}`, {
        method: "PUT",
        body: { content: parsedContent, isPublished: value.isPublished },
      });
      setMessage(`Homepage content “${key}” was saved.`);
      setExtraDrafts((current) => {
        const next = { ...current };
        delete next[key];
        return next;
      });
      content.reload();
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Homepage content could not be saved.");
      return false;
    } finally {
      setBusy("");
    }
  }

  async function createContent() {
    const key = newKey.trim().toLowerCase();
    if (!/^[a-z][a-z0-9_-]{0,63}$/.test(key)) {
      setError("Use a section key starting with a letter and containing only letters, numbers, dashes, or underscores.");
      return;
    }
    if (await saveExtra(key, { contentText: newContent, isPublished: false })) setNewKey("");
  }

  function getExtraDraft(row: AdminHomepageContent) {
    return extraDrafts[row.contentKey] || {
      contentText: JSON.stringify(row.content, null, 2),
      isPublished: row.isPublished,
    };
  }

  function setPublished(key: string, isPublished: boolean) {
    setDraft((current) => current ? {
      ...current,
      published: { ...current.published, [key]: isPublished },
    } : current);
  }

  function moveSection(section: string, direction: -1 | 1) {
    const currentOrder = sectionOrder();
    const index = currentOrder.indexOf(section);
    const target = index + direction;
    if (target < 0 || target >= currentOrder.length) return;
    [currentOrder[index], currentOrder[target]] = [currentOrder[target], currentOrder[index]];
    updateSection("home", "sectionOrder", currentOrder);
  }

  const rows = content.data || [];
  const promotion = asObject(draft?.home.promotionalContent);
  const visibility = getSectionVisibility();
  const order = sectionOrder();

  return (
    <section className="owner-page">
      <div className="owner-page__heading">
        <div><p className="eyebrow">CUSTOMIZE THE SHOP</p><h1>Homepage management</h1></div>
      </div>
      <p className="owner-help-note">
        Changes are stored in Supabase and appear on the next storefront load. Upload homepage-specific or product photos and videos from the Media area, then select them here.
      </p>
      {message && <p className="owner-success" role="status">{message}</p>}
      {error && <p className="owner-error" role="alert">{error}</p>}
      {(content.error || products.error || homepageMedia.error) && (
        <p className="owner-error" role="alert">
          {content.error || products.error || homepageMedia.error}
          <button className="text-link" onClick={() => { content.reload(); products.reload(); homepageMedia.reload(); }} type="button">Try again</button>
        </p>
      )}
      {!draft || content.loading || products.loading || homepageMedia.loading ? <p className="owner-state" role="status">Loading homepage and media content…</p> : (
        <>
          <section className="owner-panel owner-homepage-editor">
            <div className="owner-panel__heading"><h2>Introduction and featured media</h2><span className="owner-status">{draft.published.home ? "Published" : "Hidden"}</span></div>
            <div className="owner-form-grid">
              <label><span>Eyebrow</span><input maxLength={100} onChange={(event) => updateSection("home", "eyebrow", event.target.value)} value={asText(draft.home.eyebrow, "A SMALL STUDIO · A LOT OF HEART")} /></label>
              <label><span>Heading</span><input maxLength={180} onChange={(event) => updateSection("home", "title", event.target.value)} value={asText(draft.home.title, "A little warmth, stitched to last.")} /></label>
              <label className="owner-form-grid__wide"><span>Introduction</span><textarea maxLength={2500} onChange={(event) => updateSection("home", "introduction", event.target.value)} rows={4} value={asText(draft.home.introduction)} /></label>
              <label className="owner-form-grid__wide">
                <span>Featured homepage image or video</span>
                <select onChange={(event) => updateSection("home", "heroMediaId", event.target.value)} value={asText(draft.home.heroMediaId)}>
                  <option value="">Use the current fallback media</option>
                  {mediaOptions.map((item) => <option key={item.id} value={item.id}>{item.productName} · {item.mediaType}{item.altText ? ` · ${item.altText}` : ""}</option>)}
                </select>
                <small>Product media from published products and homepage assets are available. Upload homepage assets from Media.</small>
              </label>
              <label><span>Image alt text</span><input maxLength={300} onChange={(event) => updateSection("home", "imageAlt", event.target.value)} value={asText(draft.home.imageAlt)} /></label>
            </div>
            <label className="owner-checkbox"><input checked={draft.published.home} onChange={(event) => setPublished("home", event.target.checked)} type="checkbox" /> Publish the introduction</label>
            <button className="button button--primary" disabled={Boolean(busy)} onClick={() => void saveSection("home")} type="button">{busy === "home" ? "Saving…" : "Save introduction"}</button>
          </section>

          <section className="owner-panel owner-homepage-editor">
            <div className="owner-panel__heading"><h2>About section</h2><span className="owner-status">{draft.published.about ? "Published" : "Hidden"}</span></div>
            <div className="owner-form-grid">
              <label><span>Heading</span><input maxLength={180} onChange={(event) => updateSection("about", "title", event.target.value)} value={asText(draft.about.title, "Made slowly, with a story in every stitch.")} /></label>
              <label className="owner-form-grid__wide"><span>About text</span><textarea maxLength={4000} onChange={(event) => updateSection("about", "body", event.target.value)} rows={5} value={asText(draft.about.body)} /></label>
              <label className="owner-form-grid__wide">
                <span>About image</span>
                <select onChange={(event) => updateSection("about", "mediaId", event.target.value)} value={asText(draft.about.mediaId)}>
                  <option value="">Use the current fallback image</option>
                  {mediaOptions.filter((item) => item.mediaType === "image").map((item) => <option key={item.id} value={item.id}>{item.productName} · {item.altText || "Image"}</option>)}
                </select>
              </label>
            </div>
            <label className="owner-checkbox"><input checked={draft.published.about} onChange={(event) => setPublished("about", event.target.checked)} type="checkbox" /> Publish the about section</label>
            <button className="button button--primary" disabled={Boolean(busy)} onClick={() => void saveSection("about")} type="button">{busy === "about" ? "Saving…" : "Save about section"}</button>
          </section>

          <section className="owner-panel owner-homepage-editor">
            <div className="owner-panel__heading"><h2>Featured products</h2></div>
            {products.data?.filter((product) => product.isPublished && !product.archivedAt).length ? (
              <div className="owner-featured-list">
                {products.data.filter((product) => product.isPublished && !product.archivedAt).map((product) => (
                  <label className="owner-checkbox" key={product.id}>
                    <input checked={featuredIds.includes(product.id)} onChange={(event) => setFeaturedIds((current) => event.target.checked ? [...current, product.id] : current.filter((id) => id !== product.id))} type="checkbox" />
                    {product.name}
                  </label>
                ))}
              </div>
            ) : <p className="owner-empty-card">Publish products to choose homepage features.</p>}
            <button className="button button--primary" disabled={Boolean(busy)} onClick={() => void saveFeaturedProducts()} type="button">{busy === "featured" ? "Saving…" : "Save featured products"}</button>
          </section>

          <section className="owner-panel owner-homepage-editor">
            <div className="owner-panel__heading"><h2>Promotional content</h2></div>
            <div className="owner-form-grid">
              <label><span>Heading</span><input maxLength={180} onChange={(event) => updatePromotion("title", event.target.value)} value={asText(promotion.title)} /></label>
              <label><span>Button text</span><input maxLength={80} onChange={(event) => updatePromotion("buttonText", event.target.value)} value={asText(promotion.buttonText)} /></label>
              <label className="owner-form-grid__wide"><span>Message</span><textarea maxLength={2000} onChange={(event) => updatePromotion("body", event.target.value)} rows={3} value={asText(promotion.body)} /></label>
              <label><span>Button link</span><input maxLength={300} onChange={(event) => updatePromotion("buttonUrl", event.target.value)} placeholder="/catalog" value={asText(promotion.buttonUrl)} /></label>
              <label>
                <span>Promotional image</span>
                <select onChange={(event) => updatePromotion("mediaId", event.target.value)} value={asText(promotion.mediaId)}>
                  <option value="">No promotional image</option>
                  {mediaOptions.filter((item) => item.mediaType === "image").map((item) => <option key={item.id} value={item.id}>{item.productName} · {item.altText || "Image"}</option>)}
                </select>
              </label>
            </div>
            <p className="owner-help-note">The promotion is shown when its section is visible and has a heading or message.</p>
            <button className="button button--primary" disabled={Boolean(busy)} onClick={() => void saveSection("home")} type="button">{busy === "home" ? "Saving…" : "Save promotion"}</button>
          </section>

          <section className="owner-panel owner-homepage-editor">
            <div className="owner-panel__heading"><h2>Section visibility and order</h2></div>
            <p className="owner-help-note">The introduction remains at the top. Reorder the sections below it.</p>
            <div className="owner-section-order">
              {order.map((section, index) => (
                <div className="owner-section-order__row" key={section}>
                  <label className="owner-checkbox">
                    <input checked={visibility[section]} onChange={(event) => updateSection("home", "sectionVisibility", { ...visibility, [section]: event.target.checked })} type="checkbox" />
                    {sectionLabels[section]}
                  </label>
                  <div>
                    <button aria-label={`Move ${sectionLabels[section]} up`} className="text-link" disabled={index === 0} onClick={() => moveSection(section, -1)} type="button">Move up</button>
                    <button aria-label={`Move ${sectionLabels[section]} down`} className="text-link" disabled={index === order.length - 1} onClick={() => moveSection(section, 1)} type="button">Move down</button>
                  </div>
                </div>
              ))}
            </div>
            <button className="button button--primary" disabled={Boolean(busy)} onClick={() => void saveSection("home")} type="button">{busy === "home" ? "Saving…" : "Save section layout"}</button>
          </section>

          <section className="owner-panel owner-homepage-editor">
            <div className="owner-panel__heading"><h2>Contact information</h2><span className="owner-status">{draft.published.contact ? "Published" : "Hidden"}</span></div>
            <label><span>Public contact email</span><input autoComplete="email" maxLength={254} onChange={(event) => updateSection("contact", "email", event.target.value)} type="email" value={asText(draft.contact.email)} /></label>
            <label className="owner-checkbox"><input checked={draft.published.contact} onChange={(event) => setPublished("contact", event.target.checked)} type="checkbox" /> Publish contact details</label>
            <button className="button button--primary" disabled={Boolean(busy)} onClick={() => void saveSection("contact")} type="button">{busy === "contact" ? "Saving…" : "Save contact details"}</button>
          </section>

          <section className="owner-panel owner-content-editor">
            <h2>Add a custom content section</h2>
            <p className="owner-help-note">For policies or other content not managed by the homepage fields above.</p>
            <label><span>Section key</span><input maxLength={64} onChange={(event) => setNewKey(event.target.value)} placeholder="for example, shipping" value={newKey} /></label>
            <label><span>JSON content</span><textarea onChange={(event) => setNewContent(event.target.value)} rows={4} value={newContent} /></label>
            <button className="button button--primary" disabled={Boolean(busy) || !newKey.trim()} onClick={() => void createContent()} type="button">Add section</button>
          </section>
          {rows.filter((row) => !["home", "about", "contact"].includes(row.contentKey)).length > 0 && (
            <div className="owner-content-sections">
              <h2>Other published content</h2>
              {rows.filter((row) => !["home", "about", "contact"].includes(row.contentKey)).map((row) => {
                const extra = getExtraDraft(row);
                return (
                  <section className="owner-panel owner-content-editor" key={row.contentKey}>
                    <div className="owner-panel__heading"><h3>{row.contentKey}</h3><span className="owner-status">{extra.isPublished ? "Published" : "Draft / hidden"}</span></div>
                    <label><span>JSON content</span><textarea spellCheck={false} onChange={(event) => setExtraDrafts((current) => ({ ...current, [row.contentKey]: { ...extra, contentText: event.target.value } }))} rows={7} value={extra.contentText} /></label>
                    <label className="owner-checkbox"><input checked={extra.isPublished} onChange={(event) => setExtraDrafts((current) => ({ ...current, [row.contentKey]: { ...extra, isPublished: event.target.checked } }))} type="checkbox" /> Publish this section</label>
                    <button className="button button--primary" disabled={Boolean(busy)} onClick={() => void saveExtra(row.contentKey, extra)} type="button">{busy === row.contentKey ? "Saving…" : "Save section"}</button>
                  </section>
                );
              })}
            </div>
          )}
        </>
      )}
    </section>
  );
}
