import { Link } from "react-router-dom";
import type { StorefrontHomepage } from "@sweet-juniper/shared";
import { ProductCard } from "../components/ProductCard";
import { getContentSection, getContentText } from "../utils/homepage-content";

export function HomePage({ data }: { data: StorefrontHomepage }) {
  const home = getContentSection(data.content, "home");
  const welcome = getContentSection(data.content, "welcome");
  const about = getContentSection(data.content, "about");
  const contact = getContentSection(data.content, "contact");
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
  const heroVideoUrl = getContentText(home, "videoUrl", "");
  const aboutImageUrl = getContentText(about, "imageUrl", "/images/intro/meadow-quilt.svg");
  const heroMedia = data.featuredProducts.flatMap((product) => product.media)
    .find((item) => item.mediaType === "image");

  return (
    <main>
      <section className="home-hero">
        <div className="home-hero__copy">
          <p className="eyebrow">{getContentText(home, "eyebrow", "A SMALL STUDIO · A LOT OF HEART")}</p>
          <h1>{heroTitle}</h1>
          <p>{heroText}</p>
          <Link className="button button--primary" to="/catalog">Explore the collection</Link>
        </div>
        <div className="home-hero__art">
          {heroVideoUrl ? (
            <video controls playsInline poster={heroMedia?.url}>
              <source src={heroVideoUrl} />
              Your browser does not support video playback.
            </video>
          ) : (
            <img
              src={getContentText(home, "imageUrl", heroMedia?.url || "/images/intro/kinusaiga-garden.svg")}
              alt={getContentText(home, "imageAlt", "Colorful handmade fabric artwork")}
            />
          )}
          <span className="home-hero__caption">A little joy, made by hand</span>
        </div>
      </section>

      <section className="home-categories section-wrap" aria-labelledby="categories-title">
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
                <span aria-hidden="true">✳</span>
                <strong>{category.name}</strong>
                {category.description && <small>{category.description}</small>}
              </Link>
            ))}
          </div>
        ) : (
          <p className="gentle-empty">New collections are taking shape in the studio. Please check back soon.</p>
        )}
      </section>

      <section className="home-featured section-wrap" aria-labelledby="featured-title">
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

      <section className="home-about" id="our-story">
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

      <section className="home-contact section-wrap" id="contact">
        <p className="eyebrow">WE’D LOVE TO HEAR FROM YOU</p>
        <h2>Let’s keep in touch.</h2>
        {contactEmail ? (
          <a className="button button--outline" href={`mailto:${contactEmail}`}>{contactEmail}</a>
        ) : (
          <p>Studio contact details are being prepared. Please visit again soon.</p>
        )}
        <div className="home-contact__policies">
          <Link to="/policies/shipping-returns">Shipping &amp; returns</Link>
          <Link to="/policies/privacy">Privacy policy</Link>
        </div>
      </section>
    </main>
  );
}
