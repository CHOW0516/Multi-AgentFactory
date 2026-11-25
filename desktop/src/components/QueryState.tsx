// Loading skeleton, error with retry, and empty states for a TanStack query.
import type { UseQueryResult } from "@tanstack/react-query";
import type { ReactNode } from "react";

export function LoadingSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="skeleton-block" aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }, (_unused, index) => <div key={index} className="skeleton-line" />)}
    </div>
  );
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const message = error instanceof Error ? error.message : "Something went wrong.";
  return (
    <div className="error-state" role="alert">
      <p>Could not load this. {message}</p>
      {onRetry ? <button type="button" className="button" onClick={onRetry}>Retry</button> : null}
    </div>
  );
}

export function EmptyState({ children }: { children: ReactNode }) {
  return <p className="empty-state">{children}</p>;
}

/** Renders loading / error states, then `children(data)` once the query has data. */
export function QueryState<Data>({ query, children, rows }: {
  query: UseQueryResult<Data>;
  children: (data: Data) => ReactNode;
  rows?: number;
}) {
  if (query.isPending) return <LoadingSkeleton rows={rows} />;
  if (query.isError) return <ErrorState error={query.error} onRetry={() => void query.refetch()} />;
  return <>{children(query.data)}</>;
}
