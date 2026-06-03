import { useEffect, useMemo, useState } from "react";
import {
  listShows, listTicketTypes, seatAvailability, createOrder, orderStatus,
  eur, dateGr, type Show, type TicketType, type SeatAvail, type OrderStatus,
} from "./api";

type Screen = "list" | "seats" | "pay" | "thanks";
const PENDING_KEY = "tm_pending_order";

export default function App() {
  const [screen, setScreen] = useState<Screen>("list");
  const [shows, setShows] = useState<Show[]>([]);
  const [show, setShow] = useState<Show | null>(null);
  const [types, setTypes] = useState<TicketType[]>([]);
  const [seats, setSeats] = useState<SeatAvail[]>([]);
  const [activeType, setActiveType] = useState<number | null>(null);
  const [picked, setPicked] = useState<Record<number, number>>({}); // seat_id -> ticketTypeId
  const [customer, setCustomer] = useState({ name: "", email: "", phone: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [selectedDate, setSelectedDate] = useState<string>("");
  const [calMonth, setCalMonth] = useState(() => { const d = new Date(); return { y: d.getFullYear(), m: d.getMonth() }; });

  // Επιστροφή από Viva: αν υπάρχει pending order, δείξε ευχαριστίες + polling.
  const [pending, setPending] = useState<{ orderId: number; token: string; title: string } | null>(null);
  const [status, setStatus] = useState<OrderStatus | null>(null);

  useEffect(() => {
    const raw = localStorage.getItem(PENDING_KEY);
    if (raw) { try { setPending(JSON.parse(raw)); setScreen("thanks"); } catch { /* */ } }
    listShows().then(setShows).catch((e) => setError(e.message));
  }, []);

  // Polling κατάστασης παραγγελίας στην οθόνη ευχαριστιών.
  useEffect(() => {
    if (screen !== "thanks" || !pending) return;
    let stop = false;
    const tick = async () => {
      try {
        const s = await orderStatus(pending.orderId, pending.token);
        if (stop) return;
        setStatus(s);
        if (s.status === "paid") { localStorage.removeItem(PENDING_KEY); return; }
      } catch { /* keep polling */ }
      if (!stop) setTimeout(tick, 3000);
    };
    tick();
    return () => { stop = true; };
  }, [screen, pending]);

  function isClosed(s: Show): boolean {
    return !!s.sales_close_at && new Date(s.sales_close_at) < new Date();
  }

  async function openShow(s: Show) {
    setError(""); setShow(s); setPicked({}); setBusy(true);
    try {
      const [tt, sa] = await Promise.all([listTicketTypes(s.id), seatAvailability(s.id)]);
      setTypes(tt); setSeats(sa); setActiveType(tt[0]?.id ?? null);
      setScreen("seats");
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }

  function toggleSeat(seat: SeatAvail) {
    if (!seat.available || activeType == null) return;
    setPicked((p) => {
      const n = { ...p };
      if (n[seat.seat_id]) delete n[seat.seat_id];
      else n[seat.seat_id] = activeType;
      return n;
    });
  }

  // Πλέγμα ανά γραμμή (y), κελιά ταξινομημένα ανά στήλη (x) — διάδρομοι/κενά ως spacers.
  const grid = useMemo(() => {
    const byY = new Map<number, SeatAvail[]>();
    for (const s of seats) { const y = s.y ?? 0; if (!byY.has(y)) byY.set(y, []); byY.get(y)!.push(s); }
    return [...byY.entries()].sort((a, b) => a[0] - b[0])
      .map(([y, cells]) => ({ y, cells: cells.sort((a, b) => (a.x ?? 0) - (b.x ?? 0)) }));
  }, [seats]);

  const ttMap = useMemo(() => new Map(types.map((t) => [t.id, t])), [types]);
  const total = useMemo(
    () => Object.values(picked).reduce((s, id) => s + (ttMap.get(id)?.price_cents ?? 0), 0),
    [picked, ttMap],
  );
  const count = Object.keys(picked).length;

  // Θεάματα ανά ημερομηνία (για το ημερολόγιο) + σύνολο διαθέσιμων ημερομηνιών.
  const showsByDate = useMemo(() => {
    const m = new Map<string, Show[]>();
    for (const s of shows) { const k = s.show_date; if (!m.has(k)) m.set(k, []); m.get(k)!.push(s); }
    for (const arr of m.values()) arr.sort((a, b) => (a.start_time || "").localeCompare(b.start_time || ""));
    return m;
  }, [shows]);
  const dayShows = selectedDate ? (showsByDate.get(selectedDate) ?? []) : [];

  async function pay() {
    if (!show || !count) return;
    if (!customer.email) { setError("Συμπληρώστε email"); return; }
    setBusy(true); setError("");
    try {
      const items = Object.entries(picked).map(([seatId, ttId]) => ({ seatId: Number(seatId), ticketTypeId: ttId }));
      const res = await createOrder({ showId: show.id, items, customer });
      localStorage.setItem(PENDING_KEY, JSON.stringify({ orderId: res.orderId, token: res.statusToken, title: show.title }));
      window.location.href = res.checkoutUrl; // ανακατεύθυνση στο Viva checkout
    } catch (e) { setError((e as Error).message); setBusy(false); }
  }

  function reset() {
    localStorage.removeItem(PENDING_KEY);
    setPending(null); setStatus(null); setShow(null); setPicked({}); setError("");
    setScreen("list");
  }

  return (
    <>
      <div className="appbar"><div className="wrap"><h1>🎭 Online Κρατήσεις Εισιτηρίων</h1></div></div>
      <div className="wrap">
        {error && <div className="err">{error}</div>}

        {screen === "list" && (
          <div className="booking">
            <div className="calwrap">
              <Calendar month={calMonth} setMonth={setCalMonth}
                hasShows={(d) => showsByDate.has(d)} selected={selectedDate} onPick={setSelectedDate} />
            </div>
            <div className="dayshows">
              {!selectedDate && <p className="muted">Διάλεξε ημερομηνία από το ημερολόγιο για να δεις τα θεάματα.</p>}
              {selectedDate && dayShows.length === 0 && <p className="muted">Καμία παράσταση στις {dateGr(selectedDate)}.</p>}
              {selectedDate && dayShows.length > 0 && <h3 style={{ marginTop: 0 }}>{dateGr(selectedDate)}</h3>}
              {dayShows.map((s) => (
                <div key={s.id} className="card" onClick={() => !isClosed(s) && openShow(s)}>
                  {s.image_url && <img className="showimg" src={s.image_url} alt={s.title} />}
                  <div className="row">
                    <div>
                      <h3>{s.title}</h3>
                      <div className="muted">{s.subtitle}</div>
                      {s.description && <div className="muted" style={{ marginTop: 4 }}>{s.description}</div>}
                      <div className="muted">{s.venue_name} · {s.start_time}{s.end_time ? `–${s.end_time}` : ""}</div>
                    </div>
                    {isClosed(s)
                      ? <span className="closed">Έκλεισαν οι online πωλήσεις</span>
                      : <span className="btn alt">Κράτηση →</span>}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {screen === "seats" && show && (
          <div className="screen">
            <button className="link" onClick={reset}>← Πίσω στα θεάματα</button>
            <h2>{show.title}</h2>
            <div className="muted">{dateGr(show.show_date)} · {show.start_time} · {show.venue_name}</div>

            <div className="types">
              {types.map((t) => (
                <button key={t.id} className={`type ${activeType === t.id ? "active" : ""}`} onClick={() => setActiveType(t.id)}>
                  {t.title} — {eur(t.price_cents)}
                </button>
              ))}
            </div>

            <div className="screenrow">ΟΘΟΝΗ / ΣΚΗΝΗ</div>
            <div className="seatmap">
              {grid.map((row) => (
                <div key={row.y} className="seatrow">
                  <span className="rowlabel">{row.cells.find((c) => c.kind === "seat")?.row_label ?? ""}</span>
                  {row.cells.map((seat) => {
                    if (seat.kind !== "seat") return <span key={`${row.y}-${seat.x}`} className="seat" style={{ background: "transparent" }} />;
                    const sel = !!picked[seat.seat_id];
                    const cls = !seat.available ? "sold" : sel ? "sel" : "";
                    return (
                      <button key={seat.seat_id} className={`seat ${cls}`} onClick={() => toggleSeat(seat)}
                        title={seat.seat_label} disabled={!seat.available}>
                        {(seat.row_label && seat.seat_label.startsWith(seat.row_label)) ? seat.seat_label.slice(seat.row_label.length) : seat.seat_label}
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>

            <div className="legend">
              <span><i className="dot" style={{ background: "var(--free)" }} />Ελεύθερη</span>
              <span><i className="dot" style={{ background: "var(--sel)" }} />Επιλεγμένη</span>
              <span><i className="dot" style={{ background: "var(--sold)" }} />Μη διαθέσιμη</span>
            </div>

            <div className="row">
              <span className="muted">{count} θέσεις</span>
              <span className="total">{eur(total)}</span>
            </div>
            <button className="btn" disabled={!count} style={{ width: "100%", marginTop: 12 }}
              onClick={() => { setError(""); setScreen("pay"); }}>
              Συνέχεια
            </button>
          </div>
        )}

        {screen === "pay" && show && (
          <div className="screen">
            <button className="link" onClick={() => setScreen("seats")}>← Πίσω στις θέσεις</button>
            <h2>Στοιχεία & Πληρωμή</h2>
            <div className="summary">
              <strong>{show.title}</strong> — {dateGr(show.show_date)} {show.start_time}<br />
              <span className="muted">
                {Object.entries(picked).map(([sid, tid]) => {
                  const seat = seats.find((x) => x.seat_id === Number(sid));
                  return `${seat?.seat_label} (${ttMap.get(tid)?.title})`;
                }).join(", ")}
              </span>
              <div className="row" style={{ marginTop: 8 }}><span>Σύνολο</span><span className="total">{eur(total)}</span></div>
            </div>

            <label className="field"><label>Ονοματεπώνυμο</label>
              <input value={customer.name} onChange={(e) => setCustomer({ ...customer, name: e.target.value })} /></label>
            <label className="field"><label>Email *</label>
              <input type="email" value={customer.email} onChange={(e) => setCustomer({ ...customer, email: e.target.value })} /></label>
            <label className="field"><label>Τηλέφωνο</label>
              <input value={customer.phone} onChange={(e) => setCustomer({ ...customer, phone: e.target.value })} /></label>

            <button className="btn" disabled={busy} style={{ width: "100%", marginTop: 8 }} onClick={pay}>
              {busy ? "Μεταφορά στην πληρωμή…" : `Πληρωμή ${eur(total)} με κάρτα`}
            </button>
            <p className="muted" style={{ textAlign: "center", marginTop: 8 }}>
              Ασφαλής πληρωμή μέσω Viva. Το εισιτήριο θα σταλεί στο email σας.
            </p>
          </div>
        )}

        {screen === "thanks" && (
          <div className="screen" style={{ textAlign: "center" }}>
            {(!status || status.status !== "paid") ? (
              <>
                <h2>Επιβεβαίωση πληρωμής…</h2>
                <p className="muted">Περιμένουμε την επιβεβαίωση από τη Viva. Μην κλείσετε τη σελίδα.</p>
                <p className="muted">{pending?.title}</p>
              </>
            ) : (
              <>
                <div className="ok">✓ Η κράτησή σας ολοκληρώθηκε!</div>
                <p>Το εισιτήριο στάλθηκε στο email σας. Μπορείτε επίσης να το ανοίξετε εδώ:</p>
                <ul style={{ listStyle: "none", padding: 0 }}>
                  {status.tickets.map((t) => (
                    <li key={t.serial} style={{ margin: "8px 0" }}>
                      <a className="btn alt" href={t.url} target="_blank" rel="noreferrer">{t.serial} — Άνοιγμα εισιτηρίου</a>
                    </li>
                  ))}
                </ul>
              </>
            )}
            <button className="link" onClick={reset} style={{ marginTop: 16 }}>← Νέα κράτηση</button>
          </div>
        )}
      </div>
    </>
  );
}

// ── Ημερολόγιο-widget (μήνας, Δευτέρα πρώτη) ──────────────────────────────
function Calendar({ month, setMonth, hasShows, selected, onPick }: {
  month: { y: number; m: number };
  setMonth: (m: { y: number; m: number }) => void;
  hasShows: (date: string) => boolean;
  selected: string;
  onPick: (date: string) => void;
}) {
  const { y, m } = month;
  const monthName = new Intl.DateTimeFormat("el-GR", { month: "long", year: "numeric" })
    .format(new Date(y, m, 1));
  const first = new Date(y, m, 1);
  const startOffset = (first.getDay() + 6) % 7; // Δευτέρα = 0
  const daysIn = new Date(y, m + 1, 0).getDate();
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const pad = (n: number) => String(n).padStart(2, "0");
  const cells: (string | null)[] = [];
  for (let i = 0; i < startOffset; i++) cells.push(null);
  for (let d = 1; d <= daysIn; d++) cells.push(`${y}-${pad(m + 1)}-${pad(d)}`);

  const prev = () => setMonth(m === 0 ? { y: y - 1, m: 11 } : { y, m: m - 1 });
  const next = () => setMonth(m === 11 ? { y: y + 1, m: 0 } : { y, m: m + 1 });

  return (
    <div className="cal">
      <div className="cal-head">
        <button className="cal-nav" onClick={prev}>‹</button>
        <span className="cal-title">{monthName}</span>
        <button className="cal-nav" onClick={next}>›</button>
      </div>
      <div className="cal-grid cal-dow">
        {["Δε", "Τρ", "Τε", "Πε", "Πα", "Σά", "Κυ"].map((w) => <span key={w}>{w}</span>)}
      </div>
      <div className="cal-grid">
        {cells.map((date, i) => {
          if (!date) return <span key={i} />;
          const has = hasShows(date);
          const past = new Date(date + "T00:00:00") < today;
          const cls = ["cal-day"];
          if (has && !past) cls.push("has");
          if (date === selected) cls.push("sel");
          if (past || !has) cls.push("off");
          const day = Number(date.slice(8));
          return (
            <button key={date} className={cls.join(" ")} disabled={past || !has}
              onClick={() => onPick(date)}>{day}</button>
          );
        })}
      </div>
    </div>
  );
}
