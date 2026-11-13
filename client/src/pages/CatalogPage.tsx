import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import type { CatalogProduct, StorefrontHomepage } from "@sweet-juniper/shared";
import { ProductCard } from "../components/ProductCard";
import { fetchApiJson } from "../services/storefront-api";

type SortOrder = "newest" | "price-low" | "price-high" | "name";

export function CatalogPage({ data }: { data: StorefrontHomepage }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const [products, setProducts] = useState<CatalogProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [reload, setReload] = useState(0);
  const search = searchParams.get("q") || "";
  const categoryId = searchParams.get("category") || "";
  const sort = (searchParams.get("sort") || "newest") as SortOrder;

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(false);
    fetchApiJson<CatalogProduct[]>("/api/products")
      .then((result) => {
        if (active) setProducts(result);
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
  }, [reload]);

  const visibleProducts = useMemo(() => {
    const term = search.trim().toLocaleLowerCase();
    const filtered = products.filter((product) => {
      const matchesCategory = !categoryId || product.categoryId === categoryId;
      const matchesSearch = !term ||
        product.name.toLocaleLowerCase().includes(term) ||
        product.description.toLocaleLowerCase().includes(term);
      return matchesCategory && matchesSearch;
    });

    return filtered.sort((left, right) => {
      if (sort === "price-low") return left.price - right.price;
      if (sort === "price-high") return right.price - left.price;
      if (sort === "name") return left.name.localeCompare(right.name);
      return 0;
    });
  }, [categoryId, products, search, sort]);

  function updateParam(key: string, value: string) {
    const next = new URLSearchParams(searchParams);
    if (value) next.set(key, value);
    else next.delete(key);
    setSearchParams(next, { replace: true });
  }

  return (
    <main className="page-main">
      <section className="page-intro">
        <p className="eyebrow">THE SWEET JUNIPER COLLECTION</p>
        <h1>Made to be treasured.</h1>
        <p>Explore handmade quilts and one-of-a-kind fabric art from our studio.</p>
        <p>Looking for a custom craft? Email <a href="mailto:sweetjuniperquilts@gmail.com">sweetjuniperquilts@gmail.com</a> to discuss your idea.</p>
      </section>
      <section className="catalog section-wrap" aria-label="Product catalog">
        <div className="catalog-controls">
          <label>
            <span>Search the collection</span>
            <input
              type="search"
              value={search}
              onChange={(event) => updateParam("q", event.target.value)}
              placeholder="Try “floral” or “quilt”"
            />
          </label>
          <label>
            <span>Category</span>
            <select value={categoryId} onChange={(event) => updateParam("category", event.target.value)}>
              <option value="">All pieces</option>
              {data.categories.map((category) => (
                <option key={category.id} value={category.id}>{category.name}</option>
              ))}
            </select>
          </label>
          <label>
            <span>Sort by</span>
            <select value={sort} onChange={(event) => updateParam("sort", event.target.value)}>
              <option value="newest">Recently added</option>
              <option value="price-low">Price: low to high</option>
              <option value="price-high">Price: high to low</option>
              <option value="name">Name</option>
            </select>
          </label>
        </div>
        {loading ? (
          <div className="page-state" role="status"><span className="loader loader--dark" />Gathering pieces from the studio...</div>
        ) : error ? (
          <div className="page-state page-state--error" role="alert">
            We couldn’t load the collection right now.
            <button className="text-link" onClick={() => setReload((value) => value + 1)} type="button">Try again</button>
          </div>
        ) : visibleProducts.length ? (
          <div className="product-grid">
            {visibleProducts.map((product) => <ProductCard key={product.id} product={product} />)}
          </div>
        ) : (
          <p className="gentle-empty">
            {products.length ? "No pieces match those filters. Try another search." : "The collection is being prepared. Please check back soon."}
          </p>
        )}
      </section>
    </main>
  );
}
