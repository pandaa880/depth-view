import {
  createRouter,
  createRoute,
  createRootRoute,
} from '@tanstack/react-router';

import { Home } from './pages/Home';
import { RootPage } from './pages/RootPage';
import { Detail } from './pages/Detail';

export const rootRoute = createRootRoute({
  component: RootPage,
});

const homeRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: Home,
});

export const detailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/symbol/$symbol', // $ prefix = typed param
  component: Detail,
});

const routeTree = rootRoute.addChildren([homeRoute, detailRoute]);

export const router = createRouter({ routeTree });

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
