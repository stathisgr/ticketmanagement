import { useEffect, useRef, useState } from 'react';
import { isoToDmy, dmyToIso } from '../api';

/**
 * Πεδίο ημερομηνίας που εμφανίζει ΠΑΝΤΑ ΗΗ/ΜΜ/ΕΕΕΕ (ανεξάρτητα από το locale του browser),
 * ενώ η τιμή προς τα έξω παραμένει ISO 'YYYY-MM-DD'. Διαθέτει και κουμπί ημερολογίου 📅
 * (native picker) για εύκολη επιλογή.
 */
export default function DateField({
  value, onChange, className = '', disabled = false, placeholder = 'ΗΗ/ΜΜ/ΕΕΕΕ',
}: {
  value: string; onChange: (iso: string) => void; className?: string; disabled?: boolean; placeholder?: string;
}) {
  const [text, setText] = useState(isoToDmy(value));
  const native = useRef<HTMLInputElement>(null);
  useEffect(() => { setText(isoToDmy(value)); }, [value]);

  // Αυτόματη εισαγωγή «/» καθώς πληκτρολογεί ο χρήστης (μόνο ψηφία).
  function mask(raw: string): string {
    const d = raw.replace(/\D/g, '').slice(0, 8);
    const p = [d.slice(0, 2), d.slice(2, 4), d.slice(4, 8)].filter((x) => x.length);
    return p.join('/');
  }
  function onText(v: string) {
    const t = mask(v);
    setText(t);
    const iso = dmyToIso(t);
    if (iso) onChange(iso);
    else if (t === '') onChange('');
  }
  function openPicker() {
    const el = native.current; if (!el) return;
    // showPicker() σε σύγχρονους browsers· αλλιώς focus.
    (el as any).showPicker ? (el as any).showPicker() : el.focus();
  }

  return (
    <span className={`relative inline-flex items-center ${className}`}>
      <input
        type="text" inputMode="numeric" value={text} placeholder={placeholder} disabled={disabled}
        onChange={(e) => onText(e.target.value)}
        className="border rounded px-2 py-1 w-32 disabled:bg-gray-100"
      />
      <button type="button" onClick={openPicker} disabled={disabled}
        className="ml-1 px-1.5 py-1 text-gray-500 hover:text-slate-800 disabled:opacity-40" title="Ημερολόγιο" aria-label="Ημερολόγιο">📅</button>
      <input
        ref={native} type="date" value={value || ''} tabIndex={-1} aria-hidden disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        className="absolute opacity-0 w-0 h-0 pointer-events-none"
      />
    </span>
  );
}
