import { useBinance } from "./hooks/useBinance";

function App() {
  const { status, manager } = useBinance('btcusdt@depth');

  console.log({ status, manager });

  return (
    <section className="w-full h-screen flex justify-center items-center">
      <h1 className="text-2xl">Depth View</h1>
    </section>
  )
}

export default App;
