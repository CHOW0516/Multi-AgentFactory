// Page auto-discovery. Each desktop/src/pages/<name>/route.tsx default-exports a PageRoute.
import type { ReactNode } from "react";
import type { Role } from "../api/types";

export interface PageRoute {
  path: string;          // e.g. "/approvals" or "/orders/:orderId"
  label: string;         // sidebar text
  icon: string;          // name from shell/icons.tsx
  roles: Role[];         // who can open it (admin always can); [] = everyone logged in
  order: number;         // sidebar position (lower first)
  element: ReactNode;
  showInSidebar?: boolean; // default true; false for detail pages and /login
  public?: boolean;        // true only for /login: reachable without a token
}

type RouteModule = { default: PageRoute };

export function discoverRoutes(
  modules: Record<string, unknown> = import.meta.glob("../pages/*/route.tsx", { eager: true }),
): PageRoute[] {
  const routes = Object.entries(modules).flatMap(([file, module]) => {
    const route = (module as RouteModule).default;
    if (!route || typeof route.path !== "string") {
      console.warn(`${file} does not default-export a PageRoute; skipped`);
      return [];
    }
    return [route];
  });
  return routes.sort((first, second) => first.order - second.order);
}

export function canOpen(route: PageRoute, role: Role | undefined): boolean {
  if (route.public) return true;
  if (!role) return false;
  return role === "admin" || route.roles.length === 0 || route.roles.includes(role);
}

export function sidebarRoutes(routes: PageRoute[], role: Role | undefined): PageRoute[] {
  return routes.filter((route) => route.showInSidebar !== false && !route.public && canOpen(route, role));
}
