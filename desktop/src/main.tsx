import { QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import ReactDOM from "react-dom/client";
import { createHashRouter, RouterProvider } from "react-router-dom";
import { queryClient } from "./api/client";
import { App } from "./App";
import { TooltipLayer } from "./components/TooltipLayer";
import { ErrorState } from "./components/QueryState";
import "./theme/global.css";
import { initTheme } from "./theme/theme-store";

initTheme();
const router = createHashRouter([{
  path: "*", element: <App />,
  errorElement: <ErrorState error={new Error("The page could not be loaded. Try loading the application again.")}
    onRetry={() => window.location.reload()} />,
}]);

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
      <TooltipLayer />
    </QueryClientProvider>
  </React.StrictMode>,
);
