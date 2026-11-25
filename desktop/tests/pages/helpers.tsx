// Test helpers for P4 pages: render with router + a fresh query client, logged in as a role.
// apiFetch is routed through the mock registry (see the vi.mock in each test file).
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import type { ReactElement } from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { Role } from "../../src/api/types";
import { users } from "../../src/components/mock-data";
import { useAuthStore } from "../../src/shell/auth-store";

export function logInAs(role: Role) {
  const user = users.find((candidate) => candidate.role === role) ?? users[0];
  // No token: useLiveEvents then never opens a real WebSocket in tests.
  useAuthStore.setState({ token: null, user, ready: true });
  return user;
}

export function renderPage(element: ReactElement, { path = "/", route = "/" }: { path?: string; route?: string } = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <Routes><Route path={route} element={element} /><Route path="*" element={<div>Other page</div>} /></Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { ...view, client };
}
