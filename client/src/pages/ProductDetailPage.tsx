import { useEffect, useRef, useState } from "react";
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
  const [addedQuantity, setAddedQuantity] = useState<number | null>(null);
  const addToBagDialog = useRef<HTMLDialogElement>(null);

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

  useEffect(() => {
    const dialog = addToBagDialog.current;
    if (!dialog) return;
    if (addedQuantity !== null && !dialog.open) dialog.showModal();
    else if (addedQuantity === null && dialog.open) dialog.close();
  }, [addedQuantity]);

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
    if (addItem(currentProduct, quantity)) {
      setFeedback("");
      setAddedQuantity(quantity);
    } else {
      setFeedback("Please choose an available quantity.");
    }
  }

  return (
    <main className="page-main product-detail section-wrap">
      <Link className="back-link" to="/catalog">← Back to the collection</Link>
      <div className="product-detail__layout">
        <ProductGallery key={product.id} media={product.media} productName={product.name} />
        <section className="product-detail__info">
          <p className="eyebrow">{product.category?.name || "HANDMADE BY SWEET JUNIPER"}</p>
          {product.subcategory && <p className="product-detail__subcategory">{product.subcategory}</p>}
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
          {feedback && <p className="form-feedback" role="status" aria-live="polite">{feedback}</p>}
        </section>
      </div>
      <dialog
        aria-labelledby="add-to-bag-title"
        className="add-to-bag-dialog"
        onClose={() => setAddedQuantity(null)}
        ref={addToBagDialog}
      >
        <h2 id="add-to-bag-title">Added to your bag</h2>
        <p><strong>{addedQuantity ?? quantity}</strong> × {product.name} was added to your bag.</p>
        <p>Would you like to view your bag and checkout, or continue shopping?</p>
        <div className="add-to-bag-dialog__actions">
          <Link className="button button--primary" to="/cart">View bag and checkout</Link>
          <button className="button button--outline" onClick={() => setAddedQuantity(null)} type="button">Continue shopping</button>
        </div>
      </dialog>
    </main>
  );
}
