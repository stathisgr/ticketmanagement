/**
 * Αυτόματος συγχρονισμός online (server-side) — τρέχει ΑΝΕΞΑΡΤΗΤΑ από το αν είναι κάποιος
 * συνδεδεμένος στην εφαρμογή. Κάθε λεπτό ελέγχει τη ρύθμιση `auto_sync_minutes` και, όταν
 * περάσει το διάστημα, εκτελεί pull() (κατέβασμα online πωλήσεων + έκδοση ΑΠΥ + email + ελευθέρωση
 * ακυρωμένων θέσεων). 0 λεπτά = ανενεργό.
 */
import { db } from '../db.js';
import { pull, remindPendingOnline } from './sync.js';

let running = false;
let lastRunMs = 0;
let lastRemindMs = 0;
let reminding = false;

export function startAutoSync() {
  setInterval(async () => {
    let cfg: any;
    try { cfg = db.prepare('SELECT enabled, auto_sync_minutes, service_key, supabase_url FROM online_config WHERE id = 1').get(); }
    catch { return; }
    if (!cfg || !cfg.enabled || !cfg.service_key || !cfg.supabase_url) return;

    // Υπενθυμίσεις ημιτελών (pending) παραγγελιών — ~κάθε 5′, ανεξάρτητα από το διάστημα auto-sync.
    if (!reminding && Date.now() - lastRemindMs >= 5 * 60_000) {
      reminding = true;
      remindPendingOnline()
        .then((r) => { if (r.sent) console.log(`[pending-reminder] ${new Date().toISOString()} sent=${r.sent} checked=${r.checked}`); })
        .catch((e) => console.error('[pending-reminder] error:', (e as Error).message))
        .finally(() => { lastRemindMs = Date.now(); reminding = false; });
    }

    const mins = Number(cfg.auto_sync_minutes) || 0;
    if (mins <= 0 || running) return;
    if (Date.now() - lastRunMs < mins * 60_000) return;
    running = true;
    const stamp = (info: string) => {
      try { db.prepare('UPDATE online_config SET last_auto_sync_at = ?, last_auto_sync_info = ? WHERE id = 1').run(new Date().toISOString(), info); }
      catch { /* μη-κρίσιμο */ }
    };
    try {
      const r = await pull();
      console.log(`[auto-sync] ${new Date().toISOString()} pulled=${r.pulled} importedSales=${r.importedSales}`);
      stamp(`${r.importedSales} online πωλήσεις, ${r.pulled} θέσεις`);
    } catch (e) {
      console.error('[auto-sync] error:', (e as Error).message);
      stamp(`Σφάλμα: ${(e as Error).message}`);
    } finally {
      lastRunMs = Date.now();
      running = false;
    }
  }, 60_000).unref?.();
}
