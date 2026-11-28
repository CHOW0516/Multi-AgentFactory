// Routes come from src/pages/*/route.tsx (auto-discovered). Do not register pages here.
import { Suspense, useEffect } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { useAuthStore } from "./shell/auth-store";
import { Layout } from "./shell/Layout";
import { LoginFallback } from "./shell/LoginFallback";
import { LoadingSkeleton } from "./components/QueryState";
import { canOpen, discoverRoutes, type PageRoute } from "./shell/routes";

export function App({ routes = discoverRoutes() }: { routes?: PageRoute[] }) {
  const { token, user, ready, restore } = useAuthStore();
  const location = useLocation();

  useEffect(() => {
    if (!ready) void restore();
  }, [ready, restore]);

  if (!ready) return null;

  const loginRoute = routes.find((route) => route.path === "/login");
  const loginElement = loginRoute?.element ?? <LoginFallback />;
  const appRoutes = routes.filter((route) => route.path !== "/login");
  const firstPage = appRoutes.find((route) => route.showInSidebar !== false && canOpen(route, user?.role));

  if (!token || !user) {
    return (
      <Suspense fallback={<LoadingSkeleton />}><Routes>
        <Route path="/login" element={loginElement} />
        <Route path="*" element={<Navigate to="/login" replace state={{ from: location.pathname }} />} />
      </Routes></Suspense>
    );
  }

  return (
    <Layout routes={appRoutes}>
      <Suspense fallback={<LoadingSkeleton />}><Routes>
        {appRoutes.map((route) => (
          <Route key={route.path} path={route.path}
            element={canOpen(route, user.role) ? route.element : <p className="empty-state">You do not have access to this page.</p>} />
        ))}
        <Route path="/login" element={<Navigate to="/" replace />} />
        <Route path="*" element={firstPage && firstPage.path !== "/" ? <Navigate to={firstPage.path} replace />
          : <p className="empty-state">{appRoutes.length === 0 ? "No pages yet. Pages are added in src/pages/." : "Page not found."}</p>} />
      </Routes></Suspense>
    </Layout>
  );
}
