/**
 * Zebra ZPL renderer. Παράγει ένα ZPL string (^XA ... ^XZ) με QR code.
 * Στέλνεται αυτούσιο στον Zebra εκτυπωτή.
 */
import { fillTemplate, type TicketContext, DEFAULT_HEADER, DEFAULT_DETAILS, DEFAULT_FOOTER } from './template.js';

export interface ZplTemplate {
  header?: string;
  details?: string;
  footer?: string;
  withQr?: boolean;
}

function escapeZpl(s: string): string {
  return (s ?? '').replace(/[\^~]/g, ' ');
}

export function renderZpl(ctx: TicketContext, tpl: ZplTemplate = {}): string {
  const x = 20;
  const lineH = 30;
  let y = 20;
  const out: string[] = ['^XA', '^CI28']; // CI28 = UTF-8

  const writeBlock = (text: string) => {
    for (const l of text.split('\n')) {
      out.push(`^FO${x},${y}^A0N,26,26^FD${escapeZpl(l)}^FS`);
      y += lineH;
    }
  };

  writeBlock(fillTemplate(tpl.header ?? DEFAULT_HEADER, ctx));
  y += 8;
  writeBlock(fillTemplate(tpl.details ?? DEFAULT_DETAILS, ctx));
  y += 8;

  if (tpl.withQr !== false && ctx.serial) {
    out.push(`^FO${x},${y}^BQN,2,6^FDLA,${escapeZpl(ctx.qrPayload ?? ctx.serial)}^FS`);
    y += 180;
  }

  writeBlock(fillTemplate(tpl.footer ?? DEFAULT_FOOTER, ctx));
  out.push('^XZ');
  return out.join('\n');
}
