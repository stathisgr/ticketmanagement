/**
 * Εξαγωγή απόδειξης ως απλή ASCII εγγραφή σε text-file, σε οριζόμενο φάκελο.
 * Ένας agent της ταμειακής μηχανής παρακολουθεί τον φάκελο, τραβάει το αρχείο
 * και εκδίδει την απόδειξη.
 *
 * ⚠️ Η ΑΚΡΙΒΗΣ ΜΟΡΦΗ ΤΗΣ ΕΓΓΡΑΦΗΣ θα δοθεί από τον πελάτη. Η παρακάτω είναι
 * ένα ευανάγνωστο placeholder format (key=value) — εύκολα προσαρμόσιμο.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export interface ReceiptLine {
  description: string;
  qty: number;
  unitPrice: number;
  vatRate: number;
  lineTotal: number;
}

export interface ReceiptPayload {
  receiptNo: string;
  datetime: string;
  paymentMethod: string;
  lines: ReceiptLine[];
  total: number;
  vatTotal: number;
}

/** Παράγει το ASCII περιεχόμενο (placeholder format). */
export function buildAsciiReceipt(p: ReceiptPayload): string {
  const rows = p.lines
    .map(
      (l) =>
        `ITEM|${l.description}|${l.qty}|${l.unitPrice.toFixed(2)}|${l.vatRate}|${l.lineTotal.toFixed(2)}`
    )
    .join('\n');
  return [
    `RECEIPT=${p.receiptNo}`,
    `DATETIME=${p.datetime}`,
    `PAYMENT=${p.paymentMethod.toUpperCase()}`,
    rows,
    `TOTAL=${p.total.toFixed(2)}`,
    `VAT=${p.vatTotal.toFixed(2)}`,
    `END`,
    '',
  ].join('\n');
}

/** Γράφει την εγγραφή στον φάκελο spool. Επιστρέφει το path. */
export function exportAsciiReceipt(folder: string, p: ReceiptPayload): string {
  mkdirSync(folder, { recursive: true });
  const fileName = `receipt_${p.receiptNo}_${Date.now()}.txt`;
  const fullPath = join(folder, fileName);
  // ASCII-friendly: ο agent συνήθως περιμένει 8-bit/latin — κρατάμε utf-8 ως default,
  // αλλάζει εύκολα όταν δοθεί η προδιαγραφή.
  writeFileSync(fullPath, buildAsciiReceipt(p), { encoding: 'utf-8' });
  return fullPath;
}
