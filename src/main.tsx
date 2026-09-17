import React from 'react';
import ReactDOM from 'react-dom/client';

const root = ReactDOM.createRoot(document.getElementById('root')!);
import('./App').then(({ default: App }) => root.render(<React.StrictMode><App/></React.StrictMode>)).catch(error => {
  root.render(<main style={{ padding: 32, fontFamily: 'Segoe UI, sans-serif' }}><h1>Не удалось открыть FBS Workspace</h1><p>{error instanceof Error ? error.message : String(error)}</p></main>);
});

