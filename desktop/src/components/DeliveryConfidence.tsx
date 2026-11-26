// Delivery confidence: the plan replayed many times with random breakdowns and slower runs.
import type { DeliveryConfidence } from "../api/types";
import { formatDate } from "./format";

export function confidenceLevel(chance: number | null): "good" | "fair" | "poor" | null {
  if (chance === null) return null;
  return chance >= 80 ? "good" : chance >= 50 ? "fair" : "poor";
}

export function ConfidenceText({ confidence }: { confidence: DeliveryConfidence }) {
  const level = confidenceLevel(confidence.chance_on_time);
  return (
    <span className="delivery-confidence" data-testid="delivery-confidence">
      {confidence.chance_on_time !== null
        ? <strong className={`confidence-${level}`}>{confidence.chance_on_time}% on time</strong> : null}
      <span className="muted"> Likely {formatDate(confidence.likely_date)}, 9 in 10 by {formatDate(confidence.safe_date)}
        {" "}({confidence.runs} runs with random breakdowns)</span>
    </span>
  );
}
