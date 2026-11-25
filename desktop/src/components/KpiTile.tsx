import type { KpiTile as KpiTileData } from "../api/types";
import { formatNumber } from "./format";
import { Icon } from "../shell/icons";

export function KpiTile({ tile }: { tile: KpiTileData }) {
  const decimals = Number.isInteger(tile.value) ? 0 : Math.abs(tile.value) < 1 ? 2 : 1;
  return (
    <div className="card kpi-tile">
      <div className="kpi-label">{tile.label}</div>
      <div className="kpi-value">
        {formatNumber(tile.value, decimals)}
        {tile.unit ? <span className="kpi-unit"> {tile.unit}</span> : null}
      </div>
      {tile.trend !== null ? (
        <div className={`kpi-trend ${tile.trend >= 0 ? "up" : "down"}`}>
          <Icon name={tile.trend >= 0 ? "chevron-up" : "chevron-down"} size={13} />
          <span>{formatNumber(Math.abs(tile.trend), 1)} vs last period</span>
        </div>
      ) : null}
    </div>
  );
}
