// Logged-in user and token. The token is kept in the OS-encrypted secure store.
import { create } from "zustand";
import type { Role, UserOut } from "../api/types";
import { desktop } from "./desktop-bridge";

const TOKEN_KEY = "auth-token";
const USER_KEY = "auth-user";

interface AuthState {
  token: string | null;
  user: UserOut | null;
  ready: boolean; // true once the saved session has been loaded
  login(token: string, user: UserOut): Promise<void>;
  logout(): void;
  restore(): Promise<void>;
  hasRole(...roles: Role[]): boolean;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  token: null,
  user: null,
  ready: false,
  async login(token, user) {
    set({ token, user, ready: true });
    await desktop.secureStore.set(TOKEN_KEY, token);
    await desktop.secureStore.set(USER_KEY, JSON.stringify(user));
  },
  logout() {
    set({ token: null, user: null, ready: true });
    void desktop.secureStore.set(TOKEN_KEY, null);
    void desktop.secureStore.set(USER_KEY, null);
  },
  async restore() {
    const [token, userJson] = await Promise.all([
      desktop.secureStore.get(TOKEN_KEY),
      desktop.secureStore.get(USER_KEY),
    ]);
    let user: UserOut | null = null;
    try { user = userJson ? (JSON.parse(userJson) as UserOut) : null; } catch { user = null; }
    set({ token: token && user ? token : null, user: token ? user : null, ready: true });
  },
  hasRole(...roles) {
    const role = get().user?.role;
    return role === "admin" || (role !== undefined && roles.includes(role));
  },
}));
