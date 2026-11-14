import { Link, NavLink, Outlet } from "react-router-dom";
import type { StorefrontHomepage } from "@sweet-juniper/shared";
import { useCart } from "../hooks/cart-context";
import { getContentSection, getContentText } from "../utils/homepage-content";
import { StarMark } from "./StarMark";

export function SiteLayout({ data }: { data: StorefrontHomepage }) {
  const { itemCount } = useCart();
  const contact = getContentSection(data.content, "contact");
  const email = getContentText(contact, "email", "");

  return (
    <div className="shop-shell">
      <header className="shop-header">
        <Link className="brand" to="/" aria-label="Sweet Juniper Quilts home">
          <span className="brand__mark"><StarMark /></span>
          <span>Sweet Juniper Quilts</span>
        </Link>
        <nav className="shop-nav" aria-label="Main navigation">
          <NavLink to="/" end>Home</NavLink>
          <NavLink to="/catalog">Shop</NavLink>
          <Link to="/#our-story">Our story</Link>
          <Link to="/#contact">Contact</Link>
          <NavLink className="shop-nav__cart" to="/cart">
            Bag <span aria-label={`${itemCount} items`}>({itemCount})</span>
          </NavLink>
        </nav>
      </header>
      <Outlet />
      <footer className="shop-footer">
        <div className="shop-footer__top">
          <div>
            <Link className="brand" to="/">
              <span className="brand__mark"><StarMark /></span>
              <span>Sweet Juniper Quilts</span>
            </Link>
            <p>Thoughtful quilts and kinusaiga, made slowly and meant to be cherished.</p>
          </div>
          <div className="shop-footer__links">
            <Link to="/catalog">Shop the collection</Link>
            <Link to="/policies/shipping-returns">Shipping &amp; returns</Link>
            <Link to="/policies/privacy">Privacy</Link>
            {email ? <a href={`mailto:${email}`}>{email}</a> : <Link to="/#contact">Contact the studio</Link>}
          </div>
        </div>
        <p className="shop-footer__fine">© {new Date().getFullYear()} Sweet Juniper Quilts · Made with care.</p>
      </footer>
    </div>
  );
}
