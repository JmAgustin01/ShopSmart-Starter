import { useState } from 'react';
import { Link } from 'react-router-dom';
import StatusMessage from '../components/StatusMessage.jsx';
import { api } from '../services/api.js';

const peso = (value) => `₱${Number(value).toLocaleString('en-PH')}`;

const MODE_LABELS = {
  ai: 'AI-written, checked against the catalog',
  rules: 'Built directly from catalog data',
  no_match: 'No matching product'
};

export default function AssistantPage() {
  const [question, setQuestion] = useState('');
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function ask(event) {
    event.preventDefault(); setError(''); setResult(null); setLoading(true);
    try { setResult(await api.askAssistant(question)); }
    catch (caught) { setError(caught.message); }
    finally { setLoading(false); }
  }

  return (
    <section className="assistant-layout">
      <div>
        <p className="eyebrow">GROUNDED ASSISTANT</p>
        <h1>Find a product</h1>
        <p>Answers use only the current ShopSmart catalog. An AI service may phrase the answer, but every product, price and link is checked against our database first.</p>
        <form onSubmit={ask}>
          <label>Your question<textarea value={question} onChange={(event) => setQuestion(event.target.value)} minLength="3" maxLength="300" placeholder="Which keyboard is below ₱2,000?" required /></label>
          <button disabled={loading}>{loading ? 'Searching…' : 'Ask ShopSmart'}</button>
        </form>
      </div>
      <div className="assistant-answer" aria-live="polite" aria-busy={loading}>
        <h2>Assistant response</h2>
        <StatusMessage type="error">{error}</StatusMessage>
        {loading && <StatusMessage>Checking the catalog and preparing an answer…</StatusMessage>}
        {!result && !error && !loading && <p>Your answer will appear here.</p>}
        {result && <>
          {result.mode && <p className={`answer-mode mode-${result.mode}`}>{MODE_LABELS[result.mode] || result.mode}</p>}
          <StatusMessage>{result.notice}</StatusMessage>
          <p className="answer-text">{result.answer}</p>
          {result.recommendedProducts.length > 0 && <div className="recommendations">
            {result.recommendedProducts.map((product) => (
              <Link key={product.id} to={`/products/${product.id}`}>
                {product.name} — {peso(product.price)}
                {product.stock !== undefined && <span className="rec-stock"> · {product.stock} in stock</span>}
              </Link>
            ))}
          </div>}
          {result.sources.length > 0 && <details className="sources">
            <summary>Sources ({result.sources.length})</summary>
            <ul>
              {result.sources.map((source) => (
                <li key={source.id}>
                  <Link to={`/products/${source.id}`}>Product #{source.id}</Link> — {source.name}
                  {source.price !== undefined && <> ({peso(source.price)})</>}
                </li>
              ))}
            </ul>
          </details>}
        </>}
      </div>
    </section>
  );
}
