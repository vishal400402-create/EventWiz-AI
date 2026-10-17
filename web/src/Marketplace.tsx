
import { useEffect, useMemo, useState } from 'react';

type Service = {
  id: string;
  name: string;
  category: string;
  price: number;
  pricing_type?: string;
  pricingType?: string;
  description?: string;
  availability?: string;
  location?: string;
  published?: boolean | number;
  images?: { path?: string; url?: string }[];
};

export default function Marketplace() {
  const [items, setItems] = useState<Service[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('All');
  const [location, setLocation] = useState('');

  useEffect(() => {
    fetch('/api/public/services')
      .then(async (response) => {
        if (!response.ok) throw new Error('Services load nahi hui');
        return response.json();
      })
      .then((data: { items?: Service[] }) => {
        setItems(data.items || []);
        setError('');
      })
      .catch(() => setError('Services load nahi hui. Backend check karo.'))
      .finally(() => setLoading(false));
  }, []);

  const categories = useMemo(
    () => ['All', ...Array.from(new Set(items.map((s) => s.category).filter(Boolean)))],
    [items]
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const city = location.trim().toLowerCase();

    return items.filter((s) => {
      const matchesSearch =
        !q ||
        s.name.toLowerCase().includes(q) ||
        (s.description || '').toLowerCase().includes(q) ||
        s.category.toLowerCase().includes(q);

      const matchesCategory = category === 'All' || s.category === category;
      const matchesLocation = !city || (s.location || '').toLowerCase().includes(city);

      return matchesSearch && matchesCategory && matchesLocation;
    });
  }, [items, search, category, location]);

  return (
    <div className="marketplace">
      <header className="market-header">
        <a className="market-brand" href="/marketplace">✦ EventWiz <b>AI</b></a>
        <span>Discover event services</span>
      </header>

      <section className="market-hero">
        <p className="market-eyebrow">MAKE YOUR EVENT SPECIAL</p>
        <h1>Find services for your next big moment.</h1>
        <p>Explore event services and discover options for your celebration.</p>
        <div className="market-search">
          <input
            aria-label="Search services"
            placeholder="Search decoration, catering, photography..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <input
            aria-label="Filter by location"
            placeholder="City, e.g. Mumbai"
            value={location}
            onChange={(e) => setLocation(e.target.value)}
          />
        </div>
      </section>

      <main className="market-content">
        <div className="market-title-row">
          <div>
            <h2>Explore services</h2>
            <p>Find the right service for your event.</p>
          </div>
          <span>{filtered.length} services</span>
        </div>

        <div className="market-categories">
          {categories.map((c) => (
            <button
              key={c}
              className={category === c ? 'selected' : ''}
              onClick={() => setCategory(c)}
            >
              {c}
            </button>
          ))}
        </div>

        {loading ? (
          <p className="market-message">Loading services...</p>
        ) : error ? (
          <p className="market-message">{error}</p>
        ) : filtered.length === 0 ? (
          <div className="market-empty">
            <h3>No matching services yet</h3>
            <p>Try another search or location.</p>
          </div>
        ) : (
          <div className="market-grid">
            {filtered.map((s) => {
              const image = s.images?.[0]?.path || s.images?.[0]?.url;
              const pricing = s.pricing_type || s.pricingType || 'fixed';

              return (
                <article className="market-card" key={s.id}>
                  {image ? (
                    <img src={image} alt={s.name} />
                  ) : (
                    <div className="market-image-placeholder">✦</div>
                  )}

                  <div className="market-card-body">
                    <div className="market-card-meta">
                      <span>{s.category}</span>
                      {s.location && <span>{s.location}</span>}
                    </div>
                    <h3>{s.name}</h3>
                    <p>{s.description || 'Contact us for service details.'}</p>
                    <div className="market-card-bottom">
                      <strong>
                        {pricing === 'quote'
                          ? 'Request a quote'
                          : `${pricing === 'starting' ? 'From ' : ''}₹${Number(s.price || 0).toLocaleString('en-IN')}`}
                      </strong>
                      <span>{s.availability || 'Check availability'}</span>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </main>

      <footer className="market-footer">EventWiz AI · Make every event memorable</footer>
    </div>
  );
}