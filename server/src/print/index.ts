/**
 * Print dispatcher. Παράγει output ανά τύπο εκτυπωτή και (placeholder) το στέλνει.
 * Η πραγματική αποστολή σε hardware (USB/network/system spooler) εξαρτάται από
 * το περιβάλλον του πελάτη και υλοποιείται όταν οριστούν οι εκτυπωτές.
 */
import { renderEscpos } from './escpos.js';
import { renderZpl } from './zpl.js';
import { fillTemplate, type TicketContext } from './template.js';
import { stripMarkup } from './markup.js';

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
