import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './style.css';

type Health = { ok: boolean; service: string; d1: string };

function App() {
  const [health, setHealth] = useState<Health | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    fetch('/api/health').then(r => r.json()).then(setHealth).catch(e => setError(String(e)));
  }, []);
  return <main><h1>Mezfit is running</h1><p>Telegram Mini App deployment smoke test.</p>{health ? <pre>{JSON.stringify(health, null, 2)}</pre> : <p>{error || 'Checking Worker + D1…'}</p>}</main>;
}

createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>);
