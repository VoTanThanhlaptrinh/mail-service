import { useCallback, useEffect, useState } from 'react';
import { api } from './api';
import { ApiKeysPage } from './components/ApiKeysPage';
import { MailboxPage } from './components/MailboxPage';
import type { Health } from './types';

type View = 'mailbox' | 'keys';
type Tone = 'error' | 'success';

interface Notice {
  tone: Tone;
  message: string;
}

const TABS: { value: View; label: string }[] = [
  { value: 'mailbox', label: 'Hộp thư' },
  { value: 'keys', label: 'API key' },
];

/** Deep link: /#keys opens the API key tab, anything else opens the mailbox. */
function viewFromHash(): View {
  return window.location.hash.replace(/^#\/?/, '') === 'keys' ? 'keys' : 'mailbox';
}

export default function App() {
  const [view, setView] = useState<View>(viewFromHash);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [health, setHealth] = useState<Health | null>(null);

  const notify = useCallback((tone: Tone, message: string) => {
    setNotice({ tone, message });
  }, []);

  useEffect(() => {
    const handleHashChange = () => setView(viewFromHash());
    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, []);

  function changeView(next: View) {
    setView(next);
    const hash = next === 'keys' ? '#keys' : '';
    if (window.location.hash !== hash) {
      window.history.replaceState(null, '', hash || window.location.pathname + window.location.search);
    }
  }

  useEffect(() => {
    if (notice?.tone !== 'success') return;
    const timer = setTimeout(() => setNotice(null), 5000);
    return () => clearTimeout(timer);
  }, [notice]);

  useEffect(() => {
    let cancelled = false;

    const check = async () => {
      try {
        const result = await api.health();
        if (!cancelled) setHealth(result);
      } catch {
        if (!cancelled) setHealth(null);
      }
    };

    void check();
    const interval = setInterval(() => void check(), 15_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  return (
    <div className="app">
      <header className="header">
        <div>
          <p className="header__eyebrow">React · Node.js · PostgreSQL</p>
          <h1 className="header__title">Mail Service</h1>
        </div>

        <div className={`status ${health ? `status--${health.database}` : 'status--down'}`}>
          <span className="status__dot" />
          {health ? `API OK · DB ${health.database}` : 'Mất kết nối API'}
        </div>
      </header>

      <nav className="tabs" aria-label="Khu vực">
        {TABS.map((tab) => (
          <button
            key={tab.value}
            className={`tab ${view === tab.value ? 'tab--active' : ''}`}
            type="button"
            aria-pressed={view === tab.value}
            onClick={() => changeView(tab.value)}
          >
            {tab.label}
          </button>
        ))}
      </nav>

      {notice ? (
        <div
          className={`alert alert--${notice.tone}`}
          role={notice.tone === 'error' ? 'alert' : 'status'}
        >
          <span>{notice.message}</span>
          <button
            className="alert__close"
            type="button"
            onClick={() => setNotice(null)}
            aria-label="Đóng"
          >
            ×
          </button>
        </div>
      ) : null}

      {view === 'mailbox' ? <MailboxPage notify={notify} /> : <ApiKeysPage notify={notify} />}

      <footer className="footer">
        API: <code>http://localhost:4000/api</code> · Web: <code>http://localhost:5173</code>
      </footer>
    </div>
  );
}
