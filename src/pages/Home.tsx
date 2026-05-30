import { useWsStatus } from "../hooks/useWsStatus";

export const Home = () => {
  const status = useWsStatus();

  return (
    <section className="w-full h-screen flex flex-col justify-center items-center">
      <h1 className="text-2xl">Depth View</h1>
      <h4>Status {status}</h4>
    </section>
  );
}

