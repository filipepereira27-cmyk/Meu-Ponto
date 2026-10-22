import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import { App } from './ui/App';
import { StoreProvider } from './ui/store';
import './styles.css';

let setUpdate: (v: boolean) => void = () => {};
const updateSW = registerSW({ onNeedRefresh: () => setUpdate(true) });

function Root() {
  const [update, setU] = useState(false);
  useEffect(() => { setUpdate = setU; }, []);
  return <App updateAvailable={update} onUpdate={() => updateSW(true)} />;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <StoreProvider>
      <Root />
    </StoreProvider>
  </StrictMode>,
);
