// Table with a sticky header, click-to-sort columns, loading / error / empty states.
import { useMemo, useState, type ReactNode } from "react";
import { EmptyState, ErrorState, LoadingSkeleton } from "./QueryState";

export interface Column<Row> {
  key: string;
  header: string;
  render: (row: Row) => ReactNode;
  sortValue?: (row: Row) => string | number;
  align?: "left" | "right";
  hidden?: boolean; // e.g. price columns for the store role
}

interface DataTableProps<Row> {
  columns: Column<Row>[];
  rows: Row[] | undefined;
  rowKey: (row: Row) => string;
  onRowClick?: (row: Row) => void;
  rowTestId?: (row: Row) => string;
  rowClassName?: (row: Row) => string;
  isLoading?: boolean;
  error?: unknown;
  onRetry?: () => void;
  emptyText?: string;
  caption?: string;
}

export function DataTable<Row>({
  columns, rows, rowKey, onRowClick, rowTestId, rowClassName, isLoading, error, onRetry,
  emptyText = "Nothing here yet.", caption,
}: DataTableProps<Row>) {
  const visibleColumns = columns.filter((column) => !column.hidden);
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortAscending, setSortAscending] = useState(true);

  const sortedRows = useMemo(() => {
    const column = visibleColumns.find((candidate) => candidate.key === sortKey);
    if (!rows || !column?.sortValue) return rows ?? [];
    const valueOf = column.sortValue;
    return [...rows].sort((first, second) => {
      const firstValue = valueOf(first);
      const secondValue = valueOf(second);
      const result = firstValue < secondValue ? -1 : firstValue > secondValue ? 1 : 0;
      return sortAscending ? result : -result;
    });
  }, [rows, sortKey, sortAscending, visibleColumns]);

  if (isLoading) return <LoadingSkeleton />;
  if (error) return <ErrorState error={error} onRetry={onRetry} />;
  if (sortedRows.length === 0) return <EmptyState>{emptyText}</EmptyState>;

  function toggleSort(key: string) {
    if (sortKey === key) setSortAscending(!sortAscending);
    else { setSortKey(key); setSortAscending(true); }
  }

  return (
    <div className="table-wrap">
      <table className="data-table">
        {caption ? <caption className="visually-hidden">{caption}</caption> : null}
        <thead>
          <tr>
            {visibleColumns.map((column) => (
              <th key={column.key} scope="col" className={column.align === "right" ? "align-right" : undefined}
                aria-sort={sortKey === column.key ? (sortAscending ? "ascending" : "descending") : undefined}>
                {column.sortValue ? (
                  <button type="button" className="sort-button" onClick={() => toggleSort(column.key)}>
                    {column.header}{sortKey === column.key ? (sortAscending ? " ▲" : " ▼") : ""}
                  </button>
                ) : column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sortedRows.map((row) => (
            <tr key={rowKey(row)} data-testid={rowTestId?.(row)}
              className={[onRowClick ? "clickable" : "", rowClassName?.(row) ?? ""].join(" ").trim() || undefined}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
              onKeyDown={onRowClick ? (event) => { if (event.key === "Enter") onRowClick(row); } : undefined}
              tabIndex={onRowClick ? 0 : undefined}>
              {visibleColumns.map((column) => (
                <td key={column.key} className={column.align === "right" ? "align-right" : undefined}>{column.render(row)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
