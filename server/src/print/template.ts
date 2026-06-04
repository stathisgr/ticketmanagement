/**
 * Παραμετρική φόρμα εισιτηρίου.
 * Αντικαθιστά placeholders {{field}} σε Header/Details/Footer με τιμές.
 * Χρησιμοποιείται και από ESC/POS και από ZPL renderers.
 */
export interface TicketContext {
  venueName: string;
  vatNumber?: string;
  address?: string;
  cityLine?: string;
  phone?: string;
  email?: string;
  title: string;
  subtitle?: string;
  qty: number;
  unitPrice: number;
  lineTotal: number;
  vatRate: number;
  serial: string;
  datetime: string;
  paymentMethod: string;
  seat?: string;     // Φάση 2
  show?: string;     // Φάση 2
  qrPayload?: string; // περιεχόμενο QR (default: serial)
  legalNote?: string; // π.χ. «Δεν αποτελεί φορολογικό παραστατικό» όταν την απόδειξη κόβει η ταμειακή
  mark?: string;      // ΜΑΡΚ παρόχου (myDATA) — όταν το εισιτήριο είναι το φορολογικό παραστατικό
  markQr?: string;    // QR myDATA (AADE URL) — για [qrmark]
  // Στοιχεία απόδειξης (όταν θέλουμε εισιτήριο + απόδειξη μαζί, σε λειτουργία παρόχου):
  customerName?: string; // Επωνυμία/Όνομα πελάτη (κενό = λιανικής)
  customerVat?: string;  // ΑΦΜ πελάτη
  docType?: string;      // Τύπος παραστατικού, π.χ. «ΑΠΟΔΕΙΞΗ ΠΑΡΟΧΗΣ ΥΠΗΡΕΣΙΩΝ»
  series?: string;       // Σειρά παραστατικού (π.χ. ΑΠΥ)
  aa?: string;           // Αύξων αριθμός παραστατικού
  total?: number;        // Συνολικό ποσό της πώλησης (όλες οι γραμμές)
}

/** Υπολογισμός καθαρής αξίας & ΦΠΑ από τιμή ΜΕ ΦΠΑ (VAT-inclusive). */
export function computeVat(gross: number, vatRate: number): { net: number; vat: number } {
  const g = gross || 0;
  const net = vatRate ? g / (1 + vatRate / 100) : g;
  return { net, vat: g - net };
}

export function fillTemplate(tpl: string, ctx: TicketContext): string {
  const map: Record<string, string> = {
    venueName: ctx.venueName ?? '',
    vatNumber: ctx.vatNumber ?? '',
    address: ctx.address ?? '',
    cityLine: ctx.cityLine ?? '',
    phone: ctx.phone ?? '',
    email: ctx.email ?? '',
    title: ctx.title ?? '',
    subtitle: ctx.subtitle ?? '',
    qty: String(ctx.qty),
    unitPrice: ctx.unitPrice.toFixed(2),
    lineTotal: ctx.lineTotal.toFixed(2),
    vatRate: String(ctx.vatRate),
    vatAmount: computeVat(ctx.lineTotal, ctx.vatRate).vat.toFixed(2),
    netValue: computeVat(ctx.lineTotal, ctx.vatRate).net.toFixed(2),
    serial: ctx.serial,
    datetime: ctx.datetime,
    paymentMethod: ctx.paymentMethod,
    seat: ctx.seat ?? '',
    show: ctx.show ?? '',
    legalNote: ctx.legalNote ?? '',
    mark: ctx.mark ?? '',
    customerName: ctx.customerName ?? '',
    customerVat: ctx.customerVat ?? '',
    docType: ctx.docType ?? '',
    series: ctx.series ?? '',
    aa: ctx.aa ?? '',
    total: ctx.total != null ? ctx.total.toFixed(2) : ctx.lineTotal.toFixed(2),
  };
  return (tpl ?? '').replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k) => map[k] ?? '');
}

/** Προεπιλεγμένη φόρμα (ESC/POS) όταν δεν έχει οριστεί template. */
export const DEFAULT_HEADER = '{{venueName}}\nΑΦΜ: {{vatNumber}}\n{{address}}\n{{cityLine}}\nΤΗΛ: {{phone}}';
export const DEFAULT_DETAILS = '{{title}}\n{{subtitle}}\n{{qty}} x {{unitPrice}} = {{lineTotal}} EUR\nΦΠΑ {{vatRate}}%  |  {{paymentMethod}}';
export const DEFAULT_FOOTER = 'No: {{serial}}\n{{datetime}}\n{{legalNote}}\nΕυχαριστούμε!';
