import { useRef, useState, type FormEvent, type ReactNode } from "react";
import { Link } from "react-router-dom";
import type { CatalogProductMedia, StorefrontHomepage } from "@sweet-juniper/shared";
import { ProductCard } from "../components/ProductCard";
import { requestApi } from "../services/storefront-api";
import { getContentSection, getContentText } from "../utils/homepage-content";
import { StarMark } from "../components/StarMark";

const defaultSectionOrder = ["categories", "featured", "about", "promotion", "contact"];

function safePromotionUrl(value: string): { href: string; external: boolean } {
  if (value.startsWith("/") && !value.startsWith("//")) return { href: value, external: false };
  try {
    const url = new URL(value);
    if (url.protocol === "https:") return { href: url.href, external: true };
  } catch {
    // Invalid promotional links fall back to the catalog.
  }
  return { href: "/catalog", external: false };
}

function mediaById(data: StorefrontHomepage, id: string): CatalogProductMedia | undefined {
  return data.mediaLibrary?.find((media) => media.id === id);
}

export function HomePage({ data }: { data: StorefrontHomepage }) {
  const contactRequestKey = useRef<string | null>(null);
  const [contactStatus, setContactStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [contactMessage, setContactMessage] = useState("");
  const home = getContentSection(data.content, "home");
  const welcome = getContentSection(data.content, "welcome");
  const about = getContentSection(data.content, "about");
  const contact = getContentSection(data.content, "contact");
  const promotion = typeof home.promotionalContent === "object" && home.promotionalContent !== null
    ? home.promotionalContent as Record<string, unknown>
    : {};
  const sectionVisibility = typeof home.sectionVisibility === "object" && home.sectionVisibility !== null
    ? home.sectionVisibility as Record<string, unknown>
    : {};

  const heroTitle = getContentText(home, "title", "A little warmth, stitched to last.");
  const heroText = getContentText(
    home,
    "introduction",
    getContentText(
      welcome,
      "body",
      "Handmade quilts and kinusaiga art, thoughtfully made to bring color and comfort to everyday life.",
    ),
  );
  const aboutTitle = getContentText(about, "title", "Made slowly, with a story in every stitch.");
  const aboutText = getContentText(
    about,
    "body",
    "Sweet Juniper Quilts is a small creative studio celebrating the beauty of fabric, color, and careful handwork. Each quilt and kinusaiga piece is made with patience and a love for things meant to be treasured.",
  );
  const contactEmail = getContentText(contact, "email", "");
  const selectedHero = mediaById(data, getContentText(home, "heroMediaId", ""));
  const selectedAbout = mediaById(data, getContentText(about, "mediaId", ""));
  const selectedPromotion = mediaById(data, getContentText(promotion, "mediaId", ""));
  const firstFeaturedImage = data.featuredProducts.flatMap((product) => product.media)
    .find((item) => item.mediaType === "image");
  const heroVideoUrl = selectedHero?.mediaType === "video"
    ? selectedHero.url
    : selectedHero ? "" : getContentText(home, "videoUrl", "");
  const heroImageUrl = selectedHero?.mediaType === "image"
    ? selectedHero.url
    : getContentText(home, "imageUrl", firstFeaturedImage?.url || "/images/intro/chair-quilt.jpg");
  const aboutImageUrl = selectedAbout?.mediaType === "image"
    ? selectedAbout.url
    : getContentText(about, "imageUrl", "/images/intro/yellow-stitching.jpg");
  const posterUrl = selectedHero?.posterUrl || firstFeaturedImage?.url;
  const visible = (key: string) =>
    sectionVisibility[key] !== false && data.publishedSections?.[key] !== false;
  const storedOrder = Array.isArray(home.sectionOrder) &&
      home.sectionOrder.every((key) => typeof key === "string")
    ? home.sectionOrder as string[]
    : defaultSectionOrder;
  const sectionOrder = [...new Set([
    ...storedOrder.filter((key) => defaultSectionOrder.includes(key)),
    ...defaultSectionOrder,
  ])];
  const promotionTitle = getContentText(promotion, "title", "");
  const promotionBody = getContentText(promotion, "body", "");
  const promotionUrl = safePromotionUrl(getContentText(promotion, "buttonUrl", "/catalog"));
  const promotionHasContent = Boolean(promotionTitle || promotionBody);

  async function submitContact(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    setContactStatus("sending");
    setContactMessage("");
    try {
      const response = await requestApi("/api/contact", undefined, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          idempotencyKey: contactRequestKey.current || (contactRequestKey.current = crypto.randomUUID()),
          name: String(values.get("name") || ""),
          email: String(values.get("email") || ""),
          message: String(values.get("message") || ""),
        }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => null) as { error?: string } | null;
        throw new Error(payload?.error || "Your message could not be sent. Please try again.");
      }
      form.reset();
      contactRequestKey.current = null;
      setContactStatus("sent");
      setContactMessage("Thank you for reaching out. Your message has been received.");
    } catch (error) {
      setContactStatus("error");
      setContactMessage(error instanceof Error ? error.message : "Your message could not be sent. Please try again.");
    }
  }

  const sections: Record<string, ReactNode> = {
    categories: (
      <section className="home-categories section-wrap" aria-labelledby="categories-title" key="categories">
        <div className="section-heading">
          <p className="eyebrow">FIND YOUR SOMETHING SPECIAL</p>
          <h2 id="categories-title">Made for keeping</h2>
        </div>
        {data.categories.length ? (
          <div className="category-grid">
            {data.categories.map((category) => (
              <Link
                className="category-tile"
                key={category.id}
                to={`/catalog?category=${encodeURIComponent(category.id)}`}
              >
                <StarMark />
                <strong>{category.name}</strong>
                {category.description && <small>{category.description}</small>}
              </Link>
            ))}
          </div>
        ) : (
          <p className="gentle-empty">New collections are taking shape in the studio. Please check back soon.</p>
        )}
      </section>
    ),
    featured: (
      <section className="home-featured section-wrap" aria-labelledby="featured-title" key="featured">
        <div className="section-heading section-heading--row">
          <div>
            <p className="eyebrow">ONE-OF-A-KIND AND MADE WITH CARE</p>
            <h2 id="featured-title">From the studio</h2>
          </div>
          <Link className="text-link" to="/catalog">View the full collection <span aria-hidden="true">→</span></Link>
        </div>
        {data.featuredProducts.length ? (
          <div className="product-grid">
            {data.featuredProducts.map((product) => <ProductCard key={product.id} product={product} />)}
          </div>
        ) : (
          <p className="gentle-empty">Featured pieces will appear here as they are added to the collection.</p>
        )}
      </section>
    ),
    about: (
      <section className="home-about" id="our-story" key="about">
        <div
          className="home-about__art"
          role="img"
          aria-label="Quilt-inspired fabric pattern"
          style={{ backgroundImage: `url("${aboutImageUrl}")` }}
        />
        <div className="home-about__copy">
          <p className="eyebrow">A LITTLE ABOUT US</p>
          <h2>{aboutTitle}</h2>
          <p>{aboutText}</p>
          <a className="text-link" href="#contact">Say hello <span aria-hidden="true">→</span></a>
        </div>
      </section>
    ),
    promotion: promotionHasContent ? (
      <section className="home-promotion section-wrap" key="promotion">
        {selectedPromotion?.mediaType === "image" && (
          <img alt={selectedPromotion.altText || ""} loading="lazy" src={selectedPromotion.url} />
        )}
        <div className="home-promotion__copy">
          <p className="eyebrow">A NOTE FROM THE STUDIO</p>
          {promotionTitle && <h2>{promotionTitle}</h2>}
          {promotionBody && <p>{promotionBody}</p>}
          {getContentText(promotion, "buttonText", "") && (
            promotionUrl.external
              ? <a className="button button--primary" href={promotionUrl.href} rel="noreferrer" target="_blank">{getContentText(promotion, "buttonText", "")}</a>
              : <Link className="button button--primary" to={promotionUrl.href}>{getContentText(promotion, "buttonText", "")}</Link>
          )}
        </div>
      </section>
    ) : null,
    contact: (
      <section className="home-contact section-wrap" id="contact" key="contact">
        <p className="eyebrow">WE’D LOVE TO HEAR FROM YOU</p>
        <h2>Let’s keep in touch.</h2>
        {contactEmail ? (
          <a className="button button--outline" href={`mailto:${contactEmail}`}>{contactEmail}</a>
        ) : (
          <p>Have a question about a piece or a custom craft? Send a note to the studio.</p>
        )}
        <form className="home-contact__form" onChange={() => { contactRequestKey.current = null; }} onSubmit={(event) => void submitContact(event)}>
          <label><span>Your name</span><input autoComplete="name" maxLength={120} name="name" required /></label>
          <label><span>Email address</span><input autoComplete="email" maxLength={254} name="email" required type="email" /></label>
          <label className="home-contact__wide"><span>Your message</span><textarea maxLength={3000} name="message" required rows={5} /></label>
          <button className="button button--primary home-contact__wide" disabled={contactStatus === "sending"} type="submit">
            {contactStatus === "sending" ? "Sending…" : "Send message"}
          </button>
          {contactMessage && <p className={contactStatus === "error" ? "owner-error home-contact__wide" : "owner-success home-contact__wide"} role={contactStatus === "error" ? "alert" : "status"}>{contactMessage}</p>}
        </form>
        <div className="home-contact__policies">
          <Link to="/policies/shipping-returns">Shipping &amp; returns</Link>
          <Link to="/policies/privacy">Privacy policy</Link>
        </div>
      </section>
    ),
  };

  return (
    <main>
      {data.publishedSections?.home !== false && (
        <section className="home-hero">
          <div className="home-hero__copy">
            <p className="eyebrow">{getContentText(home, "eyebrow", "A SMALL STUDIO · A LOT OF HEART")}</p>
            <h1>{heroTitle}</h1>
            <p>{heroText}</p>
            <Link className="button button--primary" to="/catalog">Explore the collection</Link>
          </div>
          <div className="home-hero__art">
            {heroVideoUrl ? (
              <video controls playsInline poster={posterUrl}>
                <source src={heroVideoUrl} />
                Your browser does not support video playback.
              </video>
            ) : (
              <img
                src={heroImageUrl}
                alt={getContentText(home, "imageAlt", "Colorful handmade fabric artwork")}
              />
            )}
            <span className="home-hero__caption">A little joy, made by hand</span>
          </div>
        </section>
      )}
      {sectionOrder.map((key) => visible(key) ? sections[key] : null)}
    </main>
  );
}
