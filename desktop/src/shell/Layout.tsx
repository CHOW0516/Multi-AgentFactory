// App frame: sidebar (from discovered routes), top bar, and every src/global/*/index.tsx piece.
import { useState, type ComponentType, type ReactNode } from "react";
import { NavLink, useLocation } from "react-router-dom";
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
  const location = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(() => !(window.matchMedia?.("(max-width: 760px)")?.matches));
  const initials = user?.name.split(/\s+/).slice(0, 2).map((word) => word[0]?.toUpperCase()).join("");

  return (
    <div className="shell" data-sidebar-open={sidebarOpen || undefined} data-floor={(location.pathname === "/" || location.pathname === "/agent-map") || undefined}>
      <header className="shell-topbar">
        <button className="icon-button shell-sidebar-toggle" type="button" onClick={() => setSidebarOpen(!sidebarOpen)}
          aria-expanded={sidebarOpen} aria-controls="workspace-navigation"
          aria-label={sidebarOpen ? "Collapse sidebar" : "Expand sidebar"} data-tooltip={sidebarOpen ? "Collapse sidebar" : "Expand sidebar"}>
          <Icon name="sidebar" size={19} />
        </button>
        <div className="shell-brand"><span className="shell-brand-icon"><Icon name="factory" size={19} /></span>Factory Commit</div>
        <div className="spacer" />
        {globals.map(({ name, Component }) => <Component key={name} />)}
        <button className="icon-button" type="button" onClick={toggleTheme}
          aria-label={theme === "light" ? "Switch to dark theme" : "Switch to light theme"}>
          <Icon name={theme === "light" ? "moon" : "sun"} />
        </button>
        <div className="shell-user"><span className="shell-avatar" aria-hidden="true">{initials}</span>
          <span><strong>{user?.name}</strong><small>{user?.role}</small></span>
        </div>
        <button className="icon-button" type="button" onClick={() => {
          const event = new CustomEvent("workspace-leave", { cancelable: true, detail: { proceed: logout } });
          if (window.dispatchEvent(event)) logout();
        }} aria-label="Log out" data-tooltip="Log out">
          <Icon name="logout" />
        </button>
      </header>
      {sidebarOpen && <button type="button" aria-label="Dismiss navigation" className="shell-scrim" onClick={() => setSidebarOpen(false)} />}
      <aside className="shell-sidebar" id="workspace-navigation" onKeyDown={(event) => {
        if (event.key === "Escape" && sidebarOpen) {
          setSidebarOpen(false);
          event.currentTarget.parentElement?.querySelector<HTMLButtonElement>(".shell-sidebar-toggle")?.focus();
        }
      }}>
        <span className="shell-nav-title">Workspace</span>
        <nav className="shell-nav" aria-label="Main">
          {visibleRoutes.map((route) => (
            <NavLink key={route.path} to={route.path} end={route.path === "/"}
              data-tooltip={sidebarOpen ? undefined : route.label} aria-label={route.label} onClick={() => {
              if (window.matchMedia?.("(max-width: 760px)")?.matches) setSidebarOpen(false);
            }}>
              <Icon name={route.icon} /><span>{route.label}</span>
            </NavLink>
          ))}
          {visibleRoutes.length === 0 ? <p className="empty-state">No pages yet</p> : null}
        </nav>
      </aside>
      <main className="shell-content">{children}</main>
    </div>
  );
}
