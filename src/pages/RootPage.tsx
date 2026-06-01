import { Outlet } from '@tanstack/react-router';
import { TanStackRouterDevtools } from '@tanstack/react-router-devtools';

import { useWsConnection } from '../hooks/useWsConnection';
import { useExchangeInfo } from '../hooks/useExchangeInfo';

export const RootPage = () => {
  useWsConnection();

  const { isBootstrapped, error } = useExchangeInfo();

  if (!isBootstrapped && !error) {
    return (
      <section className="w-full h-screen flex justify-center items-center">
        <h1>Skeleton loading...</h1>
      </section>
    );
  }

  if (typeof error === 'string' && error.length > 0) {
    return (
      <section className="w-full h-screen flex justify-center items-center">
        <h1>Something went wrong</h1>
      </section>
    );
  }

  return (
    <>
      <Outlet />
      <TanStackRouterDevtools />
    </>
  );
};
