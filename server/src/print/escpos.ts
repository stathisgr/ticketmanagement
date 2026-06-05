/**
 * ESC/POS renderer (58mm / 80mm θερμικοί). Παράγει Buffer εντολών ESC/POS.
 *
 * ΕΛΛΗΝΙΚΑ: οι θερμικοί δεν δέχονται UTF-8 — απαιτείται code page. Κωδικοποιούμε
 * το κείμενο στο επιλεγμένο code page (iconv-lite) και στέλνουμε `ESC t <pageId>`.
 *   - CP737  (Ελληνικά DOS)        → συχνά pageId 14
 *   - Windows-1253 (Ελληνικά Win)  → συχνά pageId 47/255 (εξαρτάται από τον εκτυπωτή)
 * Ο pageId είναι ρυθμιζόμενος γιατί διαφέρει ανά μοντέλο.
 *
 * ΜΕΓΕΘΟΣ: GS ! n ανά τμήμα (Header/Details/Footer), κλίμακα 1–4 (πλάτος×ύψος).
 */
import iconv from 'iconv-lite';
import { fillTemplate, fillRetail, type TicketContext, type RetailReceipt, DEFAULT_HEADER, DEFAULT_DETAILS, DEFAULT_FOOTER, DEFAULT_RETAIL_HEADER, DEFAULT_RETAIL_FOOTER } from './template.js';
import { parseLine, hasQrTag } from './markup.js';

const ESC = 0x1b;
const GS = 0x1d;

export interface EscposTemplate {
  header?: string;
  details?: string;
  footer?: string;
  withQr?: boolean;
  /** iconv encoding (π.χ. 'cp737', 'windows-1253', 'cp437'). Default 'cp737'. */
  codePage?: string;
  /** Όρισμα ESC t για επιλογή code page στον εκτυπωτή. Default 14 (CP737). */
  escposPageId?: number;
  /** Κλίμακα μεγέθους ανά τμήμα (1–4). */
  sizes?: { header?: number; details?: number; footer?: number };
}

function sizeByte(scale = 1): number {
  const s = Math.max(1, Math.min(4, Math.floor(scale))) - 1; // 0..3
  return (s << 4) | s; // width<<4 | height
}

class Builder {
  private chunks: Buffer[] = [];
  constructor(private codePage: string) {}
  raw(...bytes: number[]) { this.chunks.push(Buffer.from(bytes)); return this; }
  /** Κείμενο κωδικοποιημένο στο code page (όχι UTF-8). */
  text(s: string) {
    let enc: Buffer;
    try { enc = iconv.encode(s, this.codePage); }
    catch { enc = Buffer.from(s, 'latin1'); }
    this.chunks.push(enc, Buffer.from([0x0a]));
    return this;
  }
  init() { return this.raw(ESC, 0x40); }                 // ESC @
  selectCodePage(id: number) { return this.raw(ESC, 0x74, id & 0xff); } // ESC t n
  align(a: 'left' | 'center' | 'right') { return this.raw(ESC, 0x61, a === 'center' ? 1 : a === 'right' ? 2 : 0); }
  bold(on: boolean) { return this.raw(ESC, 0x45, on ? 1 : 0); }
  size(scale: number) { return this.raw(GS, 0x21, sizeByte(scale)); }
  feed(n = 3) { return this.raw(ESC, 0x64, n); }
  cut() { return this.raw(GS, 0x56, 0x42, 0x00); }
  qr(data: string, size = 6) {
    const bytes = Buffer.from(data, 'ascii');
    const len = bytes.length + 3;
    this.raw(GS, 0x28, 0x6b, 0x04, 0x00, 0x31, 0x41, 0x32, 0x00);
    this.raw(GS, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x43, size);
    this.raw(GS, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x45, 0x30);
    this.raw(GS, 0x28, 0x6b, len & 0xff, (len >> 8) & 0xff, 0x31, 0x50, 0x30);
    this.chunks.push(bytes);
    this.raw(GS, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x51, 0x30);
    return this;
  }
  build() { return Buffer.concat(this.chunks); }
}

export function renderEscpos(ctx: TicketContext, tpl: EscposTemplate = {}): Buffer {
  const codePage = tpl.codePage && iconv.encodingExists(tpl.codePage) ? tpl.codePage : 'cp737';
  const pageId = tpl.escposPageId ?? 14;
  const sz = tpl.sizes ?? {};
  const b = new Builder(codePage);
  const headerTpl = tpl.header ?? DEFAULT_HEADER;
  const detailsTpl = tpl.details ?? DEFAULT_DETAILS;
  const footerTpl = tpl.footer ?? DEFAULT_FOOTER;
  const explicitQr = hasQrTag(headerTpl, detailsTpl, footerTpl); // αν ο χρήστης τοποθέτησε [qr]

  b.init();
  b.selectCodePage(pageId);

  // Αποδίδει ένα τμήμα με inline tags ανά γραμμή· defaultSize = μέγεθος τμήματος.
  const renderSection = (raw: string, defaultSize: number, defaultBold: boolean) => {
    for (const line of fillTemplate(raw, ctx).split('\n')) {
      const p = parseLine(line);
      if (p.qrMark) {
        if (ctx.markQr) { b.align('center').qr(ctx.markQr); }
        continue;
      }
      if (p.qr) {
        if (tpl.withQr !== false && ctx.serial) { b.align('center').qr(ctx.qrPayload ?? ctx.serial); }
        continue;
      }
      b.align(p.align ?? 'center');
      b.size(p.size ?? defaultSize);
      b.bold(p.bold ?? defaultBold);
      b.text(p.text);
    }
    b.bold(false).size(1).align('center');
  };

  renderSection(headerTpl, sz.header ?? 1, true);
  b.text('--------------------------------');
  renderSection(detailsTpl, sz.details ?? 1, true);
  b.text('--------------------------------');

  // Προεπιλεγμένη θέση QR (αν δεν τοποθετήθηκε ρητά με [qr])
  if (!explicitQr && tpl.withQr !== false && ctx.serial) {
    b.align('center').qr(ctx.qrPayload ?? ctx.serial);
  }

  renderSection(footerTpl, sz.footer ?? 1, false);

  // Auto-append της ένδειξης «μη φορολογικού» αν δεν τοποθετήθηκε ρητά με {{legalNote}}.
  const legalPlaced = /\{\{\s*legalNote\s*\}\}/.test(`${headerTpl}\n${detailsTpl}\n${footerTpl}`);
  if (!legalPlaced && ctx.legalNote) { b.align('center').size(1).bold(false).text(ctx.legalNote); }

  b.size(1).feed(3).cut();
  return b.build();
}

