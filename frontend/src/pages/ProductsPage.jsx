// frontend/src/pages/ProductsPage.jsx
import { useEffect, useMemo, useState } from 'react';
import ProductCard from '../components/ProductCard.jsx';
import StatusMessage from '../components/StatusMessage.jsx';
import { useCart } from '../context/CartContext.jsx';
import { api } from '../services/api.js';

// The choices shown in the Sort dropdown.
// "value" is what we keep in state, "label" is the text the shopper reads.
const SORT_OPTIONS = [
  { value: 'default', label: 'Default' },
  { value: 'price-asc', label: 'Price: low to high' },
  { value: 'price-desc', label: 'Price: high to low' },
  { value: 'name-asc', label: 'Name: A to Z' }
];

// Returns the list in the order the shopper picked.
// It never changes the list it receives: it sorts a COPY ([...list]).
// This matters because .sort() rearranges the array it is called on.
function sortProducts(list, sort) {
  // Default = leave the order exactly as the catalog gave it.
  if (sort === 'default') return list;

  const copy = [...list];

  // Number() is used because the price can arrive from the backend as text
  // like "1299.00". Comparing text would put "1000" before "999".
  if (sort === 'price-asc') return copy.sort((a, b) => Number(a.price) - Number(b.price));
  if (sort === 'price-desc') return copy.sort((a, b) => Number(b.price) - Number(a.price));

  // localeCompare compares words alphabetically, ignoring upper/lower case here.
  if (sort === 'name-asc') {
    return copy.sort((a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }));
  }

  return list;
}

export default function ProductsPage() {
  const [products, setProducts] = useState([]);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('All');
  // The sort choice lives here, beside search and category.
  const [sort, setSort] = useState('default');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  // Category choices are remembered from the FULL catalog (a request with no search).
  // This keeps the dropdown stable even when a search returns few or no products.
  const [allCategories, setAllCategories] = useState([]);
  const { addToCart, cartMessage } = useCart();

  // Ask the server for products whenever the search text changes.
  useEffect(() => {
    // "active" becomes false when this effect is cleaned up (search changed again
    // or the page closed). A late response from an OLD search is then ignored,
    // so the page always shows results for the latest search.
    let active = true;
    const query = search.trim();

    setLoading(true);
    setError('');

    // Small pause so we do not send a request for every single keystroke.
    const timer = setTimeout(() => {
      api.getProducts(query)
        .then((data) => {
          if (!active) return;
          setProducts(data.products);
          if (!query) {
            setAllCategories([...new Set(data.products.map((product) => product.category))]);
          }
        })
        .catch((caught) => {
          if (!active) return;
          setProducts([]);
          setError(caught.message);
        })
        .finally(() => active && setLoading(false));
    }, 250);

    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [search]);

  const categories = useMemo(() => ['All', ...allCategories], [allCategories]);

  // Step 1: FILTER by category. The text search is now done by the server,
  // so "products" already contains only the products matching the search.
  const filteredProducts = products.filter(
    (product) => category === 'All' || product.category === category
  );

  // Step 2: SORT. Put the filtered products in the chosen order.
  // Sorting comes after filtering, so only matching products are sorted and shown.
  const visibleProducts = sortProducts(filteredProducts, sort);

  return (
    <section>
      <div className="hero">
        <div>
          <p className="eyebrow">BSIT FULL-STACK PROJECT</p>
          <h1>Technology for study, work and play</h1>
          <p>Browse the starter catalog, build a cart and complete a simulated order.</p>
        </div>
      </div>

      <div className="toolbar">
        <label>
          <span>Search products</span>
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Try keyboard" />
        </label>
        <label>
          <span>Category</span>
          <select value={category} onChange={(event) => setCategory(event.target.value)}>
            {categories.map((item) => <option key={item}>{item}</option>)}
          </select>
        </label>
        <label>
          <span>Sort</span>
          <select value={sort} onChange={(event) => setSort(event.target.value)}>
            {SORT_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </label>
      </div>

      <StatusMessage>{cartMessage}</StatusMessage>
      {loading && <StatusMessage>Loading products…</StatusMessage>}
      {!loading && error && <StatusMessage type="error">{error}</StatusMessage>}
      {!loading && !error && visibleProducts.length === 0 && <StatusMessage>No products match your search or filters.</StatusMessage>}

      <div className="product-grid">
        {visibleProducts.map((product) => (
          <ProductCard key={product.id} product={product} onAddToCart={addToCart} />
        ))}
      </div>
    </section>
  );
}
