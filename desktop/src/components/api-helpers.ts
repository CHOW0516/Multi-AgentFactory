import { ApiError, apiFetch } from "../api/client";

/** GET that returns null instead of failing when the thing does not exist (404). */
export async function fetchOrNull<Result>(path: string): Promise<Result | null> {
  try {
    return await apiFetch<Result>(path);
  } catch (caught) {
    if (caught instanceof ApiError && caught.status === 404) return null;
    throw caught;
  }
}

/** Lists come back as a plain array or as Page<T>; this gives the items either way. */
export function itemsOf<Item>(data: Item[] | { items: Item[] } | null | undefined): Item[] {
  if (!data) return [];
  return Array.isArray(data) ? data : data.items;
}
