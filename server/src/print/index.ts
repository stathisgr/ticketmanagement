/**
 * Print dispatcher. Παράγει output ανά τύπο εκτυπωτή και (placeholder) το στέλνει.
 * Η πραγματική αποστολή σε hardware (USB/network/system spooler) εξαρτάται από
 * το περιβάλλον του πελάτη και υλοποιείται όταν οριστούν οι εκτυπωτές.
 */
import QRCode from 'qrcode';
import { renderEscpos, renderRetailEscpos, vatBreakdown } from './escpos.js';
import { renderZpl } from './zpl.js';
import { fillTemplate, fillRetail, type TicketContext, type RetailReceipt, DEFAULT_RETAIL_HEADER, DEFAULT_RETAIL_FOOTER } from './template.js';
import { stripMarkup, hasQrTag } from './markup.js';

/**
 * Παράγει QR ως data-URI (PNG) για εκτύπωση από browser (όταν δεν βρεθεί δικτυακός εκτυπωτής).
 * Στους θερμικούς το QR το ζωγραφίζει ο ίδιος ο εκτυπωτής (ESC/POS)· εδώ φτιάχνουμε εικόνα για τον browser.
 */
export async function qrDataUri(text?: string): Promise<string | undefined> {
  if (!text) return undefined;
  try { return await QRCode.toDataURL(text, { margin: 1, width: 240, errorCorrectionLevel: 'M' }); }
  catch { return undefined; }
}

/**
 * Προσθέτει στο RenderResult τις εικόνες QR (qrImg = [QR] εισιτηρίου, qrMarkImg = [QR ΜΑΡΚ] myDATA),
 * ΜΟΝΟ όταν η προεπισκόπηση περιέχει το αντίστοιχο marker και υπάρχει payload. Η κειμενική προεπισκόπηση
 * (στην οθόνη) παραμένει ως έχει — οι εικόνες χρησιμοποιούνται μόνο κατά την εκτύπωση από browser.
 */
export async function attachQrImages<T extends { preview: string }>(
  r: T, opts: { qr?: string; qrMark?: string }
): Promise<T & { qrImg?: string; qrMarkImg?: string }> {
  const out = r as T & { qrImg?: string; qrMarkImg?: string };
  if (/\[QR\]/.test(r.preview) && opts.qr) out.qrImg = await qrDataUri(opts.qr);
  if (/\[QR ΜΑΡΚ\]/.test(r.preview) && opts.qrMark) out.qrMarkImg = await qrDataUri(opts.qrMark);
  return out;
}

export interface RetailForm { header?: string; footer?: string; showVat?: boolean }

export type PrinterType = 'escpos58' | 'escpos80' | 'zpl';

export interface RenderResult {
  printerType: PrinterType;
  /** human-readable preview για το UI */
  preview: string;
  /** raw payload: ESC/POS bytes (base64) ή ZPL κείμενο */
  payloadBase64?: string;
  zpl?: string;
  /** QR ως data-URI για browser print (συμπληρώνεται από attachQrImages). */
  qrImg?: string;
  qrMarkImg?: string;
}

export interface TicketTemplate {
  header?: string;
  details?: string;
  footer?: string;
  withQr?: boolean;
  codePage?: string;
  escposPageId?: number;
  sizes?: { header?: number; details?: number; footer?: number };
}

export function renderTicket(ctx: TicketContext, printerType: PrinterType, tpl: TicketTemplate = {}): RenderResult {
  if (printerType === 'zpl') {
    const zpl = renderZpl(ctx, tpl);
    return { printerType, preview: buildPreview(ctx, tpl), zpl };
  }
  const bytes = renderEscpos(ctx, tpl);
  return { printerType, preview: buildPreview(ctx, tpl), payloadBase64: bytes.toString('base64') };
}

/** Απόδειξη λιανικής (προϊόντα): μία τυποποιημένη απόδειξη με όλα τα είδη + ανάλυση ΦΠΑ. */
export function renderRetail(rc: RetailReceipt, printerType: PrinterType, form: RetailForm = {}): RenderResult {
  const cols = printerType === 'escpos58' ? 32 : 48;
  const bytes = renderRetailEscpos(rc, cols, form);
  // ZPL ετικετογράφος δεν είναι για αποδείξεις — παράγουμε πάντα ESC/POS payload.
  return { printerType: printerType === 'zpl' ? 'escpos80' : printerType, preview: retailPreview(rc, cols, form), payloadBase64: bytes.toString('base64') };
}

