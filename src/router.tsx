import { QueryClient } from "@tanstack/react-query";
import { createHashHistory, createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";

export const getRouter = () => {
  const queryClient = new QueryClient();
  const extensionClient = import.meta.env.MODE === "extension" && typeof window !== "undefined";

  const router = createRouter({
    routeTree,
    context: { queryClient },
    ...(extensionClient ? { history: createHashHistory() } : {}),
    scrollRestoration: import.meta.env.MODE !== "extension",
    defaultPreloadStaleTime: 0,
  });

  return router;
};
