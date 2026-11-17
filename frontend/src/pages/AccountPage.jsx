// The signed-in customer's own simulated orders. The API returns only orders this account placed.
import { useEffect, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import StatusMessage from '../components/StatusMessage.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { api } from '../services/api.js';

const peso = (value) => `₱${Number(value).toLocaleString('en-PH', { minimumFractionDigits: 2 })}`;

export default function AccountPage() {
  const { user, checking, logout } = useAuth();
  const [orders, setOrders] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!user) return;
    api.getMyOrders().then(setOrders).catch((caught) => setError(caught.message));
  }, [user]);

  if (checking) return <StatusMessage>Checking your sign-in…</StatusMessage>;
  if (!user) return <Navigate to="/login?next=/account" replace />;

  return (
    <section>
      <p className="eyebrow">MY ACCOUNT</p>
      <h1>{user.name}</h1>
      <p className="muted">{user.email}</p>
      <button type="button" className="button secondary" onClick={logout}>Sign out</button>
      <h2>My orders</h2>
      <StatusMessage type="error">{error}</StatusMessage>
      {orders === null && !error && <StatusMessage>Loading your orders…</StatusMessage>}
      {orders?.length === 0 && <div className="empty-state"><p>You have not placed an order yet.</p><Link className="button" to="/">Browse products</Link></div>}
      {orders?.map((order) => (
        <article className="order-card" key={order.id}>
          <header><strong>Order #{order.id}</strong><span>{new Date(order.createdAt).toLocaleString('en-PH')}</span><span className="badge">{order.status}</span></header>
          <ul>{order.items.map((item) => <li key={item.id}>{item.productName} × {item.quantity} — {peso(Number(item.unitPrice) * item.quantity)}</li>)}</ul>
          <p>Deliver to {order.customerName}, {order.address}</p>
          <p className="summary-total"><span>Total</span><strong>{peso(order.total)}</strong></p>
        </article>
      ))}
    </section>
  );
}
