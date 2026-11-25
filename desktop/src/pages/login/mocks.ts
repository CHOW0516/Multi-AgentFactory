import { ApiError, registerMock } from "../../api/client";
import { users } from "../../components/mock-data";

// Mock mode: any seeded email logs in with any non-empty password.
registerMock("POST", "/auth/login", ({ body }) => {
  const { email, password } = body as { email: string; password: string };
  const user = users.find((candidate) => candidate.email === email.toLowerCase());
  if (!user || !password) throw new ApiError(401, "Wrong email or password");
  return { access_token: `mock-token-${user.role}`, token_type: "bearer", user };
});
registerMock("GET", "/auth/me", () => users[1]);
