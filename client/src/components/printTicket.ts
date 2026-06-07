/**
 * Εκτύπωση εισιτηρίου/απόδειξης από τον browser (μέσω του Windows driver του εκτυπωτή).
 * Αξιόπιστο για USB θερμικούς — τα ελληνικά αποδίδονται από τον browser (χωρίς code page).
 * Για POS ταχύτητα, ρύθμισε τον Chrome σε "Kiosk printing" ώστε να μη βγαίνει διάλογος.
 *
 * Το QR: στους θερμικούς το ζωγραφίζει ο ίδιος ο εκτυπωτής (ESC/POS). Στην εκτύπωση από browser
 * ο server στέλνει το QR ως εικόνα (data-URI) και εδώ αντικαθιστούμε τα markers [QR]/[QR ΜΑΡΚ]
 * της κειμενικής προεπισκόπησης με την πραγματική εικόνα QR.
 */
export interface TicketPrint {
  preview?: string;
  text?: string;
  qrImg?: string;     // QR εισιτηρίου (check-in) — αντικαθιστά το [QR]
  qrMarkImg?: string; // QR myDATA (ΑΑΔΕ) — αντικαθιστά το [QR ΜΑΡΚ]
}

export function printTickets(items: Array<string | TicketPrint>) {
  if (!items?.length) return;
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const tickets = items.map((it) =>
    typeof it === 'string' ? { text: it } as TicketPrint : { text: it.preview ?? it.text ?? '', qrImg: it.qrImg, qrMarkImg: it.qrMarkImg }
  );

  const renderBlock = (t: TicketPrint): string => {
    const parts: string[] = [];
    let buf: string[] = [];
    const flush = () => { if (buf.length) { parts.push(`<pre class="t">${esc(buf.join('\n'))}</pre>`); buf = []; } };
    for (const line of (t.text ?? '').split('\n')) {
      const tr = line.trim();
      if (tr === '[QR]' && t.qrImg) { flush(); parts.push(`<img class="qr" src="${t.qrImg}" alt="QR" />`); }
      else if (tr === '[QR ΜΑΡΚ]' && t.qrMarkImg) { flush(); parts.push(`<img class="qr" src="${t.qrMarkImg}" alt="QR" />`); }
      else buf.push(line);
    }
    flush();
    return `<div class="ticket">${parts.join('')}</div>`;
  };
  const blocks = tickets.map(renderBlock).join('<div class="cut"></div>');

  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Ticket</title>
  <style>
    @page { size: 80mm auto; margin: 2mm; }
    * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    body { margin: 0; }
    .ticket { width: 76mm; margin: 0 0 2mm; text-align: center; }
    .t { font-family: 'Consolas','Courier New',monospace; font-size: 12px; line-height: 1.25;
         white-space: pre-wrap; margin: 0; text-align: center; }
    .qr { display: block; width: 36mm; height: 36mm; margin: 2mm auto; image-rendering: pixelated; }
    .cut { page-break-after: always; }
  </style></head><body>${blocks}</body></html>`;

  const iframe = document.createElement('iframe');
  iframe.style.position = 'fixed';
  iframe.style.right = '0';
  iframe.style.bottom = '0';
  iframe.style.width = '0';
  iframe.style.height = '0';
  iframe.style.border = '0';
  document.body.appendChild(iframe);
  const doc = iframe.contentWindow?.document;
  if (!doc) { document.body.removeChild(iframe); return; }
  doc.open(); doc.write(html); doc.close();
  const done = () => { try { iframe.contentWindow?.focus(); iframe.contentWindow?.print(); } finally { setTimeout(() => iframe.remove(), 1000); } };
  if (iframe.contentWindow?.document.readyState === 'complete') setTimeout(done, 150);
  else iframe.onload = () => setTimeout(done, 150);
}
