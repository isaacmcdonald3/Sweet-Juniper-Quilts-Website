import assert from "node:assert/strict";
import { test } from "node:test";
import type { CatalogProduct } from "@sweet-juniper/shared";
import { cartReducer, cartSubtotal } from "./cart-state";

const product: CatalogProduct = {
  id: "quilt-1",
  name: "Meadow Quilt",
  slug: "meadow-quilt",
  description: "A hand-stitched quilt.",
  price: 125,
  subcategory: null,
  categoryId: null,
  category: null,
  inventoryQuantity: 2,
  fulfillmentType: "ready_to_ship",
  isFeatured: false,
  media: [],
};

test("cart additions respect inventory and subtotal uses database prices", () => {
  const one = cartReducer([], { type: "add", product, quantity: 1 });
  const two = cartReducer(one, { type: "add", product, quantity: 1 });
  const overStock = cartReducer(two, { type: "add", product, quantity: 1 });
  assert.equal(two[0].quantity, 2);
  assert.equal(cartSubtotal(two), 250);
  assert.equal(overStock, two);
});

test("cart quantities update and items can be removed", () => {
  const items = cartReducer([], { type: "add", product, quantity: 1 });
  const changed = cartReducer(items, { type: "set-quantity", productId: product.id, quantity: 2 });
  assert.equal(cartSubtotal(changed), 250);
  assert.deepEqual(cartReducer(changed, { type: "remove", productId: product.id }), []);
});

test("a completed checkout clears all cart items", () => {
  const items = cartReducer([], { type: "add", product, quantity: 1 });
  assert.deepEqual(cartReducer(items, { type: "clear" }), []);
});
