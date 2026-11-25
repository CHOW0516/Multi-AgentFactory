// Role helpers. Admin can do everything.
import type { Role } from "../api/types";
import { useAuthStore } from "../shell/auth-store";

export function useRole(): Role | undefined {
  return useAuthStore((state) => state.user?.role);
}

export function roleAllows(role: Role | undefined, allowed: Role[]): boolean {
  return role === "admin" || (role !== undefined && allowed.includes(role));
}

/** True when the current user has one of the roles (admin always). */
export function useHasRole(...allowed: Role[]): boolean {
  return roleAllows(useRole(), allowed);
}

/** Store staff never see prices, costs or margins. */
export function useCanSeePrices(): boolean {
  return useRole() !== "store";
}
