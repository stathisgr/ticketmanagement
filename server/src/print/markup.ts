/**
 * Inline control tags ανά γραμμή για τις φόρμες εκτύπωσης.
 * Στην ΑΡΧΗ της γραμμής, σε αγκύλες:
 *   [s1]..[s4]  μέγεθος (1–4)
 *   [c] [l] [r] στοίχιση (center/left/right)
 *   [b]         έντονα
 *   [qr]        η γραμμή αντικαθίσταται από το QR code (κεντραρισμένο)
 * Συνδυασμοί: "[s2][c]ΚΑΛΩΣ ΗΡΘΑΤΕ".
 */
export interface ParsedLine {
  text: string;
  size?: number;                       // 1–4 (undefined → default τμήματος)
  align?: 'left' | 'center' | 'right';
  bold?: boolean;
  qr?: boolean;
  qrMark?: boolean;                    // QR του παρόχου (myDATA) — [qrmark]
}

export function parseLine(raw: string): ParsedLine {
  let s = raw;
  const out: ParsedLine = { text: '' };
  const tokenRe = /^\s*\[(s[1-4]|c|l|r|b|qrmark|qr)\]/i;
  let m: RegExpMatchArray | null;
  while ((m = s.match(tokenRe))) {
    const tok = m[1].toLowerCase();
    if (tok === 'qrmark') out.qrMark = true;
    else if (tok === 'qr') out.qr = true;
    else if (tok[0] === 's') out.size = Number(tok[1]);
    else if (tok === 'c') out.align = 'center';
    else if (tok === 'l') out.align = 'left';
    else if (tok === 'r') out.align = 'right';
    else if (tok === 'b') out.bold = true;
    s = s.slice(m[0].length);
  }
  out.text = s;
  return out;
}

/** Αφαιρεί τα tags (για preview/μη-θερμικά). Αφήνει «[QR]» ένδειξη όπου υπάρχει qr. */
export function stripMarkup(text: string): string {
  return (text ?? '')
    .split('\n')
    .map((l) => {
      const p = parseLine(l);
      return p.qrMark ? '[QR ΜΑΡΚ]' : p.qr ? '[QR]' : p.text;
    })
    .join('\n');
}

/** true αν το κείμενο περιέχει τουλάχιστον ένα [qr] tag. */
export function hasQrTag(...texts: (string | undefined)[]): boolean {
  return texts.some((t) => (t ?? '').split('\n').some((l) => parseLine(l).qr));
}
