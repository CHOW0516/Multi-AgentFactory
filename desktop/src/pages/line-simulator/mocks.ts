// In-memory saved lines for VITE_USE_MOCKS=true.
import { ApiError, registerMock } from "../../api/client";
import type { LineDesign } from "./engine";
import type { SimLineOut } from "./model";

const lines: SimLineOut[] = [];

function find(id: string): SimLineOut {
  const line = lines.find((item) => item.id === id);
  if (!line) throw new ApiError(404, "Line not found");
  return line;
}

registerMock("GET", "/sim-lines", () =>
  [...lines].sort((first, second) => first.name.localeCompare(second.name)).map(({ id, name, updated_at }) => ({ id, name, updated_at })));
registerMock("GET", "/sim-lines/:id", ({ params }) => find(params.id));
registerMock("POST", "/sim-lines", ({ body }) => {
  const input = body as { name: string; design: LineDesign };
  const line = { id: `line-${lines.length + 1}-${Date.now()}`, name: input.name.trim(), design: input.design, updated_at: new Date().toISOString() };
  lines.push(line);
  return line;
});
registerMock("PUT", "/sim-lines/:id", ({ params, body }) => {
  const line = find(params.id);
  const input = body as { name: string; design: LineDesign };
  Object.assign(line, { name: input.name.trim(), design: input.design, updated_at: new Date().toISOString() });
  return line;
});
registerMock("DELETE", "/sim-lines/:id", ({ params }) => {
  lines.splice(lines.indexOf(find(params.id)), 1);
  return null;
});
