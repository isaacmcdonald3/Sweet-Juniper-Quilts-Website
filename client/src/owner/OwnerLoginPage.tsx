import { FormEvent, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { useOwnerAuth } from "./owner-auth";

export function OwnerLoginPage() {
  const { configured, loading, session, sessionError, signIn, signOut } = useOwnerAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState("");
  const isOwner = session?.user.app_metadata?.is_owner === true;

  if (loading) return <main className="owner-auth-state" role="status">Checking your sign-in…</main>;
  if (isOwner) return <Navigate to="/owner" replace />;
  if (session) {
    async function signOutUnauthorized() {
      try {
        await signOut();
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "Sign out could not be completed.");
      }
    }
    return (
      <main className="owner-auth-state">
        <h1>Owner access required</h1>
        <p>This account is not authorized to use the owner dashboard.</p>
        {message && <p className="owner-error" role="alert">{message}</p>}
        <button className="button button--outline" onClick={() => void signOutUnauthorized()} type="button">Sign out</button>
      </main>
    );
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");
    setSubmitting(true);
    try {
      if (!configured) throw new Error("Owner sign-in is not configured for this site.");
      await signIn(email, password);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Sign-in could not be completed.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="owner-login">
      <section className="owner-login__card">
        <Link className="brand" to="/" aria-label="Return to Sweet Juniper Quilts">
          <span className="brand__mark" aria-hidden="true">✳</span>
          <span>Sweet Juniper Quilts</span>
        </Link>
        <p className="eyebrow">PRIVATE OWNER AREA</p>
        <h1>Welcome back.</h1>
        <p>Sign in with the owner account to manage the shop.</p>
        {!configured && (
          <p className="owner-notice" role="alert">
            Owner sign-in is not configured. Set the public Supabase URL and anon key in the Static Site build environment.
          </p>
        )}
        <form className="owner-form" onSubmit={(event) => void submit(event)}>
          <label>
            <span>Email address</span>
            <input autoComplete="username" onChange={(event) => setEmail(event.target.value)} required type="email" value={email} />
          </label>
          <label>
            <span>Password</span>
            <input autoComplete="current-password" onChange={(event) => setPassword(event.target.value)} required type="password" value={password} />
          </label>
          {(message || sessionError) && <p className="owner-error" role="alert">{message || sessionError}</p>}
          <button className="button button--primary" disabled={submitting || !configured} type="submit">
            {submitting ? "Signing in…" : "Sign in"}
          </button>
        </form>
        <Link className="owner-login__back" to="/">Return to the shop</Link>
      </section>
    </main>
  );
}
