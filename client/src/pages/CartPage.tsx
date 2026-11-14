import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { formatPrice } from "../components/ProductCard";
import { useCart } from "../hooks/cart-context";
import { maximumQuantity } from "../hooks/cart-state";
import { fetchApiJson } from "../services/storefront-api";
import { StarMark } from "../components/StarMark";

interface CheckoutConfig {
  shippingAmount: number;
}

export function CartPage() {
  const { items, subtotal, removeItem, setQuantity } = useCart();
  const [shippingAmount, setShippingAmount] = useState<number | null>(null);

  useEffect(() => {
    let active = true;
    fetchApiJson<CheckoutConfig>("/api/checkout/config")
      .then((config) => { if (active) setShippingAmount(config.shippingAmount); })
      .catch(() => { if (active) setShippingAmount(null); });
    return () => { active = false; };
  }, []);

  return (
    <main className="page-main section-wrap cart-page">
      <div className="page-intro page-intro--compact">
        <p className="eyebrow">YOUR LITTLE COLLECTION</p>
        <h1>Your bag</h1>
      </div>
      {items.length === 0 ? (
        <div className="cart-empty">
          <StarMark />
          <h2>Your bag is waiting for something lovely.</h2>
          <p>Take a look around the studio and find a piece to make your own.</p>
          <Link className="button button--primary" to="/catalog">Explore the collection</Link>
        </div>
      ) : (
        <div className="cart-layout">
          <div className="cart-items">
            {items.map(({ product, quantity }) => {
              const image = product.media.find((item) => item.mediaType === "image");
              return (
                <article className="cart-item" key={product.id}>
                  <Link to={`/products/${encodeURIComponent(product.slug)}`}>
                    <img src={image?.url || "/images/intro/juniper-star.svg"} alt={image?.altText || product.name} />
                  </Link>
                  <div className="cart-item__details">
                    <h2><Link to={`/products/${encodeURIComponent(product.slug)}`}>{product.name}</Link></h2>
                    <p>{product.fulfillmentType === "made_to_order" ? "Made to order" : "Ready to ship"}</p>
                    <button className="text-link" onClick={() => removeItem(product.id)} type="button">Remove</button>
                  </div>
                  <label className="cart-item__quantity">
                    <span>Quantity</span>
                    <input
                      type="number"
                      min={1}
                      max={maximumQuantity(product)}
                      value={quantity}
                      aria-label={`Quantity of ${product.name}`}
                      onChange={(event) => setQuantity(product.id, Number(event.target.value))}
                    />
                  </label>
                  <div className="cart-item__price">
                    <span>{formatPrice(product.price)} each</span>
                    <strong>{formatPrice(product.price * quantity)}</strong>
                  </div>
                </article>
              );
            })}
          </div>
          <aside className="cart-summary">
            <h2>Order summary</h2>
            <div><span>Subtotal</span><strong>{formatPrice(subtotal)}</strong></div>
            <div><span>Shipping</span><strong>{shippingAmount === null ? "Confirmed at checkout" : formatPrice(shippingAmount)}</strong></div>
            {shippingAmount !== null && <div><span>Estimated total</span><strong>{formatPrice(subtotal + shippingAmount)}</strong></div>}
            <p>Estimate only. Live prices and stock are checked on the server before you approve payment. Shipping is a flat rate per order.</p>
            <Link className="button button--primary" to="/checkout">Continue to checkout</Link>
            <Link className="text-link" to="/catalog">Continue exploring</Link>
          </aside>
        </div>
      )}
    </main>
  );
}
