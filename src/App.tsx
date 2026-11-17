import { lazy, Suspense, useEffect, useState } from 'react';
import { BrowserRouter, NavLink, Route, Routes, useLocation } from 'react-router';
import { Archive, Boxes, Download, FolderInput, Gauge, Info, Menu, Settings as SettingsIcon, Shirt, SquarePen, Users, BookOpen, Shield } from 'lucide-react';
import { BrandMark, Toasts } from './components/ui';
import { useApp } from './state/app';
import { APP, copyrightYear } from './lib/brand';
import Dashboard from './pages/Dashboard';
import ErrorBoundary from './components/ErrorBoundary';

const Characters = lazy(() => import('./pages/Characters'));
const Editor = lazy(() => import('./pages/Editor'));
const Cosmetics = lazy(() => import('./pages/Cosmetics'));
const Models = lazy(() => import('./pages/Models'));
const Imports = lazy(() => import('./pages/Imports'));
const Exports = lazy(() => import('./pages/Exports'));
const Backups = lazy(() => import('./pages/Backups'));
const SettingsPage = lazy(() => import('./pages/Settings'));
const InfoPages = lazy(() => import('./pages/InfoPages'));

const NAV = [
  { to: '/', label: 'Dashboard', icon: Gauge, end: true },
  { to: '/characters', label: 'Characters', icon: Users },
  { to: '/editor', label: 'Character Editor', icon: SquarePen },
  { to: '/cosmetics', label: 'Cosmetics', icon: Shirt },
  { to: '/models', label: 'Models', icon: Boxes },
  { to: '/imports', label: 'Imports', icon: FolderInput },
  { to: '/exports', label: 'Exports', icon: Download },
  { to: '/backups', label: 'Backups', icon: Archive },
  { to: '/settings', label: 'Settings', icon: SettingsIcon },
];

function Nav({ open, onNavigate }: { open: boolean; onNavigate: () => void }) {
  const tf2 = useApp((s) => s.tf2);
  return (
    <nav className={`nav ${open ? 'open' : ''}`} aria-label="Main">
      <NavLink to="/" className="brand" onClick={onNavigate}>
        <BrandMark />
        <span className="brand-name">{APP.shortName}<span className="brand-sub">SFM Character Studio</span></span>
      </NavLink>
      {NAV.map(({ to, label, icon: Icon, end }) => (
        <NavLink key={to} to={to} end={end} className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`} onClick={onNavigate}>
          <Icon aria-hidden="true" />{label}
        </NavLink>
      ))}
      <div className="nav-sep" />
      <NavLink to="/docs" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`} onClick={onNavigate}><BookOpen aria-hidden="true" />Documentation</NavLink>
      <NavLink to="/privacy" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`} onClick={onNavigate}><Shield aria-hidden="true" />Privacy</NavLink>
      <NavLink to="/about" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`} onClick={onNavigate}><Info aria-hidden="true" />About</NavLink>
      <div className="nav-foot">
        <NavLink to="/imports" onClick={onNavigate}>
          <span className={`status-dot ${tf2 === 'linked' ? 'ok' : tf2 === 'needs-permission' ? 'warn' : ''}`} />
          {tf2 === 'linked' ? 'TF2 files linked' : tf2 === 'needs-permission' ? 'TF2 folder: reconnect' : 'TF2 files not linked'}
        </NavLink>
        <span>Projects are stored in this browser only.</span>
      </div>
    </nav>
  );
}

function Footer() {
  return (
    <footer className="footer">
      <span>© {copyrightYear()} {APP.author}. Open-source software. Not affiliated with or endorsed by Valve Corporation.</span>
      <nav aria-label="Footer">
        <a href={APP.authorUrl} rel="noopener">darkzmaj.eu</a>
        <a href={APP.repo} rel="noopener">GitHub</a>
        <a href={`${APP.repo}/blob/main/LICENSE`} rel="noopener">MIT License</a>
        <NavLink to="/privacy">Privacy</NavLink>
        <NavLink to="/docs">Docs</NavLink>
      </nav>
    </footer>
  );
}

function Layout() {
  const [open, setOpen] = useState(false);
  const loc = useLocation();
  const isEditor = loc.pathname.startsWith('/editor');
  useEffect(() => { setOpen(false); }, [loc.pathname]);
  return (
    <div className="shell">
      <div className="mobile-bar">
        <button className="btn icon" aria-label="Open menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}><Menu /></button>
        <BrandMark /><strong>{APP.shortName}</strong>
      </div>
      <Nav open={open} onNavigate={() => setOpen(false)} />
      <main className="main" id="main">
        <ErrorBoundary key={loc.pathname}>
        <Suspense fallback={<div className="viewer-state" style={{ position: 'relative', minHeight: 200 }}><div className="spinner" /></div>}>
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/characters" element={<Characters />} />
            <Route path="/editor" element={<Editor />} />
            <Route path="/editor/:id" element={<Editor />} />
            <Route path="/cosmetics" element={<Cosmetics />} />
            <Route path="/models" element={<Models />} />
            <Route path="/imports" element={<Imports />} />
            <Route path="/exports" element={<Exports />} />
            <Route path="/backups" element={<Backups />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="/about" element={<InfoPages page="about" />} />
            <Route path="/privacy" element={<InfoPages page="privacy" />} />
            <Route path="/docs" element={<InfoPages page="docs" />} />
            <Route path="*" element={<InfoPages page="404" />} />
          </Routes>
        </Suspense>
        </ErrorBoundary>
        {!isEditor && <Footer />}
      </main>
      <Toasts />
    </div>
  );
}

export default function App() {
  const init = useApp((s) => s.init);
  useEffect(() => { void init(); }, [init]);
  return <BrowserRouter><Layout /></BrowserRouter>;
}
