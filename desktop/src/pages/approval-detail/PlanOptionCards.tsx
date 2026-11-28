import type { PlanOptionOut } from "../../api/types";
import { formatDate, formatNumber, nameLabel } from "../../components/format";
import { ConfidenceText } from "../../components/DeliveryConfidence";
import { Money } from "../../components/Money";

const OPTION_TITLES: Record<PlanOptionOut["option_type"], string> = {
  as_requested: "As requested", delay: "Deliver later", split: "Split delivery", overtime: "Overtime", move_other_order: "Move another order",
  cheaper_energy: "Cheaper energy",
};

export function PlanOptionCards({ options, selectedId, onSelect, disabled }: {
  options: PlanOptionOut[]; selectedId: string | null; onSelect: (optionId: string) => void; disabled?: boolean;
}) {
  if (options.length === 0) return <p className="empty-state">No plan options.</p>;
  return (
    <div className="option-cards" role="radiogroup" aria-label="Plan options">
      {options.map((option) => (
        <label key={option.id} className={`option-card${selectedId === option.id ? " selected" : ""}`}>
          <input type="radio" name="plan-option" value={option.id} checked={selectedId === option.id} disabled={disabled}
            onChange={() => onSelect(option.id)} aria-label={OPTION_TITLES[option.option_type] ?? nameLabel(option.option_type)} />
          {option.is_recommended ? <span className="tag-recommended">Recommended</span> : null}
          <h3>{OPTION_TITLES[option.option_type] ?? nameLabel(option.option_type)}</h3>
          <dl>
            <dt>Finish</dt><dd>{formatDate(option.finish_date)}</dd>
            {option.confidence ? <><dt>Confidence</dt><dd><ConfidenceText confidence={option.confidence} /></dd></> : null}
            {option.split_quantity_first ? <><dt>First part</dt><dd>{formatNumber(option.split_quantity_first)} pcs by {formatDate(option.split_finish_date_first)}</dd></> : null}
            <dt>Overtime</dt><dd>{Number(option.overtime_hours) > 0 ? `${formatNumber(option.overtime_hours, 1)} h` : "None"}</dd>
            <dt>Extra cost</dt><dd>{Number(option.extra_cost) > 0 ? <Money value={option.extra_cost} /> : "None"}</dd>
            {option.energy_cost != null ? <><dt>Electricity</dt><dd>
              {formatNumber(option.energy_kwh, 0)} kWh, <Money value={option.energy_cost} />
            </dd></> : null}
            {option.margin !== null ? <><dt>Margin</dt><dd>{formatNumber(Number(option.margin) * 100, 1)}%</dd></> : null}
            <dt>Other orders</dt>
            <dd>{option.impacted_orders.length === 0 ? "None move" : option.impacted_orders.map((impacted) => (
              <div key={impacted.order_id}>
                {impacted.order_number}: {formatDate(impacted.old_finish)} → {formatDate(impacted.new_finish)}
                {impacted.still_meets_due_date ? "" : <span className="mismatch"> (late)</span>}
              </div>
            ))}</dd>
          </dl>
          {option.explanation ? <p className="explanation">{option.explanation}</p> : null}
        </label>
      ))}
    </div>
  );
}
