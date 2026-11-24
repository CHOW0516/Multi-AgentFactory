// App frame: sidebar (from discovered routes), top bar, and every src/global/*/index.tsx piece.
import type { ComponentType, ReactNode } from "react";
import { NavLink } from "react-router-dom";
import { useThemeStore } from "../theme/theme-store";
import { useAuthStore } from "./auth-store";
import { Icon } from "./icons";
import { sidebarRoutes, type PageRoute } from "./routes";

type GlobalModule = { default: ComponentType };

export function discoverGlobals(
  modules: Record<string, unknown> = import.meta.glob("../global/*/index.tsx", { eager: true }),
): { name: string; Component: ComponentType }[] {
  return Object.entries(modules)
    .filter(([, module]) => typeof (module as GlobalModule).default === "function")
    .map(([file, module]) => ({ name: file.split("/").at(-2) ?? file, Component: (module as GlobalModule).default }))
    .sort((first, second) => first.name.localeCompare(second.name));
}

const globals = discoverGlobals();

export function Layout({ routes, children }: { routes: PageRoute[]; children: ReactNode }) {
  const user = useAuthStore((state) => state.user);
  const logout = useAuthStore((state) => state.logout);
  const theme = useThemeStore((state) => state.theme);
  const toggleTheme = useThemeStore((state) => state.toggle);
  const visibleRoutes = sidebarRoutes(routes, user?.role);

  return (
    <div className="shell">
      <aside className="shell-sidebar">
        <div className="shell-brand"><Icon name="factory" /> Factory Commit</div>
        <nav className="shell-nav" aria-label="Main">
          {visibleRoutes.map((route) => (
            <NavLink key={route.path} to={route.path} end={route.path === "/"}>
              <Icon name={route.icon} /> {route.label}
            </NavLink>
          ))}
          {visibleRoutes.length === 0 ? <p className="empty-state">No pages yet</p> : null}
        </nav>
      </aside>
      <div className="shell-main">
        <header className="shell-topbar">
          <div className="spacer" />
          {globals.map(({ name, Component }) => <Component key={name} />)}
          <button className="icon-button" type="button" onClick={toggleTheme}
            aria-label={theme === "light" ? "Switch to dark theme" : "Switch to light theme"}>
            <Icon name={theme === "light" ? "moon" : "sun"} />
          </button>
          <span className="shell-user">{user?.name} · {user?.role}</span>
          <button className="icon-button" type="button" onClick={logout} aria-label="Log out">
            <Icon name="logout" />
          </button>
        </header>
        <main className="shell-content">{children}</main>
      </div>
    </div>
  );
}
