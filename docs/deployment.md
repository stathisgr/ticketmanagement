# Οδηγός: Deployment & Πακετάρισμα εγκαταστάσεων (Windows)

Πώς εγκαθίσταται η εφαρμογή σε πελάτη: **Server** ως Windows Service, **σταθμοί** (Ταμείο/Ελεγκτής)
ως kiosk browser, και **factory** για έτοιμο ZIP νέου πελάτη. Αρχεία: `deploy/`.
Σχετικό: [ΟΔΗΓΟΣ-Windows-Service-NodeJS.md](./ΟΔΗΓΟΣ-Windows-Service-NodeJS.md).

---

## 1. Αρχιτεκτονική εγκατάστασης

- **Ένας server-PC**: τρέχει το Node app (Fastify) που σερβίρει και τον client και κρατά τη βάση (`data/ticket.db`). Πόρτα **3001**, ακούει στο LAN.
- **Σταθμοί Ταμείου/Ελεγκτή**: απλοί **browsers** που δείχνουν `http://<server-ip>:3001/`. Δεν τρέχουν Node.
- **Απαίτηση:** Node.js **≥ 22.5** (η βάση χρησιμοποιεί `node:sqlite`).
- **Runtime μοντέλο (ελάχιστο/ταχύ):** ο server τρέχει **μεταγλωττισμένος** — `node server/dist/server.js`. Το build γίνεται με **esbuild** (`npm run build -w server`, transpile-only, όπως το tsx αλλά ahead-of-time). Στον πελάτη εγκαθίστανται **μόνο runtime deps** (`npm install --omit=dev`): fastify + qrcode + bcryptjs + iconv-lite (καθαρό JS) — **χωρίς** tsx/esbuild/typescript/vite/react. Έτσι τα `node_modules` πέφτουν από ~123 MB σε ~λίγα MB.
- **⚠ Build/packaging γίνεται σε Windows** (το μηχάνημα ανάπτυξης), όχι σε mounted/FUSE περιβάλλον (μπορεί να αλλοιώσει αρχεία).

```
deploy/
  server/   install-service.bat · uninstall-service.bat · manage-service.bat · start.bat
  client/   install-station.bat · uninstall-station.bat
  factory/  new-customer.ps1 · factory-seed.mjs · new-customer.bat
```

### Ποιος στήνει τι (κρίσιμο)

- **Άδειο PC πελάτη (server):** ΜΟΝΟ το `Server.zip` → `install-service.bat`. Κατεβάζει/βάζει μόνο του **Node 22**, στήνει το service, και η **τοπική βάση (SQLite) φτιάχνεται αυτόματα** (seed). Δεν χρειάζεται pg_dump/psql/Supabase CLI εκεί.
- **Cloud (Supabase):** στήνεται **ΜΙΑ φορά** από εσένα (όχι στο PC του πελάτη) — βλ. [cloud-bootstrap.md](./cloud-bootstrap.md): `schema.sql` στο SQL Editor → `deploy-functions.bat` → secrets. Το `pg_dump` το τρέχεις **μία φορά** σε δικό σου PC για να φτιάξεις το `schema.sql` (μετά είναι στατικό αρχείο).

## 2. Server (Windows Service)

Στον server-PC, μέσα στον φάκελο της εφαρμογής, τρέξε **ως Administrator**:
`deploy\server\install-service.bat`. Κάνει:

1. Έλεγχος **Node ≥ 22** — αν λείπει, κατεβάζει & εγκαθιστά Node 22 LTS (silent).
2. Εξαρτήσεις: αν λείπει `node_modules` → `npm install` (αλλιώς χρησιμοποιεί τα bundled).
3. **Πρώτο seed** (αν δεν υπάρχει `data\ticket.db`): δημιουργεί βάση με βασικά είδη + `admin/admin`, **χωρίς κινήσεις**.
4. **Firewall**: inbound TCP 3001.
5. **Service** μέσω Task Scheduler (ως **SYSTEM**, `onstart`, auto-restart loop) + auto-open browser admin σε αυτό το PC.

