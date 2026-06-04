/**
 * Αποστολή email από τον τοπικό server μέσω Resend (HTTP API).
 * Η ρύθμιση (κλειδί/αποστολέας) αποθηκεύεται από τον χρήστη στο fiscal_config.config.email
 * (όπως και τα υπόλοιπα διαπιστευτήρια — δεν τα διαχειρίζεται ο βοηθός).
 */
import { db } from '../db.js';

export interface EmailCfg { resendKey: string; from: string; replyTo?: string; }

/** Διαβάζει τη ρύθμιση email· null αν δεν είναι ενεργή/συμπληρωμένη. */
export function emailCfg(): EmailCfg | null {
  const row = db.prepare('SELECT config FROM fiscal_config WHERE id = 1').get() as any;
  let c: any = {}; try { c = JSON.parse(row?.config ?? '{}'); } catch { /* ignore */ }
  const e = c.email;
  if (!e || !e.enabled || !e.resendKey || !e.from) return null;
  return { resendKey: String(e.resendKey), from: String(e.from), replyTo: e.replyTo ? String(e.replyTo) : undefined };
}

/** Αποστολή ενός email. Επιστρέφει {ok} — δεν ρίχνει εξαίρεση (να μη σπάει ο συγχρονισμός). */
export async function sendEmail(to: string, subject: string, html: string): Promise<{ ok: boolean; error?: string }> {
  const cfg = emailCfg();
  if (!cfg) return { ok: false, error: 'Δεν έχει ρυθμιστεί email (Resend).' };
  if (!to) return { ok: false, error: 'Λείπει παραλήπτης.' };
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${cfg.resendKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: cfg.from, to: [to], subject, html, ...(cfg.replyTo ? { reply_to: cfg.replyTo } : {}) }),
    });
    if (!res.ok) return { ok: false, error: `Resend ${res.status}: ${(await res.text()).slice(0, 200)}` };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

/** HTML σώμα email απόδειξης online αγοράς (σύνδεσμος προς το επίσημο PDF του παρόχου). */
export function receiptEmailHtml(p: {
  name?: string; showTitle?: string; showDate?: string; seats?: string;
  total: number; mark?: string; link?: string; venueName?: string; payment?: string;
}): string {
  const esc = (s: any) => String(s ?? '').replace(/[<>&]/g, (m) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[m] as string));
  const dmy = (d?: string) => (d && /^\d{4}-\d{2}-\d{2}/.test(d) ? `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}` : (d ?? ''));
  return `<div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:0 auto;color:#222">
    <h2 style="margin:0 0 4px">Απόδειξη Παροχής Υπηρεσιών</h2>
    <p style="margin:0 0 16px;color:#666">${esc(p.venueName ?? '')}</p>
    <p>Αγαπητέ/ή ${esc(p.name || 'πελάτη')},</p>
    <p>Σας ευχαριστούμε για την online αγορά σας. Παρακάτω θα βρείτε την επίσημη απόδειξη για την κράτησή σας.</p>
    <table style="border-collapse:collapse;margin:12px 0;font-size:14px">
      ${p.showTitle ? `<tr><td style="padding:4px 12px 4px 0;color:#666">Θέαμα</td><td style="padding:4px 0"><b>${esc(p.showTitle)}</b></td></tr>` : ''}
      ${p.showDate ? `<tr><td style="padding:4px 12px 4px 0;color:#666">Ημερομηνία</td><td style="padding:4px 0">${esc(dmy(p.showDate))}</td></tr>` : ''}
      ${p.seats ? `<tr><td style="padding:4px 12px 4px 0;color:#666">Θέσεις</td><td style="padding:4px 0">${esc(p.seats)}</td></tr>` : ''}
      <tr><td style="padding:4px 12px 4px 0;color:#666">Ποσό</td><td style="padding:4px 0"><b>${p.total.toFixed(2)} €</b></td></tr>
      <tr><td style="padding:4px 12px 4px 0;color:#666">Πληρωμή</td><td style="padding:4px 0">${esc(p.payment ?? 'ΚΑΡΤΑ ONLINE')}</td></tr>
      ${p.mark ? `<tr><td style="padding:4px 12px 4px 0;color:#666">ΜΑΡΚ</td><td style="padding:4px 0;font-family:monospace">${esc(p.mark)}</td></tr>` : ''}
    </table>
    ${p.link ? `<p><a href="${esc(p.link)}" style="display:inline-block;background:#1f2937;color:#fff;text-decoration:none;padding:12px 20px;border-radius:8px">Προβολή / Λήψη απόδειξης (PDF)</a></p>
    <p style="color:#888;font-size:12px;word-break:break-all">${esc(p.link)}</p>` : ''}
  </div>`;
}
