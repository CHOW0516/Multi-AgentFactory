// Used by vi.mock: apiFetch answers from the registered page mocks.
import type * as ClientModule from "../../src/api/client";

export async function mockedClient(importOriginal: () => Promise<typeof ClientModule>) {
  const actual = await importOriginal();
  return {
    ...actual,
    apiFetch: (path: string, options: { method?: string; body?: unknown } = {}) =>
      actual.__answerFromMockForTests((options.method ?? "GET") as "GET", path, options.body),
  };
}
