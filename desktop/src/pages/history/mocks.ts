import { registerMock } from "../../api/client";
import { asPage, auditEntries, userById } from "../../components/mock-data";

registerMock("GET", "/history", ({ query }) => {
  const actor = query.get("actor")?.toLowerCase();
  const entity = query.get("entity");
  const from = query.get("from");
  const to = query.get("to");
  const text = query.get("q")?.toLowerCase();
  const items = auditEntries.filter((entry) => (!actor || (entry.agent ?? userById(entry.user_id)?.name ?? "").toLowerCase().includes(actor))
    && (!entity || entry.entity === entity) && (!from || entry.created_at >= from) && (!to || entry.created_at <= `${to}T23:59:59Z`)
    && (!text || JSON.stringify(entry).toLowerCase().includes(text)));
  return asPage(items, query);
});
