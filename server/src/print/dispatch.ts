import net from 'node:net';

const ESC = 0x1b;
const GS = 0x1d;

/** ESC/POS: άνοιγμα συρταριού μετρητών (pin 2). */
export const DRAWER_KICK = Buffer.from([ESC, 0x70, 0x00, 0x19, 0xfa]);
/** ESC/POS: πλήρης κοπή. */
export const FULL_CUT = Buffer.from([GS, 0x56, 0x00]);

export interface PrinterRow {
  id: number; name: string; type: 'escpos58' | 'escpos80' | 'zpl';
  connection: 'usb' | 'network' | 'system' | 'file'; address?: string;
  copies?: number; auto_cut?: number; drawer_kick?: number;
}

/**
 * Στέλνει raw bytes σε δικτυακό εκτυπωτή (IP:port, default 9100).
 * Επιστρέφει promise. Για usb/system/file ΔΕΝ στέλνει (επιστρέφει 'unsupported')
 * — η αποστολή εκεί απαιτεί OS spooler ή τοπικό agent (γίνεται στο deployment).
 */
export function sendToNetworkPrinter(address: string, payload: Buffer, timeoutMs = 4000): Promise<void> {
  return new Promise((resolve, reject) => {
    const [host, portStr] = (address || '').split(':');
    const port = Number(portStr) || 9100;
    if (!host) return reject(new Error('Λείπει η διεύθυνση IP του εκτυπωτή'));
    const socket = new net.Socket();
    let done = false;
    const finish = (err?: Error) => { if (done) return; done = true; socket.destroy(); err ? reject(err) : resolve(); };
    socket.setTimeout(timeoutMs);
    socket.once('error', finish);
    socket.once('timeout', () => finish(new Error('Λήξη χρόνου σύνδεσης με τον εκτυπωτή')));
    socket.connect(port, host, () => {
      socket.write(payload, () => socket.end());
    });
    socket.once('close', () => finish());
  });
}

/** Συνθέτει το τελικό payload ESC/POS με αντίγραφα + drawer + cut. */
export function buildEscposJob(ticketBytes: Buffer, p: PrinterRow): Buffer {
  const parts: Buffer[] = [];
  if (p.drawer_kick) parts.push(DRAWER_KICK);
  const copies = Math.max(1, p.copies ?? 1);
  for (let i = 0; i < copies; i++) {
    parts.push(ticketBytes);
    if (p.auto_cut) parts.push(FULL_CUT);
  }
  return Buffer.concat(parts);
}

/** Best-effort αποστολή. Δεν πετάει — επιστρέφει αποτέλεσμα. */
export async function dispatch(p: PrinterRow, opts: { escposBytes?: Buffer; zpl?: string }): Promise<{ sent: boolean; reason?: string }> {
  try {
    if (p.connection !== 'network') return { sent: false, reason: 'Μη δικτυακός εκτυπωτής — αποστολή μέσω OS/agent.' };
    let payload: Buffer;
    if (p.type === 'zpl') {
      const zpl = opts.zpl ?? '';
      const copies = Math.max(1, p.copies ?? 1);
      payload = Buffer.from(zpl.repeat(copies), 'utf-8');
    } else {
      if (!opts.escposBytes) return { sent: false, reason: 'Κανένα ESC/POS payload.' };
      payload = buildEscposJob(opts.escposBytes, p);
    }
    await sendToNetworkPrinter(p.address ?? '', payload);
    return { sent: true };
  } catch (e) {
    return { sent: false, reason: (e as Error).message };
  }
}