Διαχείριση: `manage-service.bat` (start/stop/restart/status), `start.bat` (manual για debug), `uninstall-service.bat` (κρατά το `data\`). Log: `data\server.log`.

> Άλλαξε `admin/admin` αμέσως. Σημείωσε την IP του server (`ipconfig`) για τους σταθμούς.

## 3. Σταθμοί (Ταμείο / Ελεγκτής)

Σε κάθε PC ταμείου/ελέγχου τρέξε `deploy\client\install-station.bat`:
- Ζητά **IP server**, **πόρτα** (3001), **ρόλο** (Ταμείο/Ελεγκτής), όνομα σταθμού.
- Εντοπίζει **Chrome** (αλλιώς **Edge**) και φτιάχνει shortcut σε **app mode** προς `http://<ip>:3001/`, σε **Desktop + Startup** (auto-open στο login). Κάθε ρόλος έχει δικό του browser profile (θυμάται login/σταθμό).
- Στην 1η εκκίνηση: ο χρήστης πατά «Ως Ταμίας»/«Ως Ελεγκτής» και διαλέγει σταθμό (πάνω δεξιά).

Αφαίρεση: `uninstall-station.bat`.

## 4. Factory — έτοιμο ZIP νέου πελάτη

Στο μηχάνημα ανάπτυξης (με Node 22 + γενόμενο `client\dist`):

```
cd deploy\factory
powershell -ExecutionPolicy Bypass -File new-customer.ps1 ^
  -Customer "Theatro XYZ" -Vat "123456789" -City "Athina" ^
  -Logo "C:\logos\xyz.webp" -Out "C:\builds"
```

Το factory (στο Windows) κάνει: **build client (vite) + server (esbuild)** → αντιγράφει **μόνο compiled** (όχι `src`/`node_modules`/site) → **`npm install --omit=dev`** (minimal runtime) → **seed** άδειας βάσης + στοιχεία επιχείρησης → **logo swap** (`logo_install.svg`) → ZIP.

Το `AlphaTicketManager-<πελάτης>-<ημερομηνία>.zip` περιέχει:
- `server/dist` (μεταγλωττισμένο) + **minimal** `node_modules` (μόνο runtime, ~λίγα MB).
- `client/dist` (χτισμένο), αλλαγμένο `logo_install.svg`.
- **Άδεια βάση** με βασικά είδη + στοιχεία επιχείρησης (όνομα/ΑΦΜ/πόλη…), **καμία πώληση**.
- `INSTALL-README.txt`.

Ο πελάτης: ξεζιπάρει → `deploy\server\install-service.bat` (ελέγχει Node, στήνει το service, τρέχει `node dist\server.js` — **χωρίς** npm install/build, όλα bundled) → σταθμοί με `install-station.bat`. Ελάχιστο & ταχύ.

> Το factory τρέχει σε **Windows** (Node 22 + internet για το `npm install --omit=dev`). Δίνει το πιο μικρό/καθαρό πακέτο — **μόνο dist**, χωρίς πηγαίο κώδικα.

## 5. Branding (λογότυπο πελάτη)

Το λογότυπο πελάτη είναι **ένα μόνο αρχείο: `assets/logo_install.svg`** — εμφανίζεται πάνω-αριστερά
στην εφαρμογή, δίπλα στο **όνομα επιχείρησης** (που έρχεται από τη βάση, `venue.name`). Ο client το
ζητά ως `/assets/logo_install.svg` (App.tsx).

Το factory κάνει **asset swap μόνο αυτού του αρχείου** στο `client\dist\assets\logo_install.svg`
με το `-Logo` που δίνεις (αποθηκεύεται με το όνομα `logo_install.svg`). **ΔΕΝ** πειράζει τα κοινά
assets της Alpha (logo-alpha, icons, favicons). Προτίμησε **SVG**.

Η ροή σου: αλλάζεις το SVG του πελάτη → τρέχεις το factory (`-Logo C:\...\pelatis.svg`) → βγαίνει το
ZIP με το σωστό λογότυπο + το όνομα επιχείρησης στη βάση. (Εναλλακτικά: αντικατέστησε χειροκίνητα το
`client\dist\assets\logo_install.svg` στο repo και τρέξε το factory χωρίς `-Logo`.)

## Παγίδες

- **Node 20 δεν αρκεί** — χρειάζεται 22.5+ (node:sqlite). Τα scripts κατεβάζουν Node 22.
- Τα `.bat` πρέπει να είναι **CRLF** (Windows). Τα μηνύματα είναι αγγλικά/ASCII επίτηδες, για αποφυγή προβλημάτων codepage.
- `taskkill /F /IM node.exe` στο stop σταματά **όλα** τα node.exe — προσοχή αν τρέχουν κι άλλα Node app στο ίδιο PC.
- Ο server πρέπει να είναι προσβάσιμος στο LAN (firewall 3001 + ίδιο δίκτυο). Δοκίμασε `http://<ip>:3001/` από σταθμό.
- Το factory θέλει Node 22 + χτισμένο `client\dist` στο μηχάνημα ανάπτυξης.
