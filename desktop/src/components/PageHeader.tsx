import "./components.css";
import type { ReactNode } from "react";
import { Icon } from "../shell/icons";

const pageIcons: Record<string, string> = { Schedule: "schedule", Dashboards: "dashboards", Settings: "settings",
  Approvals: "approvals", Orders: "orders", Materials: "materials", Quotations: "quotations", History: "history", Quality: "quality",
  "Line simulator": "line" };

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="page-header">
      <div className="page-header-main">
        {pageIcons[title] && <span className="page-symbol"><Icon name={pageIcons[title]} size={22} /></span>}
        <div>
        <h1>{title}</h1>
        {subtitle ? <p className="muted">{subtitle}</p> : null}
        </div>
      </div>
      {actions ? <div className="page-actions">{actions}</div> : null}
    </div>
  );
}
