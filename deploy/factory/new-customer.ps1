<#
  new-customer.ps1 — Παράγει έτοιμο ZIP εγκατάστασης SERVER για νέο πελάτη:
    * αντιγράφει καθαρό αντίγραφο της εφαρμογής (χωρίς git/online/site/data)
    * αλλάζει το λογότυπο (asset swap)
    * φτιάχνει ΑΔΕΙΑ βάση με βασικά είδη + στοιχεία επιχείρησης, ΧΩΡΙΣ κινήσεις
    * συμπιέζει σε <Out>\AlphaTicketManager-<Customer>-<date>.zip

  Παράδειγμα:
    powershell -ExecutionPolicy Bypass -File new-customer.ps1 `
      -Customer "Theatro XYZ" -Vat "123456789" -City "Athina" -Logo "C:\logos\xyz.webp" -Out "C:\builds"
#>
param(
  [Parameter(Mandatory=$true)][string]$Customer,
  [string]$Vat = "000000000",
  [string]$Tax = "",
  [string]$Address = "",
  [string]$City = "",
  [string]$Postal = "",
  [string]$Phone = "",
  [string]$Email = "",
  [string]$Logo = "",
  [string]$Out = "$env:USERPROFILE\Desktop\AlphaTM-builds",
  [string]$SourceRoot = "",
  [switch]$NoModules
)
$ErrorActionPreference = "Stop"
function Info($m){ Write-Host "[factory] $m" -ForegroundColor Cyan }

# Source = ριζικός φάκελος εφαρμογής (δύο επίπεδα πάνω από deploy\factory)
if (-not $SourceRoot) { $SourceRoot = (Resolve-Path "$PSScriptRoot\..\..").Path }
Info "Source: $SourceRoot"
if (-not (Test-Path "$SourceRoot\package.json")) { throw "Δεν βρέθηκε package.json στο $SourceRoot" }
if (-not (Test-Path "$SourceRoot\client\dist")) { Write-Warning "Λείπει το client\dist — τρέξε πρώτα: npm run build (client)" }

$slug  = ($Customer -replace '[^A-Za-z0-9]+','-').Trim('-')
$stamp = Get-Date -Format "yyyyMMdd"
$stage = Join-Path $env:TEMP "atm-$slug-$stamp"
if (Test-Path $stage) { Remove-Item $stage -Recurse -Force }
New-Item -ItemType Directory -Path $stage | Out-Null
New-Item -ItemType Directory -Path $Out -Force | Out-Null

# --- 1) Καθαρό αντίγραφο (robocopy, με εξαιρέσεις) ---
Info "Copying app (excluding git/online/site/data/factory)..."
$xd = @(".git","online","ticketmanager.gr","data",".vscode","$SourceRoot\deploy\factory")
if ($NoModules) { $xd += "node_modules" }
$xdArgs = @(); foreach($d in $xd){ $xdArgs += "/XD"; $xdArgs += $d }
# robocopy επιστρέφει 0-7 ως επιτυχία
& robocopy $SourceRoot $stage /MIR /NFL /NDL /NJH /NJS /NP @xdArgs /XF "*.log" | Out-Null
if ($LASTEXITCODE -ge 8) { throw "robocopy failed ($LASTEXITCODE)" }

# --- 2) Logo swap — ΜΟΝΟ το λογότυπο πελάτη logo_install.svg (πάνω-αριστερά, δίπλα στο όνομα επιχείρησης).
#         ΔΕΝ πειράζουμε τα κοινά assets της Alpha (logo-alpha, icons, favicons κ.λπ.).
if ($Logo) {
  if (-not (Test-Path $Logo)) { throw "Δεν βρέθηκε το logo: $Logo" }
  $target = Join-Path $stage "client\dist\assets\logo_install.svg"
  if (Test-Path (Split-Path $target)) {
    Copy-Item $Logo $target -Force   # αποθηκεύεται ΩΣ logo_install.svg (το όνομα που περιμένει η εφαρμογή)
    Info "customer logo -> client\dist\assets\logo_install.svg"
    if (-not ($Logo -match '(?i)\.svg$')) { Write-Warning "Το logo δεν είναι .svg — προτιμότερο SVG για καθαρή εμφάνιση." }
  } else { Write-Warning "Δεν βρέθηκε client\dist\assets — έχεις χτίσει τον client; (cd client && npm run build)" }
}

# --- 3) Άδεια βάση: seed (βασικά είδη) + στοιχεία επιχείρησης, χωρίς κινήσεις ---
Info "Seeding fresh database (basic items, no movements)..."
Push-Location $stage
try {
  & npm run seed
  if ($LASTEXITCODE -ne 0) { throw "npm run seed failed" }
  $params = @{ name=$Customer; vat=$Vat; tax=$Tax; address=$Address; city=$City; postal=$Postal; phone=$Phone; email=$Email } | ConvertTo-Json
  $pf = Join-Path $stage "data\_params.json"
  Set-Content -Path $pf -Value $params -Encoding UTF8
  & node "$PSScriptRoot\factory-seed.mjs" "$stage\data\ticket.db" $pf
  if ($LASTEXITCODE -ne 0) { throw "factory-seed failed" }
  Remove-Item $pf -Force
} finally { Pop-Location }

# Πρόσθεσε σύντομες οδηγίες για τον τεχνικό
@"
Alpha Ticket Manager - Εγκατάσταση για: $Customer
1) Αντίγραψε τον φάκελο στον server-PC (π.χ. C:\AlphaTicketManager).
2) Τρέξε deploy\server\install-service.bat (ως Administrator).
3) Στους σταθμούς ταμείου/ελέγχου: deploy\client\install-station.bat.
Προεπιλεγμένος χρήστης: admin / admin (ΑΛΛΑΞΕ τον). Βάση: data\ticket.db (μόνο βασικά είδη, χωρίς κινήσεις).
"@ | Set-Content -Path (Join-Path $stage "INSTALL-README.txt") -Encoding UTF8

# --- 4) ZIP ---
$zip = Join-Path $Out "AlphaTicketManager-$slug-$stamp.zip"
if (Test-Path $zip) { Remove-Item $zip -Force }
Info "Zipping -> $zip"
Compress-Archive -Path "$stage\*" -DestinationPath $zip -CompressionLevel Optimal
Remove-Item $stage -Recurse -Force
Info "DONE."
Write-Host ""
Write-Host "Package: $zip" -ForegroundColor Green
