// Calls the mock router directly (USE_MOCKS is false in unit tests).
import { __answerFromMockForTests } from "../../src/api/client";

export function answerForTest(method: "GET" | "POST", path: string) {
  return __answerFromMockForTests(method, path, undefined);
}
