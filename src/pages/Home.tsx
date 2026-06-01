import { useWsStatus } from "../hooks/useWsStatus";

import { TickerGrid } from "../components/ticker-ui/TickerGrid";

import LogoImg from '../assets/logo-dark.svg';

export const Home = () => {
  const { status, statusElmStyles } = useWsStatus();

  return (
    <section className="w-full h-screen flex flex-col items-center">
      <nav className="w-full px-4 py-2 border-b border-border flex justify-between items-center">
        <div>
          <img src={LogoImg} alt="logo" className="w-full h-10" />
        </div>
        <div className="flex items-center gap-2">
          <div className={`inline-block w-1.5 h-1.5 rounded-full ${statusElmStyles.dot}`} />
          <div className={`text-xs ${statusElmStyles.text} capitalize`}>{status}</div>
        </div>
      </nav>

      <div className="py-5 w-full h-10/12 flex flex-col justify-end">
        <TickerGrid />
      </div>
    </section>
  );
}

