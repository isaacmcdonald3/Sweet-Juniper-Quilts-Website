import { Link } from "react-router-dom";
import type { StorefrontHomepage } from "@sweet-juniper/shared";
import { getContentSection, getContentText } from "../utils/homepage-content";

export function PolicyPage({
  data,
  policy,
}: {
  data: StorefrontHomepage;
  policy: "shipping" | "privacy";
}) {
  const section = getContentSection(data.content, policy);
  const title = policy === "shipping" ? "Shipping & returns" : "Privacy";
  const fallback = policy === "shipping"
    ? "Shipping and returns information will be added here before checkout becomes available."
    : "Privacy information will be published here before customer information is collected.";

  return (
    <main className="page-main policy-page section-wrap">
      <p className="eyebrow">THE DETAILS</p>
      <h1>{getContentText(section, "title", title)}</h1>
      <p>{getContentText(section, "body", fallback)}</p>
      <Link className="text-link" to="/">Back to Sweet Juniper Quilts</Link>
    </main>
  );
}