/** Κειμενική προεπισκόπηση απόδειξης λιανικής (για browser print / POS). */
function retailPreview(rc: RetailReceipt, cols = 48, form: RetailForm = {}): string {
  const line = '-'.repeat(cols);
  const eur = (n: number) => (Number(n) || 0).toFixed(2);
  const row = (l: string, r: string) => {
    const left = (l.length + r.length + 1 > cols) ? l.slice(0, Math.max(0, cols - r.length - 1)) : l;
    return left + ' '.repeat(Math.max(1, cols - left.length - r.length)) + r;
  };
  const out: string[] = [];
  for (const ln of fillRetail(form.header || DEFAULT_RETAIL_HEADER, rc).split('\n')) if (ln.trim()) out.push(ln);
  out.push(line, rc.docType || 'ΑΠΟΔΕΙΞΗ ΛΙΑΝΙΚΗΣ ΠΩΛΗΣΗΣ');
  out.push(row(`${rc.series || ''} Νο ${rc.aa || ''}`.trim(), rc.datetime || ''));
  out.push(`Πελάτης: ${rc.customerName || 'ΠΕΛΑΤΗΣ ΛΙΑΝΙΚΗΣ'}${rc.customerVat ? ` (ΑΦΜ ${rc.customerVat})` : ''}`);
  out.push(line);
  for (const it of rc.items) {
    out.push(it.name);
    out.push(row(`  ${it.qty} x ${eur(it.unitPrice)}`, `${eur(it.lineTotal)} (${it.vatRate}%)`));
  }
  out.push(line);
  if (form.showVat !== false) {
    out.push('Ανάλυση ΦΠΑ:');
    for (const v of vatBreakdown(rc.items)) out.push(row(` ${v.rate}%  Καθ. ${eur(v.net)}`, `ΦΠΑ ${eur(v.vat)}`));
    out.push(line);
  }
  out.push(row('ΣΥΝΟΛΟ:', `${eur(rc.total)} EUR`));
  if (rc.paymentMethod) out.push(`Πληρωμή: ${rc.paymentMethod}`);
  if (rc.mark) out.push(`ΜΑΡΚ: ${rc.mark}`);
  if (rc.markQr) out.push('[QR ΜΑΡΚ]');
  if (rc.legalNote) out.push(rc.legalNote);
  for (const ln of fillRetail(form.footer ?? DEFAULT_RETAIL_FOOTER, rc).split('\n')) if (ln.trim()) out.push(ln);
  return out.join('\n');
}

/** Preview κειμένου για εμφάνιση στο POS. Αν υπάρχει template, το χρησιμοποιεί. */
function buildPreview(ctx: TicketContext, tpl: TicketTemplate = {}): string {
  // Προεπιλεγμένο QR εισιτηρίου (check-in): μπαίνει ΜΟΝΟ όταν θα το τύπωνε και ο θερμικός
  // (δηλ. δεν υπάρχει ρητό [qr] στη φόρμα, withQr ≠ false και υπάρχει serial) — ίδια λογική με το ESC/POS.
  if (tpl.header || tpl.details || tpl.footer) {
    const explicitQr = hasQrTag(tpl.header, tpl.details, tpl.footer);
    const autoQr = !explicitQr && tpl.withQr !== false && !!ctx.serial;
    const legalPlaced = /\{\{\s*legalNote\s*\}\}/.test(`${tpl.header ?? ''}\n${tpl.details ?? ''}\n${tpl.footer ?? ''}`);
    return [
      stripMarkup(fillTemplate(tpl.header ?? '', ctx)),
      '--------------------------------',
      stripMarkup(fillTemplate(tpl.details ?? '', ctx)),
      ctx.seat ? `Θέση: ${ctx.seat}` : '',
      '--------------------------------',
      autoQr ? '[QR]' : '',
      stripMarkup(fillTemplate(tpl.footer ?? '', ctx)),
      !legalPlaced && ctx.legalNote ? ctx.legalNote : '',
    ].filter(Boolean).join('\n');
  }
  const autoQr = tpl.withQr !== false && !!ctx.serial;
  return [
    ctx.venueName,
    ctx.vatNumber ? `ΑΦΜ: ${ctx.vatNumber}` : '',
    ctx.address ?? '',
    ctx.cityLine ?? '',
    '--------------------------------',
    ctx.title,
    ctx.subtitle ?? '',
    `${ctx.qty} x ${ctx.unitPrice.toFixed(2)} = ${ctx.lineTotal.toFixed(2)} €`,
    `ΦΠΑ ${ctx.vatRate}%  |  ${ctx.paymentMethod}`,
    ctx.seat ? `Θέση: ${ctx.seat}` : '',
    '--------------------------------',
    autoQr ? '[QR]' : '',
    `No: ${ctx.serial}`,
    ctx.datetime,
  ]
    .filter(Boolean)
    .join('\n');
}
