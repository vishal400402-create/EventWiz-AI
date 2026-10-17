import { useEffect, useMemo, useState, type FormEvent } from 'react';

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
  images?: { path?: string; url?: string }[];
};

type BookingForm = {
  customerName: string;
  phone: string;
  eventType: string;
  preferredDate: string;
  location: string;
  guestCount: string;
  notes: string;
};

const initialForm: BookingForm = {
  customerName: '',
  phone: '',
  eventType: 'Wedding',
  preferredDate: '',
  location: '',
  guestCount: '100',
  notes: '',
};

export default function Marketplace() {
  const [items, setItems] = useState<Service[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('All');
  const [location, setLocation] = useState('');

  const [selectedService, setSelectedService] = useState<Service | null>(null);
  const [form, setForm] = useState<BookingForm>(initialForm);
  const [submitting, setSubmitting] = useState(false);
  const [bookingError, setBookingError] = useState('');
  const [bookingReference, setBookingReference] = useState('');

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

  function openBooking(service: Service) {
    setSelectedService(service);
    setBookingError('');
    setBookingReference('');
    setForm({
      ...initialForm,
      location: service.location || '',
    });
  }

  function closeBooking() {
    if (submitting) return;
    setSelectedService(null);
    setBookingError('');
    setBookingReference('');
  }

  async function submitBooking(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedService) return;

    setSubmitting(true);
    setBookingError('');
    setBookingReference('');

    try {
      const response = await fetch('/api/public/bookings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          serviceId: selectedService.id,
          customerName: form.customerName.trim(),
          phone: form.phone.trim(),
          eventType: form.eventType,
          preferredDate: form.preferredDate,
          location: form.location.trim(),
          guestCount: Number(form.guestCount),
          notes: form.notes.trim(),
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message || data.error?.message || 'Booking submit nahi hui. Details check karo.');
      }

      setBookingReference(data.reference || 'Submitted');
    } catch (err) {
      setBookingError(
        err instanceof Error ? err.message : 'Network error. Please try again.'
      );
    } finally {
      setSubmitting(false);
    }
  }

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

                    <button
                      type="button"
                      className="market-book-button"
                      onClick={() => openBooking(s)}
                    >
                      Book Now
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </main>

      {selectedService && (
        <div className="market-modal-backdrop" onClick={closeBooking}>
          <section
            className="market-booking-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="booking-title"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              className="market-modal-close"
              aria-label="Close booking form"
              onClick={closeBooking}
              disabled={submitting}
            >
              ×
            </button>

            {bookingReference ? (
              <div className="market-booking-success">
                <h2 id="booking-title">Booking request submitted!</h2>
                <p>
                  Your request for <strong>{selectedService.name}</strong> has
                  been recorded.
                </p>
                <p>Reference: <strong>{bookingReference}</strong></p>
                <p>Status: New</p>
                <button
                  type="button"
                  className="market-book-button"
                  onClick={closeBooking}
                >
                  Done
                </button>
              </div>
            ) : (
              <>
                <h2 id="booking-title">Book {selectedService.name}</h2>
                <p>Fill in your event details to send a booking request.</p>

                <form className="market-booking-form" onSubmit={submitBooking}>
                  <label>
                    Your name
                    <input
                      required
                      minLength={2}
                      maxLength={100}
                      value={form.customerName}
                      onChange={(e) => setForm({ ...form, customerName: e.target.value })}
                      autoComplete="name"
                    />
                  </label>

                  <label>
                    Phone number
                    <input
                      required
                      minLength={7}
                      maxLength={20}
                      value={form.phone}
                      onChange={(e) => setForm({ ...form, phone: e.target.value })}
                      autoComplete="tel"
                      placeholder="Enter contact number"
                    />
                  </label>

                  <label>
                    Event type
                    <select
                      required
                      value={form.eventType}
                      onChange={(e) => setForm({ ...form, eventType: e.target.value })}
                    >
                      {['Wedding', 'Birthday', 'College', 'Seminar', 'Conference', 'Corporate', 'Other'].map((type) => (
                        <option key={type} value={type}>{type}</option>
                      ))}
                    </select>
                  </label>

                  <label>
                    Preferred date
                    <input
                      required
                      type="date"
                      value={form.preferredDate}
                      onChange={(e) => setForm({ ...form, preferredDate: e.target.value })}
                    />
                  </label>

                  <label>
                    Event location
                    <input
                      required
                      minLength={2}
                      maxLength={200}
                      value={form.location}
                      onChange={(e) => setForm({ ...form, location: e.target.value })}
                      placeholder="City or venue"
                    />
                  </label>

                  <label>
                    Expected guests
                    <input
                      required
                      type="number"
                      min={1}
                      max={100000}
                      step={1}
                      value={form.guestCount}
                      onChange={(e) => setForm({ ...form, guestCount: e.target.value })}
                    />
                  </label>

                  <label>
                    Notes (optional)
                    <textarea
                      maxLength={1000}
                      rows={3}
                      value={form.notes}
                      onChange={(e) => setForm({ ...form, notes: e.target.value })}
                      placeholder="Any special requirements?"
                    />
                  </label>

                  {bookingError && (
                    <p className="market-booking-error" role="alert">{bookingError}</p>
                  )}

                  <button
                    type="submit"
                    className="market-book-button"
                    disabled={submitting}
                  >
                    {submitting ? 'Submitting...' : 'Submit Booking Request'}
                  </button>
                </form>
              </>
            )}
          </section>
        </div>
      )}

      <footer className="market-footer">EventWiz AI · Make every event memorable</footer>
    </div>
  );
}