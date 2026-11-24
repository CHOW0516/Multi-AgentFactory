// Minimal login used only until P4's pages/login/route.tsx exists (App picks P4's page when present).
import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { apiFetch, ApiError } from "../api/client";
import type { TokenResponse } from "../api/types";
import { useAuthStore } from "./auth-store";

export function LoginFallback() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const login = useAuthStore((state) => state.login);
  const navigate = useNavigate();

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const response = await apiFetch<TokenResponse>("/auth/login", { method: "POST", body: { email, password } });
      await login(response.access_token, response.user);
      navigate("/", { replace: true });
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Cannot reach the server");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-screen">
      <form className="card" onSubmit={submit} aria-label="Log in">
        <h1 style={{ marginTop: 0, fontSize: 20 }}>Factory Commit</h1>
        <div className="field">
          <label htmlFor="login-email">Email</label>
          <input id="login-email" type="email" autoComplete="username" value={email}
            onChange={(event) => setEmail(event.target.value)} required />
        </div>
        <div className="field">
          <label htmlFor="login-password">Password</label>
          <input id="login-password" type="password" autoComplete="current-password" value={password}
            onChange={(event) => setPassword(event.target.value)} required />
        </div>
        {error ? <p className="error-text" role="alert">{error}</p> : null}
        <button className="button button-primary" type="submit" disabled={busy}>{busy ? "Logging in…" : "Log in"}</button>
      </form>
    </div>
  );
}
