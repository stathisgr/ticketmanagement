# Οδηγός: Αποστολή Email (Resend & Microsoft 365 Graph)

Γενικός οδηγός για αποστολή transactional email (αποδείξεις, e-tickets, υπενθυμίσεις,
leads) από μια εφαρμογή. Δύο πάροχοι, επιλέξιμοι με ρύθμιση. Αναφορά:
`server/src/online/email.ts` (τοπικό), `online/supabase/functions/*` (cloud, Graph).

---

## 1. Δύο πάροχοι, μία διεπαφή

`email.provider` = `'resend'` (default) ή `'graph'`. Η `sendEmail(to, subject, html)`
δεν ρίχνει εξαίρεση — επιστρέφει `{ok, error}` ώστε **αποτυχία email να μη σπάει** την κύρια ροή.

| Ρύθμιση | Resend | Microsoft 365 (Graph) |
|---|---|---|
| `from` | επαληθευμένο domain | mailbox/shared mailbox |
| κλειδιά | `resendKey` | `tenantId`, `clientId`, `clientSecret` |
| `replyTo` | προαιρετικό | προαιρετικό |

Όλα καταχωρούνται από τον χρήστη, μένουν τοπικά.

## 2. Microsoft 365 (Graph, client-credentials) — setup

1. **Entra ID → App registration** (νέα εφαρμογή).
2. **API permissions → Microsoft Graph → Application permission → `Mail.Send`** → **Grant admin consent**.
3. **Client secret** (Certificates & secrets) → κράτα το value.
4. `tenantId` = Directory (tenant) ID, `clientId` = Application (client) ID.
5. **Sending mailbox:** χρησιμοποίησε **shared mailbox** (π.χ. `noreply@domain`) ως `from`. (Με Application permission, η εφαρμογή μπορεί να στείλει «ως» οποιοδήποτε mailbox του tenant — περιόρισέ το με Application Access Policy αν θες.)

Ροή:
```
POST https://login.microsoftonline.com/{tenant}/oauth2/v2.0/token
  scope=https://graph.microsoft.com/.default  grant_type=client_credentials
POST https://graph.microsoft.com/v1.0/users/{from}/sendMail
  { message:{ subject, body:{contentType:'HTML',content}, toRecipients, replyTo }, saveToSentItems:true }
```
Attachments (π.χ. PDF): `message.attachments[] = { @odata.type:'#microsoft.graph.fileAttachment', name, contentType, contentBytes(base64) }`.

## 3. Resend — setup

1. Επαλήθευσε domain στο Resend (SPF/DKIM).
2. API key → `resendKey`.
3. `POST https://api.resend.com/emails { from, to[], subject, html, reply_to? }`.

## 4. Πρότυπα (HTML)

- Κράτα helper functions ανά είδος (απόδειξη, e-ticket, **υπενθύμιση pending**, lead notify).
- Πάντα escape user input. Inline CSS (τα email clients αγνοούν `<style>`/εξωτερικά).
- Κουμπί CTA + ίδιο link και ως plain text (fallback).

## 5. Πού χρησιμοποιείται (μοτίβα)

- **Τοπικό:** αποδείξεις/2ο email μετά την έκδοση ΑΠΥ, υπενθυμίσεις pending.
- **Cloud (Edge Function):** e-ticket μετά την πληρωμή (webhook), επιβεβαίωση lead από φόρμα site.
- Συνεπές `from` (π.χ. `noreply@domain`) και `replyTo` (π.χ. `sales@domain`) και στα δύο.

## Παγίδες

- Alias mailbox vs shared mailbox: για Graph απλούστερο/καθαρότερο με **shared mailbox**.
- Ξέχασες **admin consent** στο `Mail.Send` → 403.
- Honeypot πεδίο φόρμας με όνομα όπως `website` → autofill από browser → η φόρμα «θεωρείται spam» και δεν στέλνει. Χρησιμοποίησε ουδέτερο όνομα (π.χ. `hp_token`).
- Μην αφήνεις την αποστολή email να ρίχνει τη συναλλαγή — fail-soft.
