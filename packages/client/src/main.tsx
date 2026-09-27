import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './ui/App';
import { useStore } from './state/store';
import { getBridge } from './platform/bridge';

async function boot(): Promise<void> {
  const saved = await getBridge().loadSettings().catch(() => null);
  useStore.getState().hydrateSettings(saved);
  const root = createRoot(document.getElementById('root')!);
  root.render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
}

void boot();
