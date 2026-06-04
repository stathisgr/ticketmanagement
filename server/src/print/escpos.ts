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
import { fillTemplate, type TicketContext, DEFAULT_HEADER, DEFAULT_DETAILS, DEFAULT_FOOTER } from './template.js';
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
