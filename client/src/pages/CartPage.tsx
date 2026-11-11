import { Link } from "react-router-dom";
import { formatPrice } from "../components/ProductCard";
import { useCart } from "../hooks/cart-context";
import { maximumQuantity } from "../hooks/cart-state";

export function CartPage() {
  const { items, subtotal, removeItem, setQuantity } = useCart();

  return (
    <main className="page-main section-wrap cart-page">
      <div className="page-intro page-intro--compact">
        <p className="eyebrow">YOUR LITTLE COLLECTION</p>
        <h1>Your bag</h1>
      </div>
      {items.length === 0 ? (
        <div className="cart-empty">
          <span aria-hidden="true">✳</span>
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
                  <strong className="cart-item__price">{formatPrice(product.price * quantity)}</strong>
                </article>
              );
            })}
          </div>
          <aside className="cart-summary">
            <h2>Order summary</h2>
            <div><span>Subtotal</span><strong>{formatPrice(subtotal)}</strong></div>
            <p>Shipping and any applicable taxes will be confirmed before payment.</p>
            <button className="button button--primary" disabled type="button">Checkout coming soon</button>
            <Link className="text-link" to="/catalog">Continue exploring</Link>
          </aside>
        </div>
      )}
    </main>
  );
}
