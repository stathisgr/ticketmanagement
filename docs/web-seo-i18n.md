# Οδηγός: SEO & Πολυγλωσσικότητα (i18n) — «ο τρόπος που αγαπάει η Google»

Γενικός οδηγός για σωστό SEO + πολλές γλώσσες σε στατικό site. Αναφορά: `ticketmanager.gr/site/`
(EL) + `/en/`, `/tr/`, `/bg/`.

---

## 1. Ανά σελίδα — τα βασικά `<head>`

- `<title>` μοναδικός, περιγραφικός (keyword + brand).
- `<meta name="description">` 1 πρόταση, ανθρώπινη.
- `<link rel="canonical">` στο **απόλυτο** URL της σελίδας.
- Open Graph (`og:title/description/image/url/type/locale`) + `twitter:card`.
- `theme-color`, favicons (ico/svg/apple-touch), `manifest`.

## 2. Πολυγλωσσικό hreflang (το «σωστό»)

Σε **κάθε** σελίδα, **όλες** οι εναλλακτικές γλώσσες + x-default:

```html
<link rel="alternate" hreflang="el" href="https://site/page.html" />
<link rel="alternate" hreflang="en" href="https://site/en/page-en.html" />
<link rel="alternate" hreflang="tr" href="https://site/tr/page-tr.html" />
<link rel="alternate" hreflang="bg" href="https://site/bg/page-bg.html" />
<link rel="alternate" hreflang="x-default" href="https://site/page.html" />
```

- **Αμφίδρομα:** κάθε γλώσσα δείχνει σε όλες τις άλλες (όχι μονόδρομα).
- **Language switcher ανά σελίδα** που δείχνει στα ίδια URLs.
- `x-default` → η κύρια/προεπιλεγμένη γλώσσα.

## 3. Στρατηγική slugs ανά γλώσσα

- **EL:** keyword greeklish (π.χ. `Eisitiria_ana_klado.html`).
- **EN:** αγγλική ορολογία (π.χ. `ticketing-by-industry.html`).
- **TR/BG:** λατινική μεταγραφή του όρου.
- **Τοπωνύμια ΜΕΝΟΥΝ** ίδια σε όλες (π.χ. *Alexandroupolis*).
- **Επωνυμία εταιρείας σταθερή** (π.χ. *Alpha PLIROFORIKI S.A.* / *Alpha ΠΛΗΡΟΦΟΡΙΚΗ Α.Ε.*).

## 4. Sitemap με alternates

`sitemap.xml` με `xhtml:link` alternates ανά URL (ώστε η Google να ξέρει τις γλωσσικές εκδοχές):

```xml
<url>
  <loc>https://site/page.html</loc>
  <xhtml:link rel="alternate" hreflang="en" href="https://site/en/page-en.html"/>
  ... (όλες οι γλώσσες) ...
</url>
```

Πρόσθεσε `robots.txt` + (προαιρετικά) `llms.txt`.

## 5. Structured data (JSON-LD)

Στην αρχική: `Organization` + `SoftwareApplication`/`Product` + `WebSite`. Σε σελίδες:
`BreadcrumbList`· σε FAQ: `FAQPage` (Q/A). Κρατά τα συνεπή με το ορατό περιεχόμενο.

## 6. Περιεχόμενο/μηνύματα

- Καθαρά problem/solution blocks, σύντομα, χωρίς jargon.
- Σταθερή ορολογία/ονόματα προϊόντων· links σε σελίδες πώλησης όπου αναφέρονται.

## Παγίδες

- Μονόδρομο hreflang ή που λείπει γλώσσα → η Google το αγνοεί.
- Διαφορετικά slugs χωρίς ενημερωμένο sitemap/hreflang → orphan σελίδες.
- Μετάφραση τοπωνυμίων/επωνυμίας → ασυνέπεια brand & τοπικό SEO.
- Canonical που δείχνει σε λάθος/μη-απόλυτο URL.
