import {
  type RouterHistory,
  createRouter,
  createRoute,
  createRootRoute,
} from '@tanstack/react-router';

import { Home } from './pages/Home';
import { RootPage } from './pages/RootPage';
import { Detail } from './pages/Detail';
import { About } from './pages/About';

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

const aboutRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/about',
  component: About,
});

const routeTree = rootRoute.addChildren([homeRoute, detailRoute, aboutRoute]);

export const createAppRouter = (history?: RouterHistory) =>
  createRouter({ routeTree, history });

export const router = createAppRouter();

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
