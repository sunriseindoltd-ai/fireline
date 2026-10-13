import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";

export function getRouter() {
  return createRouter({ routeTree, defaultErrorComponent: ({ error }) => <main className="not-found"><h1>Something went wrong</h1><p>{error instanceof Error ? error.message : String(error)}</p></main> });
}
