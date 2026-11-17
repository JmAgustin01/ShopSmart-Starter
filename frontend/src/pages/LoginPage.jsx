// Sign in or create a ShopSmart account. Use fictional details only (simulated store).
import { useState } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import StatusMessage from '../components/StatusMessage.jsx';
import { useAuth } from '../context/AuthContext.jsx';

export default function LoginPage() {
  const { user, login, register } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  // Return to the page that sent the shopper here (for example /checkout), but only inside this site.
  const requested = new URLSearchParams(location.search).get('next') || '/account';
  const next = requested.startsWith('/') && !requested.startsWith('//') ? requested : '/account';
  const [mode, setMode] = useState('login');
  const [form, setForm] = useState({ name: '', email: '', password: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  if (user) return <Navigate to={next} replace />;

  function updateField(event) {
    setForm((current) => ({ ...current, [event.target.name]: event.target.value }));
  }

  async function submit(event) {
    event.preventDefault();
    setError('');
    setBusy(true);
    try {
      if (mode === 'login') await login({ email: form.email, password: form.password });
      else await register(form);
      navigate(next, { replace: true });
    } catch (caught) {
      setError(caught.message);
    } finally {
      setBusy(false);
    }
  }

  const isLogin = mode === 'login';
  return (
    <section className="auth-card">
      <p className="eyebrow">{isLogin ? 'WELCOME BACK' : 'NEW CUSTOMER'}</p>
      <h1>{isLogin ? 'Sign in' : 'Create an account'}</h1>
      <p className="muted">Demo store: use fictional details only, never a real password you use elsewhere.</p>
      <form onSubmit={submit}>
        <StatusMessage type="error">{error}</StatusMessage>
        {!isLogin && <label>Full name<input name="name" value={form.name} onChange={updateField} minLength="2" maxLength="80" autoComplete="name" required /></label>}
        <label>Email address<input name="email" type="email" value={form.email} onChange={updateField} autoComplete="email" required /></label>
        <label>Password<input name="password" type="password" value={form.password} onChange={updateField} minLength={isLogin ? 1 : 8} maxLength="72" autoComplete={isLogin ? 'current-password' : 'new-password'} required /></label>
        {!isLogin && <small>At least 8 characters.</small>}
        <button disabled={busy}>{busy ? 'Please wait…' : isLogin ? 'Sign in' : 'Create account'}</button>
      </form>
      <p>
        {isLogin ? 'New to ShopSmart? ' : 'Already have an account? '}
        <button type="button" className="link-button" onClick={() => { setMode(isLogin ? 'register' : 'login'); setError(''); }}>
          {isLogin ? 'Create an account' : 'Sign in'}
        </button>
      </p>
      <Link to="/">← Back to products</Link>
    </section>
  );
}
