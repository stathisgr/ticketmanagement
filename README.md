# Ticket Manager

Lightweight εφαρμογή έκδοσης εισιτηρίων (μουσεία / θέατρα / κινηματογράφοι / events).
Τοπική λειτουργία (LAN) με POS-style έκδοση. Δες [`ARCHITECTURE.md`](./ARCHITECTURE.md) για τον πλήρη σχεδιασμό.

## Στοίβα
- **Backend**: Node.js + TypeScript + Fastify + **`node:sqlite`** (ενσωματωμένη SQLite — καμία native μεταγλώττιση, δεν χρειάζεται Visual Studio Build Tools)
- **Frontend**: React + Vite + TypeScript + Tailwind CSS
- **Εκτύπωση**: ESC/POS (58/80mm) & Zebra ZPL με QR Code

> **Απαιτεί Node.js ≥ 22.5** (ιδανικά **Node 24**), λόγω του ενσωματωμένου module `node:sqlite`.

## Δομή
```
server/   Fastify API + SQLite (σχήμα, seed, routes, εκτύπωση, fiscal, αίθουσες/θεάματα)
client/   React UI: Έκδοση (POS), Θέσεις, Ταμείο, Πρόγραμμα, Αίθουσες, Ρυθμίσεις
data/     Το αρχείο SQLite (δημιουργείται αυτόματα — εκτός git)
spool/    ASCII αποδείξεις για agent ταμειακής (εκτός git)
```

## Λειτουργίες
- **Φάση 1** — Σειριακή POS έκδοση (κουμπιά εισιτηρίων, ποσότητα, Μετρητά/Κάρτα/Τράπεζα), εκτύπωση ESC/POS+ZPL με QR, ASCII απόδειξη ταμειακής, ταμείο ημερήσιο/περιόδου, στατιστικά, ρόλοι manager/cashier.
- **Φάση 2** — Αίθουσες με οπτικό σχεδιαστή διάταξης (θέση/διάδρομος/κενό, αρίθμηση A1…), πρόγραμμα θεαμάτων ανά αίθουσα/ώρα με δικά τους είδη εισιτηρίων, αντιγραφή setup, POS με χάρτη θέσεων (επιλογή → έκδοση) και προστασία διπλο-κράτησης.

## Εκκίνηση (development)
```bash
npm install            # στη ρίζα (εγκαθιστά server + client)
npm run seed           # δημιουργεί τη βάση + αρχικά δεδομένα
npm run dev            # τρέχει server (3001) + client (5173)
```
- POS UI: http://localhost:5173
- API:    http://localhost:3001/api
- Default login: `admin` / `admin` (manager) — **άλλαξέ το**.

## Παραγωγή / LAN
```bash
npm run build          # build του client
npm start              # σερβίρει API + client στο http://<server-ip>:3001
```
Τα άλλα ταμεία ανοίγουν `http://<server-ip>:3001` από browser.

## ⚠️ OneDrive
Ο φάκελος είναι μέσα σε OneDrive. Το `node_modules/` και η βάση `data/*.db` **εξαιρούνται** μέσω `.gitignore`,
αλλά το OneDrive μπορεί να προσπαθήσει να τα συγχρονίσει. Προτείνεται είτε να εξαιρέσεις τους φακέλους
`node_modules` & `data` από τον συγχρονισμό, είτε να μεταφέρεις το project εκτός OneDrive για development.
