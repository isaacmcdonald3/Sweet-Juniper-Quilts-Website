import { Link } from "react-router-dom";
import type { CatalogProduct } from "@sweet-juniper/shared";

function availability(product: CatalogProduct): string {
  if (product.fulfillmentType === "made_to_order") return "Made to order";
  if (product.inventoryQuantity === 0) return "Currently unavailable";
  return "Ready to ship";
}

export function ProductCard({ product }: { product: CatalogProduct }) {
  const image = product.media.find((item) => item.mediaType === "image");

  return (
    <article className="product-card">
      <Link className="product-card__image-link" to={`/products/${encodeURIComponent(product.slug)}`}>
        <img
          className="product-card__image"
          src={image?.url || "/images/intro/juniper-star.svg"}
          alt={image?.altText || product.name}
          loading="lazy"
        />
        {product.isFeatured && <span className="product-card__ribbon">A studio favorite</span>}
      </Link>
      <div className="product-card__details">
        <div className="product-card__heading">
          <h3>
            <Link to={`/products/${encodeURIComponent(product.slug)}`}>{product.name}</Link>
          </h3>
          <span className="product-card__price">{formatPrice(product.price)}</span>
        </div>
        <p className="product-card__availability">{availability(product)}</p>
        {product.category && <p className="product-card__category">{product.category.name}</p>}
      </div>
    </article>
  );
}

export function formatPrice(price: number): string {
  return new Intl.NumberFormat(undefined, { style: "currency", currency: "USD" }).format(price);
}
