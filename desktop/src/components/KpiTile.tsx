import type { KpiTile as KpiTileData } from "../api/types";
import { formatNumber } from "./format";

export function KpiTile({ tile }: { tile: KpiTileData }) {
  const decimals = Number.isInteger(tile.value) ? 0 : 1;
  return (
    <div className="card kpi-tile">
      <div className="kpi-label">{tile.label}</div>
      <div className="kpi-value">
        {formatNumber(tile.value, decimals)}
        {tile.unit ? <span className="kpi-unit"> {tile.unit}</span> : null}
      </div>
      {tile.trend !== null ? (
        <div className={`kpi-trend ${tile.trend >= 0 ? "up" : "down"}`}>
          {tile.trend >= 0 ? "▲" : "▼"} {formatNumber(Math.abs(tile.trend), 1)} vs last period
        </div>
      ) : null}
    </div>
  );
}