/** Ανάλυση ΦΠΑ ανά συντελεστή από τα είδη. */
export function vatBreakdown(items: { lineTotal: number; vatRate: number }[]): { rate: number; net: number; vat: number; gross: number }[] {
  const m = new Map<number, { net: number; vat: number; gross: number }>();
  for (const it of items) {
    const vr = Number(it.vatRate) || 0;
    const gross = Number(it.lineTotal) || 0;
    const net = vr ? gross / (1 + vr / 100) : gross;
    const e = m.get(vr) ?? { net: 0, vat: 0, gross: 0 };
    e.net += net; e.vat += gross - net; e.gross += gross; m.set(vr, e);
  }
  return [...m.entries()].sort((a, b) => a[0] - b[0]).map(([rate, e]) => ({
    rate, net: +e.net.toFixed(2), vat: +e.vat.toFixed(2), gross: +e.gross.toFixed(2),
  }));
}

/**
 * Τυποποιημένη ΑΠΟΔΕΙΞΗ ΛΙΑΝΙΚΗΣ (προϊόντα): ΟΛΑ τα είδη σε μία απόδειξη + ανάλυση ΦΠΑ ανά συντελεστή.
 * cols: 32 (58mm) ή 48 (80mm).
 */
export function renderRetailEscpos(rc: RetailReceipt, cols = 48, form: { header?: string; footer?: string; showVat?: boolean } = {}): Buffer {
  const codePage = rc.codePage && iconv.encodingExists(rc.codePage) ? rc.codePage : 'cp737';
  const pageId = rc.escposPageId ?? 14;
  const b = new Builder(codePage);
  const line = '-'.repeat(cols);
  const row = (l: string, r: string) => {
    const left = (l.length + r.length + 1 > cols) ? l.slice(0, Math.max(0, cols - r.length - 1)) : l;
    return left + ' '.repeat(Math.max(1, cols - left.length - r.length)) + r;
  };
  const eur = (n: number) => (Number(n) || 0).toFixed(2);

  b.init();
  b.selectCodePage(pageId);
  // Header (επεξεργάσιμη φόρμα — στοιχεία επιχείρησης). Κενές γραμμές παραλείπονται.
  b.align('center').bold(true);
  let firstHeaderLine = true;
  for (const ln of fillRetail(form.header || DEFAULT_RETAIL_HEADER, rc).split('\n')) {
    if (!ln.trim()) continue;
    b.bold(firstHeaderLine); b.text(ln); firstHeaderLine = false;
  }
  b.bold(false);
  b.text(line);
  b.bold(true).text(rc.docType || 'ΑΠΟΔΕΙΞΗ ΛΙΑΝΙΚΗΣ ΠΩΛΗΣΗΣ');
  b.bold(false).align('left');
  b.text(row(`${rc.series || ''} Νο ${rc.aa || ''}`.trim(), rc.datetime || ''));
  b.text(`Πελατης: ${rc.customerName || 'ΠΕΛΑΤΗΣ ΛΙΑΝΙΚΗΣ'}${rc.customerVat ? ` (ΑΦΜ ${rc.customerVat})` : ''}`);
  b.text(line);
  for (const it of rc.items) {
    b.text(it.name);
    b.text(row(`  ${it.qty} x ${eur(it.unitPrice)}`, `${eur(it.lineTotal)} (${it.vatRate}%)`));
  }
  b.text(line);
  if (form.showVat !== false) {
    b.text('Αναλυση ΦΠΑ:');
    for (const v of vatBreakdown(rc.items)) {
      b.text(row(` ${v.rate}%  Καθ. ${eur(v.net)}`, `ΦΠΑ ${eur(v.vat)}`));
    }
    b.text(line);
  }
  b.bold(true).align('right').text(`ΣΥΝΟΛΟ: ${eur(rc.total)} EUR`);
  b.bold(false).align('left');
  if (rc.paymentMethod) b.text(`Πληρωμη: ${rc.paymentMethod}`);
  if (rc.mark) {
    b.align('center').text(`ΜΑΡΚ: ${rc.mark}`);
    if (rc.markQr) b.qr(rc.markQr);
  }
  if (rc.legalNote) b.align('center').text(rc.legalNote);
  // Footer (επεξεργάσιμη φόρμα). Κενές γραμμές παραλείπονται.
  b.align('center');
  for (const ln of fillRetail(form.footer ?? DEFAULT_RETAIL_FOOTER, rc).split('\n')) {
    if (ln.trim()) b.text(ln);
  }
  b.size(1).feed(3).cut();
  return b.build();
}
