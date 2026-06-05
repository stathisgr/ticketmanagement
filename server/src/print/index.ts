/**
 * Print dispatcher. Παράγει output ανά τύπο εκτυπωτή και (placeholder) το στέλνει.
 * Η πραγματική αποστολή σε hardware (USB/network/system spooler) εξαρτάται από
 * το περιβάλλον του πελάτη και υλοποιείται όταν οριστούν οι εκτυπωτές.
 */
import { renderEscpos, renderRetailEscpos, vatBreakdown } from './escpos.js';
import { renderZpl } from './zpl.js';
import { fillTemplate, fillRetail, type TicketContext, type RetailReceipt, DEFAULT_RETAIL_HEADER, DEFAULT_RETAIL_FOOTER } from './template.js';
import { stripMarkup } from './markup.js';

export interface RetailForm { header?: string; footer?: string; showVat?: boolean }

export type PrinterType = 'escpos58' | 'escpos80' | 'zpl';

export interface RenderResult {
  printerType: PrinterType;
  /** human-readable preview για το UI */
  preview: string;
  /** raw payload: ESC/POS bytes (base64) ή ZPL κείμενο */
  payloadBase64?: string;
  zpl?: string;
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
  if (rc.legalNote) out.push(rc.legalNote);
  for (const ln of fillRetail(form.footer ?? DEFAULT_RETAIL_FOOTER, rc).split('\n')) if (ln.trim()) out.push(ln);
  return out.join('\n');
}

/** Preview κειμένου για εμφάνιση στο POS. Αν υπάρχει template, το χρησιμοποιεί. */
function buildPreview(ctx: TicketContext, tpl: TicketTemplate = {}): string {
  if (tpl.header || tpl.details || tpl.footer) {
    const legalPlaced = /\{\{\s*legalNote\s*\}\}/.test(`${tpl.header ?? ''}\n${tpl.details ?? ''}\n${tpl.footer ?? ''}`);
    return [
      stripMarkup(fillTemplate(tpl.header ?? '', ctx)),
      '--------------------------------',
      stripMarkup(fillTemplate(tpl.details ?? '', ctx)),
      ctx.seat ? `Θέση: ${ctx.seat}` : '',
      '--------------------------------',
      stripMarkup(fillTemplate(tpl.footer ?? '', ctx)),
      !legalPlaced && ctx.legalNote ? ctx.legalNote : '',
    ].filter(Boolean).join('\n');
  }
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
    `No: ${ctx.serial}`,
    ctx.datetime,
  ]
    .filter(Boolean)
    .join('\n');
}
