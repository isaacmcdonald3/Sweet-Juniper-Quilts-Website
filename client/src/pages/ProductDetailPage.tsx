import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import type { CatalogProduct } from "@sweet-juniper/shared";
import { ProductGallery } from "../components/ProductGallery";
import { formatPrice } from "../components/ProductCard";
import { useCart } from "../hooks/cart-context";
import { maximumQuantity } from "../hooks/cart-state";
import { fetchApiJson } from "../services/storefront-api";

export function ProductDetailPage() {
  const { slug = "" } = useParams();
  const { addItem } = useCart();
  const [product, setProduct] = useState<CatalogProduct | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [quantity, setQuantity] = useState(1);
  const [feedback, setFeedback] = useState("");

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(false);
    setProduct(null);
    fetchApiJson<CatalogProduct>(`/api/products/${encodeURIComponent(slug)}`)
      .then((result) => {
        if (active) setProduct(result);
      })
      .catch(() => {
        if (active) setError(true);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [slug]);

  if (loading) {
    return <main className="page-main page-state" role="status"><span className="loader loader--dark" />Opening the piece...</main>;
  }
  if (error || !product) {
    return (
      <main className="page-main page-state">
        <h1>This piece isn’t available right now.</h1>
        <Link className="text-link" to="/catalog">Return to the collection</Link>
      </main>
    );
  }

  const madeToOrder = product.fulfillmentType === "made_to_order";
  const unavailable = !madeToOrder && product.inventoryQuantity === 0;
  const maxQuantity = maximumQuantity(product);
  const currentProduct = product;

  function addToBag() {
    if (addItem(currentProduct, quantity)) setFeedback(`${currentProduct.name} was added to your bag.`);
    else setFeedback("Please choose an available quantity.");
  }

  return (
    <main className="page-main product-detail section-wrap">
      <Link className="back-link" to="/catalog">← Back to the collection</Link>
      <div className="product-detail__layout">
        <ProductGallery key={product.id} media={product.media} productName={product.name} />
        <section className="product-detail__info">
          <p className="eyebrow">{product.category?.name || "HANDMADE BY SWEET JUNIPER"}</p>
          <h1>{product.name}</h1>
          <p className="product-detail__price">{formatPrice(product.price)}</p>
          <p className="product-detail__availability">
            {madeToOrder
              ? "Made to order"
              : unavailable
                ? "Currently unavailable"
                : `${product.inventoryQuantity} ready to ship`}
          </p>
          <p className="product-detail__description">{product.description || "A one-of-a-kind piece, carefully made in our studio."}</p>
          {product.sku && <p className="product-detail__sku">SKU: {product.sku}</p>}
          <div className="product-detail__fulfillment">
            {madeToOrder ? "Made to order with care" : "Ready to ship"}
          </div>
          {product.category && (
            <p className="product-detail__category">
              In <Link to={`/catalog?category=${encodeURIComponent(product.category.id)}`}>{product.category.name}</Link>
            </p>
          )}
          <div className="product-detail__purchase">
            <label>
              Quantity
              <input
                aria-label="Quantity"
                type="number"
                min={1}
                max={maxQuantity}
                value={quantity}
                disabled={unavailable}
                onChange={(event) => {
                  const next = Number(event.target.value);
                  if (Number.isInteger(next) && next >= 1) {
                    setQuantity(Math.min(next, maxQuantity));
                    setFeedback("");
                  }
                }}
              />
            </label>
            <button className="button button--primary" disabled={unavailable} onClick={addToBag} type="button">
              {unavailable ? "Out of stock" : "Add to bag"}
            </button>
          </div>
          <p className="form-feedback" role="status" aria-live="polite">{feedback}</p>
        </section>
      </div>
    </main>
  );
}
