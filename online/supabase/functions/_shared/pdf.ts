// Παραγωγή PDF εισιτηρίου με ελληνικά (ενσωματωμένη Unicode γραμματοσειρά) + QR.
import { PDFDocument, rgb } from "npm:pdf-lib@1.17.1";
import fontkit from "npm:@pdf-lib/fontkit@1.1.1";
import QRCode from "npm:qrcode@1.5.3";

// Σταθερό TTF με ελληνικά+λατινικά (Noto Sans). Cache ανά cold start.
const FONT_URLS = [
  "https://cdn.jsdelivr.net/gh/googlefonts/noto-fonts/hinted/ttf/NotoSans/NotoSans-Regular.ttf",
  "https://cdn.jsdelivr.net/gh/googlefonts/noto-fonts/hinted/ttf/NotoSans/NotoSans-Bold.ttf",
];
let _font: Uint8Array | null = null;
let _fontBold: Uint8Array | null = null;
async function fonts(): Promise<[Uint8Array, Uint8Array]> {
  if (!_font) _font = new Uint8Array(await (await fetch(FONT_URLS[0])).arrayBuffer());
  if (!_fontBold) _fontBold = new Uint8Array(await (await fetch(FONT_URLS[1])).arrayBuffer());
  return [_font, _fontBold];
}

function hexRgb(hex: string) {
  const h = hex.replace("#", "");
  const n = parseInt(h.length === 3 ? h.split("").map((c) => c + c).join("") : h, 16);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

export interface PdfTicket {
  venueName: string; showTitle: string; showSubtitle: string;
  date: string; time: string; seat: string; ticketType: string;
  holder: string; price: string; serial: string; brandColor: string; legal: string;
  qrData: string;
}

// Ένα PDF, μία σελίδα ανά εισιτήριο.
export async function buildTicketsPdf(tickets: PdfTicket[]): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const [reg, bold] = await fonts();
  const font = await doc.embedFont(reg, { subset: true });
  const fontB = await doc.embedFont(bold, { subset: true });

  for (const t of tickets) {
    const W = 320, H = 560;
    const page = doc.addPage([W, H]);
    const brand = hexRgb(t.brandColor || "#7c2d12");
    // Header band
    page.drawRectangle({ x: 0, y: H - 110, width: W, height: 110, color: brand });
    page.drawText(t.venueName.toUpperCase(), { x: 22, y: H - 38, size: 9, font, color: rgb(1, 1, 1) });
    page.drawText(t.showTitle, { x: 22, y: H - 66, size: 20, font: fontB, color: rgb(1, 1, 1) });
    page.drawText(t.showSubtitle, { x: 22, y: H - 88, size: 10, font, color: rgb(1, 1, 1) });

    const ink = rgb(0.12, 0.16, 0.22), muted = rgb(0.42, 0.45, 0.5);
    const row = (label: string, val: string, y: number) => {
      page.drawText(label, { x: 22, y, size: 8, font, color: muted });
      page.drawText(val, { x: 22, y: y - 16, size: 13, font: fontB, color: ink });
    };
    row("ΗΜΕΡΟΜΗΝΙΑ", t.date, H - 150);
    row("ΩΡΑ", t.time, H - 150 - 0); // placed beside via second column below
    page.drawText("ΩΡΑ", { x: 180, y: H - 150, size: 8, font, color: muted });
    page.drawText(t.time, { x: 180, y: H - 166, size: 13, font: fontB, color: ink });
    row("ΘΕΣΗ", t.seat, H - 205);
    page.drawText("ΤΥΠΟΣ", { x: 180, y: H - 205, size: 8, font, color: muted });
    page.drawText(t.ticketType, { x: 180, y: H - 221, size: 13, font: fontB, color: ink });

    // QR
    const qrUri = await QRCode.toDataURL(t.qrData, { margin: 1, width: 360, errorCorrectionLevel: "M" });
    const qrPng = await doc.embedPng(qrUri);
    const qrSize = 150;
    page.drawImage(qrPng, { x: (W - qrSize) / 2, y: 150, width: qrSize, height: qrSize });
    page.drawText(t.serial, { x: 22, y: 128, size: 11, font: fontB, color: ink });
    page.drawText("Δείξτε αυτό το QR στην είσοδο", { x: 22, y: 112, size: 8, font, color: muted });

    // Footer
    page.drawText(t.holder, { x: 22, y: 70, size: 11, font: fontB, color: ink });
    page.drawText(t.price, { x: W - 90, y: 66, size: 16, font: fontB, color: ink });
    page.drawText(t.legal, { x: 22, y: 30, size: 7, font, color: muted });
    page.drawRectangle({ x: 0, y: 0, width: W, height: 6, color: brand });
  }
  return await doc.save();
}
