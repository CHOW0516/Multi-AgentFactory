import { useState, type FormEvent } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { ApiError, apiFetch } from "../../api/client";
import type { TokenResponse } from "../../api/types";
import { useAuthStore } from "../../shell/auth-store";
import { Icon } from "../../shell/icons";
import "../../components/components.css";

export function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const login = useAuthStore((state) => state.login);
  const navigate = useNavigate();
  const location = useLocation();
  const returnTo = (location.state as { from?: string } | null)?.from;

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const response = await apiFetch<TokenResponse>("/auth/login", { method: "POST", body: { email: email.trim(), password } });
      await login(response.access_token, response.user);
      navigate(returnTo && returnTo !== "/login" ? returnTo : "/", { replace: true });
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 401) setError("Wrong email or password.");
      else if (caught instanceof ApiError) setError(caught.message);
      else setError("Cannot reach the server. Check that it is running.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-screen">
      <form className="card" onSubmit={submit} aria-label="Log in">
        <div className="row" style={{ marginBottom: "var(--space-5)" }}>
          <Icon name="factory" size={22} />
          <div>
            <h1 style={{ margin: 0, fontSize: 20 }}>Factory Commit</h1>
            <p className="muted small" style={{ margin: 0 }}>From customer PO to a confirmed plan</p>
          </div>
        </div>
        <div className="field">
          <label htmlFor="login-email">Email</label>
          <input id="login-email" type="email" autoComplete="username" value={email}
            onChange={(event) => setEmail(event.target.value)} required autoFocus />
        </div>
        <div className="field">
          <label htmlFor="login-password">Password</label>
          <input id="login-password" type="password" autoComplete="current-password" value={password}
            onChange={(event) => setPassword(event.target.value)} required />
        </div>
        {error ? <p className="error-text" role="alert">{error}</p> : null}
        <button className="button button-primary" type="submit" disabled={busy} style={{ width: "100%", justifyContent: "center" }}>
          {busy ? "Logging in…" : "Log in"}
        </button>
      </form>
    </div>
  );
}
