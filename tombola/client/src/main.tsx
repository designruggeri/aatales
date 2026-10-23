import { StrictMode, lazy, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import './lib/theme.css';
import './home.css';

const Display = lazy(() => import('./display/Display'));
const Control = lazy(() => import('./control/Control'));
const Admin = lazy(() => import('./admin/Admin'));
const Home = lazy(() => import('./Home'));

function App() {
  const p = location.pathname.replace(/\/+$/, '');
  if (p === '/display') return <Display preview={new URLSearchParams(location.search).has('anteprima')} />;
  if (p === '/control') return <Control />;
  if (p.startsWith('/admin')) return <Admin />;
  return <Home />;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Suspense fallback={null}>
      <App />
    </Suspense>
  </StrictMode>,
);
