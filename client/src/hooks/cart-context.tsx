import { createContext, useContext, useMemo, useReducer, type PropsWithChildren } from "react";
import type { CatalogProduct } from "@sweet-juniper/shared";
import { cartReducer, cartSubtotal, maximumQuantity, type CartItem } from "./cart-state";

interface CartContextValue {
  items: CartItem[];
  itemCount: number;
  subtotal: number;
  addItem: (product: CatalogProduct, quantity: number) => boolean;
  removeItem: (productId: string) => void;
  setQuantity: (productId: string, quantity: number) => void;
}

const CartContext = createContext<CartContextValue | null>(null);

export function CartProvider({ children }: PropsWithChildren) {
  const [items, dispatch] = useReducer(cartReducer, []);

  const value = useMemo<CartContextValue>(() => ({
    items,
    itemCount: items.reduce((total, item) => total + item.quantity, 0),
    subtotal: cartSubtotal(items),
    addItem: (product, quantity) => {
      const existing = items.find((item) => item.product.id === product.id);
      const requestedTotal = (existing?.quantity || 0) + quantity;
      if (
        !Number.isInteger(quantity) ||
        quantity < 1 ||
        requestedTotal > maximumQuantity(product)
      ) {
        return false;
      }
      dispatch({ type: "add", product, quantity });
      return true;
    },
    removeItem: (productId) => dispatch({ type: "remove", productId }),
    setQuantity: (productId, quantity) => {
      if (!Number.isInteger(quantity) || quantity < 1) return;
      dispatch({ type: "set-quantity", productId, quantity });
    },
  }), [items]);

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart(): CartContextValue {
  const context = useContext(CartContext);
  if (!context) throw new Error("useCart must be used within a CartProvider.");
  return context;
}
