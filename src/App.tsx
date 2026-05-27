import { useWsConnection } from './hooks/useWsConnection';
import { useWsStatus } from './hooks/useWsStatus';
import { useExchangeInfo } from './hooks/useExchangeInfo';

function App() {
  useWsConnection();

  const status = useWsStatus();
  const { isBootstrapped, error } = useExchangeInfo();

  if (!isBootstrapped && !error.isError) {
    return (
      <section className="w-full h-screen flex justify-center items-center">
        <h1>Skeleton loading...</h1>
      </section>
    );
  }

  if (error.isError) {
    return (
      <section className="w-full h-screen flex justify-center items-center">
        <h1>Something went wrong</h1>
      </section>
    );

  }

  return (
    <section className="w-full h-screen flex flex-col justify-center items-center">
      <h1 className="text-2xl">Depth View</h1>
      <h4>Status {status}</h4>
    </section>
  );
}

export default App;
