import { Link } from "react-router-dom";
import type { CatalogProduct } from "@sweet-juniper/shared";

export function ProductCard({ product }: { product: CatalogProduct }) {
  const image = product.media.find((item) => item.mediaType === "image" && item.isPrimary)
    || product.media.find((item) => item.mediaType === "image");

  return (
    <article className="product-card">
      <Link className="product-card__image-link" to={`/products/${encodeURIComponent(product.slug)}`}>
        <img
          className="product-card__image"
          src={image?.url || "/images/intro/chair-quilt.jpg"}
          alt={image?.altText || product.name}
          loading="lazy"
        />
      </Link>
      <div className="product-card__details">
        <div className="product-card__heading">
          <h3>
            <Link to={`/products/${encodeURIComponent(product.slug)}`}>{product.name}</Link>
          </h3>
          <span className="product-card__price">{formatPrice(product.price)}</span>
        </div>
        {(product.category || product.subcategory) && (
          <div className="product-card__taxonomy">
            {product.category && <strong>{product.category.name}</strong>}
            {product.subcategory && <span>{product.subcategory}</span>}
          </div>
        )}
      </div>
    </article>
  );
}

export function formatPrice(price: number): string {
  return new Intl.NumberFormat(undefined, { style: "currency", currency: "USD" }).format(price);
}
