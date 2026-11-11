import { Link } from "react-router-dom";

export function NotFoundPage() {
  return (
    <main className="page-main page-state">
      <p className="eyebrow">A LITTLE OFF THE PATCHWORK</p>
      <h1>We couldn’t find that page.</h1>
      <Link className="text-link" to="/">Return to the homepage</Link>
    </main>
  );
}
