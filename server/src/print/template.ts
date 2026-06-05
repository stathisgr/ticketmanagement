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
  showDate?: string; // ημ/νία θεάματος (DD/MM/YYYY)
  showTime?: string; // ώρα θεάματος (π.χ. 21:00)
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

/** Στοιχεία απόδειξης λιανικής (προϊόντα) — τυποποιημένη φόρμα, όλα τα είδη μαζί. */
export interface RetailItem { name: string; qty: number; unitPrice: number; lineTotal: number; vatRate: number; }
export interface RetailReceipt {
  venueName: string; vatNumber?: string; address?: string; cityLine?: string; phone?: string; taxOffice?: string;
  docType?: string; series?: string; aa?: string; datetime?: string;
  customerName?: string; customerVat?: string;
  items: RetailItem[];
  total: number; paymentMethod?: string;
  mark?: string; markQr?: string; legalNote?: string;
  codePage?: string; escposPageId?: number;
}

/** Προεπιλεγμένα header/footer απόδειξης λιανικής (επεξεργάσιμα). Τα είδη + ΦΠΑ + σύνολα είναι αυτόματα. */
export const DEFAULT_RETAIL_HEADER = '{{venueName}}\n{{address}}\n{{cityLine}}\nΑΦΜ: {{vatNumber}}  {{taxOffice}}\nΤΗΛ: {{phone}}';
export const DEFAULT_RETAIL_FOOTER = 'Ευχαριστούμε!';

/** Αντικατάσταση placeholders {{...}} για την απόδειξη λιανικής (header/footer). */
export function fillRetail(tpl: string, rc: RetailReceipt): string {
  const eur = (n?: number) => (Number(n) || 0).toFixed(2);
  const map: Record<string, string> = {
    venueName: rc.venueName ?? '', vatNumber: rc.vatNumber ?? '', taxOffice: rc.taxOffice ?? '',
    address: rc.address ?? '', cityLine: rc.cityLine ?? '', phone: rc.phone ?? '',
    docType: rc.docType ?? '', series: rc.series ?? '', aa: rc.aa ?? '', datetime: rc.datetime ?? '',
    customerName: rc.customerName ?? '', customerVat: rc.customerVat ?? '',
    total: eur(rc.total), paymentMethod: rc.paymentMethod ?? '', mark: rc.mark ?? '',
  };
  return (tpl ?? '').replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k) => map[k] ?? '');
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
    showDate: ctx.showDate ?? '',
    showTime: ctx.showTime ?? '',
    showDateTime: [ctx.showDate, ctx.showTime].filter(Boolean).join(' '),
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
