import type { CatalogProduct } from "@sweet-juniper/shared";

export interface CartItem {
  product: CatalogProduct;
  quantity: number;
}

export type CartAction =
  | { type: "add"; product: CatalogProduct; quantity: number }
  | { type: "remove"; productId: string }
  | { type: "set-quantity"; productId: string; quantity: number }
  | { type: "clear" };

export function maximumQuantity(product: CatalogProduct): number {
  return product.fulfillmentType === "ready_to_ship"
    ? product.inventoryQuantity
    : 99;
}

export function cartReducer(items: CartItem[], action: CartAction): CartItem[] {
  if (action.type === "clear") return [];
  if (action.type === "remove") {
    return items.filter(({ product }) => product.id !== action.productId);
  }

  if (action.type === "set-quantity") {
    return items.flatMap((item) => {
      if (item.product.id !== action.productId) return [item];
      const quantity = Math.min(maximumQuantity(item.product), Math.floor(action.quantity));
      return quantity > 0 ? [{ ...item, quantity }] : [];
    });
  }

  const maxQuantity = maximumQuantity(action.product);
  if (!Number.isInteger(action.quantity) || action.quantity < 1 || action.quantity > maxQuantity) {
    return items;
  }

  const current = items.find(({ product }) => product.id === action.product.id);
  if (!current) return [...items, { product: action.product, quantity: action.quantity }];
  const quantity = current.quantity + action.quantity;
  if (quantity > maxQuantity) return items;
  return items.map((item) =>
    item.product.id === action.product.id ? { ...item, product: action.product, quantity } : item,
  );
}

export function cartSubtotal(items: CartItem[]): number {
  return items.reduce((total, { product, quantity }) => total + product.price * quantity, 0);
}
