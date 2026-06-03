/**
 * Εκτύπωση εισιτηρίου από τον browser (μέσω του Windows driver του εκτυπωτή).
 * Αξιόπιστο για USB θερμικούς — τα ελληνικά αποδίδονται από τον browser (χωρίς code page).
 * Για POS ταχύτητα, ρύθμισε τον Chrome σε "Kiosk printing" ώστε να μη βγαίνει διάλογος.
 */
export function printTickets(previews: string[]) {
  if (!previews?.length) return;
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const blocks = previews
    .map((p) => `<pre class="t">${esc(p)}</pre>`)
    .join('<div class="cut"></div>');

  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Ticket</title>
  <style>
    @page { size: 80mm auto; margin: 2mm; }
    * { -webkit-print-color-adjust: exact; }
    body { margin: 0; }
    .t { font-family: 'Consolas','Courier New',monospace; font-size: 12px; line-height: 1.25;
         white-space: pre-wrap; width: 76mm; margin: 0 0 2mm; text-align: center; }
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
  if (iframe.contentWindow?.document.readyState === 'complete') setTimeout(done, 100);
  else iframe.onload = () => setTimeout(done, 100);
}
