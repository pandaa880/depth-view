import { lazy, Suspense } from 'react';
import { Outlet } from '@tanstack/react-router';

import { Panel } from '../components/ui/Panel';
import { Skeleton } from '../components/ui/Skeleton';
import { Wordmark } from '../components/ui/Wordmark';
import { useWsConnection } from '../hooks/useWsConnection';
import { useExchangeInfo } from '../hooks/useExchangeInfo';

const RouterDevtools = import.meta.env.DEV
  ? lazy(() =>
      import('@tanstack/react-router-devtools').then(
        ({ TanStackRouterDevtools }) => ({
          default: TanStackRouterDevtools,
        }),
      ),
    )
  : null;

type BootstrapPageProps = {
  error?: string;
};

const BootstrapPage = ({ error }: BootstrapPageProps) => (
  <main className="bootstrap-screen">
    <div className="bootstrap-shell">
      <div className="bootstrap-brand">
        <Wordmark />
        <span className="terminal-descriptor">Real-time spot terminal</span>
      </div>
      <Panel
        className="bootstrap-panel"
        title={error ? 'Market data unavailable' : 'Preparing market workspace'}
        description={
          error
            ? 'Exchange information could not be loaded.'
            : 'Loading symbol metadata and connecting the live feed.'
        }
      >
        {error ? (
          <div className="bootstrap-error">
            <p role="alert">{error}</p>
            <button
              className="retry-button"
              type="button"
              onClick={() => window.location.reload()}
            >
              Retry connection
            </button>
          </div>
        ) : (
          <div className="bootstrap-loading" role="status">
            <div className="bootstrap-skeletons" aria-hidden="true">
              <Skeleton />
              <Skeleton />
              <Skeleton />
            </div>
            <p>Establishing market connection…</p>
          </div>
        )}
      </Panel>
    </div>
  </main>
);

export const RootPage = () => {
  useWsConnection();

  const { isBootstrapped, error } = useExchangeInfo();

  if (!isBootstrapped && !error) {
    return <BootstrapPage />;
  }

  if (typeof error === 'string' && error.length > 0) {
    return <BootstrapPage error={error} />;
  }

  return (
    <>
      <Outlet />
      {RouterDevtools && (
        <Suspense fallback={null}>
          <RouterDevtools />
        </Suspense>
      )}
    </>
  );
};
