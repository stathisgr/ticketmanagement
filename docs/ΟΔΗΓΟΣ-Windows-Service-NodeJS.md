# Οδηγός: Node.js Εφαρμογή ως Windows Service

Πλήρης οδηγός για να μετατρέψεις ένα Node.js project σε αυτο-εγκαθιστάμενο Windows Service με:

- Αυτόματο download Node.js LTS
- Αυτόματο `npm install`
- Εγκατάσταση μέσω Windows Task Scheduler (τρέχει ως SYSTEM στο boot)
- Auto-restart σε crash
- Διαγνωστικά + management batch scripts
- Greek output με κωδικοσελίδα CP737

---

## ΠΕΡΙΕΧΟΜΕΝΑ

1. Αρχιτεκτονική
2. Αρχεία που χρειάζονται
3. install-windows-service.bat
4. uninstall-windows-service.bat
5. manage-service.bat
6. repair-service.bat
7. start.bat
8. Customization Checklist
9. Encoding & Line Endings
10. Συχνά Προβλήματα

---

## 1. ΑΡΧΙΤΕΚΤΟΝΙΚΗ

Δεν δημιουργούμε «true» Windows Service (που θα απαιτούσε ένα native wrapper όπως `nssm.exe`, `winsw.exe` ή κάποιο service manager — όλα προαπαιτούν εξωτερικό binary). Αντί αυτού χρησιμοποιούμε **Windows Task Scheduler** που:

- Τρέχει στο boot ως **SYSTEM** account (πλήρη δικαιώματα)
- Ξεκινάει πριν κάνει login κάποιος χρήστης
- Είναι built-in στα Windows (δεν χρειάζεται extra εργαλείο)
- Auto-restart πετυχαίνεται με `:LOOP` + `goto LOOP` στον wrapper

### Ροή εγκατάστασης

```
install-windows-service.bat
    ↓
[1] Έλεγχος Admin rights → auto-elevation αν χρειάζεται
    ↓
[2] Έλεγχος Node.js → αν λείπει: download MSI + silent install
    ↓
[3] npm install (αν δεν υπάρχει node_modules)
    ↓
[4] Καθαρισμός παλιών εγκαταστάσεων
    ↓
[5] Δημιουργία _service-wrapper.bat (auto-restart loop)
    ↓
[6] schtasks /create → Windows Scheduled Task ως SYSTEM, onstart
    ↓
[7] schtasks /run → άμεση εκκίνηση
```

### Δομή αρχείων project

```
MyApp/
├── server.js                       (η εφαρμογή σου)
├── package.json
├── package-lock.json
├── install-windows-service.bat     ← κύριος installer
├── uninstall-windows-service.bat   ← απεγκατάσταση
├── manage-service.bat              ← start/stop/restart
├── repair-service.bat              ← διαγνωστικά
├── start.bat                       ← manual run (για debugging)
├── _service-wrapper.bat            (auto-generated)
└── node-v20-x64.msi                (κατεβαίνει αυτόματα, παραμένει)
```

---

## 2. ΑΡΧΕΙΑ ΠΟΥ ΧΡΕΙΑΖΟΝΤΑΙ

| Αρχείο | Σκοπός | Run as Admin; |
|---|---|---|
| `install-windows-service.bat`   | Πλήρης εγκατάσταση (download Node + npm + service) | Ναι (auto-elevation) |
| `uninstall-windows-service.bat` | Διαγραφή service                                   | Ναι (auto-elevation) |
| `manage-service.bat`            | start / stop / restart / status                    | Ναι (auto-elevation) |
| `repair-service.bat`            | Διαγνωστικά, τι λείπει                             | Όχι (read-only)      |
| `start.bat`                     | Manual run για debugging (χωρίς service)           | Όχι                  |

---

## 3. install-windows-service.bat

```bat
@echo off
chcp 737 >nul
title MyApp - Windows Service Installer
cd /d "%~dp0"

REM === [ADMIN ELEVATION] ===
net session >nul 2>nul
if errorlevel 1 (
    echo Απαιτούνται δικαιώματα Administrator. Αίτημα elevation...
    powershell -Command "Start-Process '%~f0' -Verb RunAs"
    exit /b
)

echo ============================================================
echo   MyApp - Εγκατάσταση Windows Service
echo ============================================================
echo.

set "APP_DIR=%~dp0"
if "%APP_DIR:~-1%"=="\" set "APP_DIR=%APP_DIR:~0,-1%"
echo [OK] Φάκελος εφαρμογής: %APP_DIR%
echo.

REM === [ΒΗΜΑ 1/4] Έλεγχος / Auto-install Node.js ===
echo [Βήμα 1/4] Έλεγχος Node.js...

set "NODE_EXE="
if exist "%ProgramFiles%\nodejs\node.exe"      set "NODE_EXE=%ProgramFiles%\nodejs\node.exe"
if exist "%ProgramFiles(x86)%\nodejs\node.exe" set "NODE_EXE=%ProgramFiles(x86)%\nodejs\node.exe"
if "%NODE_EXE%"=="" (
    where node >nul 2>nul
    if not errorlevel 1 (
        for /f "tokens=*" %%i in ('where node') do set "NODE_EXE=%%i"
    )
)

if defined NODE_EXE (
    echo [OK] Node.js: %NODE_EXE%
    goto NODE_READY
)

REM Auto-download Node.js MSI
echo [ΕΛΛΕΙΨΗ] Το Node.js δεν είναι εγκατεστημένο.
echo.
echo Θα κατεβάσω το Node.js v20 LTS αυτόματα (~30 MB).
echo Απαιτείται σύνδεση στο Internet.
echo.
choice /C YN /M "Να συνεχίσω"
if errorlevel 2 exit /b 1

set "NODE_MSI=%APP_DIR%\node-v20-x64.msi"
set "NODE_URL=https://nodejs.org/dist/v20.18.0/node-v20.18.0-x64.msi"

REM Αν υπάρχει ήδη το MSI (πχ από προηγούμενη εγκατάσταση), παράκαμψε το download
if exist "%NODE_MSI%" (
    echo [OK] MSI ήδη υπάρχει, παράλειψη download.
    goto INSTALL_NODE
)

echo [Κατέβασμα] %NODE_URL%
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$ProgressPreference='SilentlyContinue'; try { Invoke-WebRequest -Uri '%NODE_URL%' -OutFile '%NODE_MSI%' -UseBasicParsing; exit 0 } catch { Write-Host $_.Exception.Message; exit 1 }"
if errorlevel 1 (
    echo [ΣΦΑΛΜΑ] Αποτυχία κατεβάσματος.
    echo Κατεβάστε χειροκίνητα από https://nodejs.org και ξανατρέξτε.
    pause
    exit /b 1
)

:INSTALL_NODE
echo [Εγκατάσταση] Silent install...
msiexec /i "%NODE_MSI%" /quiet /qn /norestart ADDLOCAL=ALL
if errorlevel 1 (
    echo [ΣΦΑΛΜΑ] Αποτυχία εγκατάστασης Node.js.
    pause
    exit /b 1
)

REM Το MSI παραμένει στον φάκελο για offline reinstall.
echo [OK] Αρχείο εγκατάστασης παραμένει: %NODE_MSI%

REM Refresh PATH στο current session
set "PATH=%ProgramFiles%\nodejs;%PATH%"

if exist "%ProgramFiles%\nodejs\node.exe" (
    set "NODE_EXE=%ProgramFiles%\nodejs\node.exe"
) else (
    echo [ΣΦΑΛΜΑ] Node.js εγκαταστάθηκε αλλά δεν εντοπίστηκε. Κάντε restart.
    pause
    exit /b 1
)

:NODE_READY
echo.

REM === [ΒΗΜΑ 2/4] npm install ===
echo [Βήμα 2/4] Εγκατάσταση εξαρτήσεων...
if not exist "node_modules" (
    call npm install --production --no-audit --no-fund
    if errorlevel 1 (
        echo [ΣΦΑΛΜΑ] npm install απέτυχε.
        pause
        exit /b 1
    )
)
echo [OK] node_modules ready.

REM === [ΒΗΜΑ 3/4] Καθαρισμός παλιάς εγκατάστασης ===
echo.
echo [Βήμα 3/4] Καθαρισμός παλιάς εγκατάστασης...
schtasks /delete /tn MyAppService /f >nul 2>nul
echo [OK] Καθαρισμός done.

REM === [ΒΗΜΑ 4/4] Δημιουργία Windows Service ===
echo.
echo [Βήμα 4/4] Δημιουργία Windows Service...

REM Auto-generated wrapper με restart loop
(
echo @echo off
echo cd /d "%APP_DIR%"
echo :LOOP
echo "%NODE_EXE%" server.js
echo timeout /t 5 /nobreak ^>nul
echo goto LOOP
) > "%APP_DIR%\_service-wrapper.bat"

set TASK_NAME=MyAppService

schtasks /create /tn %TASK_NAME% ^
  /tr "\"%APP_DIR%\_service-wrapper.bat\"" ^
  /sc onstart ^
  /ru "SYSTEM" ^
  /rl HIGHEST ^
  /f
if errorlevel 1 (
    echo [ΣΦΑΛΜΑ] Δημιουργία task απέτυχε.
    pause
    exit /b 1
)
echo [OK] Task "%TASK_NAME%" δημιουργήθηκε.

REM Εκκίνηση τώρα
schtasks /run /tn %TASK_NAME%
timeout /t 3 /nobreak >nul

echo.
echo ============================================================
echo   ΕΓΚΑΤΑΣΤΑΣΗ ΟΛΟΚΛΗΡΩΘΗΚΕ
echo ============================================================
echo Το service τρέχει ως SYSTEM, ξεκινάει στο boot, auto-restart.
echo.
echo Εργαλεία:
echo   manage-service.bat              (start/stop/restart)
echo   repair-service.bat              (διαγνωστικά)
echo   uninstall-windows-service.bat   (απεγκατάσταση)
echo.
pause
exit /b 0
```

---

## 4. uninstall-windows-service.bat

```bat
@echo off
chcp 737 >nul
title MyApp - Απεγκατάσταση
cd /d "%~dp0"

net session >nul 2>nul
if errorlevel 1 (
    powershell -Command "Start-Process '%~f0' -Verb RunAs"
    exit /b
)

echo ============================================================
echo   MyApp - Απεγκατάσταση Windows Service
echo ============================================================
echo.

set TASK_NAME=MyAppService

echo Διακοπή service...
schtasks /end /tn %TASK_NAME% >nul 2>nul

echo Διαγραφή scheduled task...
schtasks /delete /tn %TASK_NAME% /f
if errorlevel 1 (
    echo [ΠΛΗΡΟΦΟΡΙΑ] Δεν υπήρχε εγκατεστημένο task.
)

REM Τερματισμός όλων των node.exe (προσοχή αν έχεις άλλα Node projects)
echo Τερματισμός node.exe processes...
taskkill /F /IM node.exe >nul 2>nul

REM Διαγραφή wrapper
del /q "_service-wrapper.bat" >nul 2>nul

echo.
echo [OK] Απεγκατάσταση ολοκληρώθηκε.
echo Τα data files και ρυθμίσεις ΔΕΝ διεγράφησαν.
echo.
pause
```

---

## 5. manage-service.bat

```bat
@echo off
chcp 737 >nul
title MyApp - Διαχείριση Service
cd /d "%~dp0"

net session >nul 2>nul
if errorlevel 1 (
    powershell -Command "Start-Process '%~f0' -Verb RunAs"
    exit /b
)

set TASK_NAME=MyAppService

:MENU
cls
echo ============================================================
echo   MyApp - Διαχείριση Service
echo ============================================================
echo.
echo   1. Εκκίνηση (Start)
echo   2. Διακοπή (Stop)
echo   3. Επανεκκίνηση (Restart)
echo   4. Κατάσταση (Status)
echo   5. Έξοδος
echo.
choice /C 12345 /N /M "Επιλογή (1-5): "
echo.

if errorlevel 5 exit /b 0
if errorlevel 4 goto STATUS
if errorlevel 3 goto RESTART
if errorlevel 2 goto STOP
if errorlevel 1 goto START

:START
schtasks /run /tn %TASK_NAME%
echo [OK] Εκκίνηση.
pause
goto MENU

:STOP
schtasks /end /tn %TASK_NAME% >nul 2>nul
taskkill /F /IM node.exe >nul 2>nul
echo [OK] Διακοπή.
pause
goto MENU

:RESTART
schtasks /end /tn %TASK_NAME% >nul 2>nul
taskkill /F /IM node.exe >nul 2>nul
timeout /t 2 /nobreak >nul
schtasks /run /tn %TASK_NAME%
echo [OK] Restart.
pause
goto MENU

:STATUS
schtasks /query /tn %TASK_NAME% /v /fo LIST | findstr /R "Status: Last"
echo.
tasklist /fi "imagename eq node.exe" | findstr /i "node.exe"
if errorlevel 1 echo [ΠΡΟΣΟΧΗ] Κανένα node.exe δεν τρέχει.
pause
goto MENU
```

---

## 6. repair-service.bat

```bat
@echo off
chcp 737 >nul
title MyApp - Διαγνωστικός Έλεγχος
cd /d "%~dp0"

echo ============================================================
echo   MyApp - Διαγνωστικός Έλεγχος
echo ============================================================
echo.

set TASK_NAME=MyAppService
set CHECK_PORT=3000

REM 1. Έλεγχος Node.js
echo [1] Node.js:
where node 2>nul && echo     [OK] node εντοπίστηκε στο PATH
node --version 2>nul || echo     [ΣΦΑΛΜΑ] node απέτυχε
echo.

REM 2. Έλεγχος node_modules
echo [2] node_modules:
if exist "node_modules" (echo     [OK] υπάρχει) else (echo     [ΣΦΑΛΜΑ] λείπει — τρέξτε npm install)
echo.

REM 3. Έλεγχος server.js
echo [3] server.js:
if exist "server.js" (echo     [OK] υπάρχει) else (echo     [ΣΦΑΛΜΑ] λείπει)
echo.

REM 4. Έλεγχος wrapper
echo [4] _service-wrapper.bat:
if exist "_service-wrapper.bat" (echo     [OK] υπάρχει) else (echo     [ΣΦΑΛΜΑ] λείπει — ξανατρέξτε install)
echo.

REM 5. Έλεγχος Scheduled Task
echo [5] Scheduled Task "%TASK_NAME%":
schtasks /query /tn %TASK_NAME% >nul 2>nul
if errorlevel 1 (echo     [ΣΦΑΛΜΑ] δεν υπάρχει) else (echo     [OK] υπάρχει)
echo.

REM 6. Έλεγχος αν τρέχει node.exe
echo [6] Τρέχει node.exe;
tasklist /fi "imagename eq node.exe" | findstr /i "node.exe" >nul
if errorlevel 1 (echo     [ΠΡΟΣΟΧΗ] κανένα node.exe δεν τρέχει) else (echo     [OK] τρέχει)
echo.

REM 7. Έλεγχος port
echo [7] Port %CHECK_PORT%:
netstat -ano | findstr ":%CHECK_PORT%" | findstr "LISTENING" >nul
if errorlevel 1 (echo     [ΠΡΟΣΟΧΗ] δεν ακούει κανείς) else (echo     [OK] ακούει)
echo.

pause
```

---

## 7. start.bat

```bat
@echo off
chcp 737 >nul
title MyApp - Manual Start (debugging)
cd /d "%~dp0"

REM Manual run για debugging (χωρίς service).
REM Δείχνει live console output.

set "NODE_EXE=node"
if exist "%ProgramFiles%\nodejs\node.exe" set "NODE_EXE=%ProgramFiles%\nodejs\node.exe"

echo Εκκίνηση MyApp...
echo Πατήστε Ctrl+C για τερματισμό.
echo.

"%NODE_EXE%" server.js
pause
```

---

## 8. CUSTOMIZATION CHECKLIST

Για να προσαρμόσεις σε νέο project, αντικατέστησε:

| Placeholder | Τι αντικαθιστά | Παράδειγμα |
|---|---|---|
| `MyApp`           | Display name (φαίνεται σε titles, messages)        | `My Inventory System` |
| `MyAppService`    | Όνομα scheduled task (no spaces, ASCII only)       | `MyInventoryService`  |
| `3000`            | Port που ακούει η εφαρμογή                         | `8080`                |
| `server.js`       | Entry point του project                            | `app.js`, `index.js`  |
| `node-v20-x64.msi`| Όνομα MSI που κατεβαίνει                           | (κρατήστε ως έχει)    |
| `node-v20.18.0`   | Έκδοση Node που κατεβαίνει                         | (ενημέρωσε αν θες)    |

**Search & replace σε όλα τα `.bat`:**

```cmd
MyApp           → [Όνομα project σου]
MyAppService    → [TaskNameWithoutSpaces]
3000            → [πόρτα σου]
server.js       → [entry point σου]
```

---

## 9. ENCODING & LINE ENDINGS

Τα `.bat` αρχεία ΠΡΕΠΕΙ να σωθούν σε:

- **Κωδικοποίηση**: CP737 (DOS Greek) — για να εμφανίζονται σωστά τα ελληνικά στο CMD που τρέχει με `chcp 737`.
- **Line endings**: CRLF (Windows) — αλλιώς CMD μπερδεύει multi-line commands.

### Αν τα γράφεις σε editor

- **Notepad++**: Encoding → CP737 (Greek MS-DOS), EOL → Windows (CR LF)
- **VS Code**: bottom right → click on encoding → Save with Encoding → cp737 (μπορεί να χρειαστεί extension)
- **Linux/Mac/WSL**: γράψε σε UTF-8 και μετάτρεψε:

```bash
iconv -f UTF-8 -t CP737 input.bat | sed 's/$/\r/' > output.bat
```

### Έλεγχος encoding

```bash
file output.bat
# Πρέπει να βγάλει: "DOS batch file, Non-ISO extended-ASCII text, with CRLF line terminators"
```

### Εναλλακτική: μόνο αγγλικά

Αν δεν θες ελληνικά εκτύπωση, παράλειψε το `chcp 737` και γράψε όλα τα messages στα αγγλικά. Τότε το αρχείο μπορεί να μείνει σε ASCII / UTF-8 χωρίς προβλήματα.

---

## 10. ΣΥΧΝΑ ΠΡΟΒΛΗΜΑΤΑ

### «`.` was unexpected at this time» στο CMD

**Αιτία**: παρενθέσεις μέσα σε `echo` εντός `if (...)` block.

**Λύση**: χρησιμοποίησε `goto` labels αντί για nested if-blocks. Παράδειγμα:

```bat
REM ΚΑΚΟ:
if errorlevel 1 (
    echo Failed (try again).
)

REM ΣΩΣΤΟ:
if errorlevel 1 goto FAIL
goto OK
:FAIL
echo Failed - try again.
goto END
:OK
echo Success.
:END
```

### Το service δεν ξεκινάει στο boot

- Επαλήθευσε ότι το task είναι ως SYSTEM (`/ru "SYSTEM"`) και HIGHEST run level.
- Δοκίμασε `schtasks /query /tn YourTask /v` για να δεις τη ρύθμιση «Run As User».
- Αν δείχνει το current user account αντί για SYSTEM, ξανατρέξε το installer ως admin.

### Το `npm install` αργεί ή κολλάει

Προσθέστε `--no-audit --no-fund` flags και ενδεχομένως registry URL:

```bat
call npm install --production --no-audit --no-fund --registry=https://registry.npmjs.org/
```

### Auto-elevation loop (το script ζητάει admin σε άπειρο loop)

**Αιτία**: η UAC καλεί το script ως νέο process, που πάλι ζητάει admin. Συνήθως σπάει αν ο χρήστης ακυρώσει το UAC prompt.

**Λύση**: πρόσθεσε ένα flag check:

```bat
if "%~1"=="ELEVATED" goto MAIN
net session >nul 2>nul
if errorlevel 1 (
    powershell -Command "Start-Process '%~f0' -ArgumentList 'ELEVATED' -Verb RunAs"
    exit /b
)
:MAIN
```

### Το MSI download απέτυχε

- Antivirus / firewall μπλοκάρει το PowerShell `Invoke-WebRequest`.
- **Λύση Α**: temporary disable του real-time protection.
- **Λύση Β**: pre-place το `node-v20-x64.msi` στον φάκελο της εφαρμογής με χειροκίνητο download. Ο installer θα δει ότι υπάρχει και θα παρακάμψει το download (αν έχεις προσθέσει το `if exist` check στον installer).

### Multiple node.exe processes

Αν τρέχει `manage-service.bat → Stop` αλλά συνεχίζει να τρέχει κάποιο node.exe, συνήθως είναι ένα δεύτερο instance. Το `:LOOP` block στο `_service-wrapper.bat` ξεκινάει νέο node.exe κάθε 5 sec αν crash-άρει. Για clean stop:

```bat
schtasks /end /tn MyAppService
timeout /t 2 /nobreak >nul
taskkill /F /IM node.exe
```

**Σημείωση**: `taskkill /F /IM node.exe` τερματίζει **ΟΛΑ** τα node.exe — αν τρέχουν άλλα Node projects στο ίδιο PC, θα τα σκοτώσει. Για selective kill, χρησιμοποίησε PID:

```bat
for /f "tokens=2 delims=," %%i in ('tasklist /fi "imagename eq node.exe" /v /fo csv ^| findstr /i "MyAppService"') do (
    taskkill /F /PID %%~i
)
```

### Εμφανίζονται «κουτάκια» αντί για ελληνικά στο CMD

**Αιτία**: το CMD δεν είναι σε CP737 ή το αρχείο δεν είναι σε CP737.

**Λύση**: βεβαιώσου ότι:
1. Πρώτη γραμμή του `.bat` είναι `chcp 737 >nul`
2. Το ίδιο το αρχείο `.bat` είναι κωδικοποιημένο σε CP737 (όχι UTF-8)

Έλεγχος στη γραμμή εντολών:

```cmd
chcp
```

Πρέπει να βγάλει: `Active code page: 737`.

### Service τρέχει αλλά η εφαρμογή δεν ανταποκρίνεται

- Έλεγξε αν ακούει στη σωστή πόρτα: `netstat -ano | findstr LISTENING | findstr :3000`
- Έλεγξε αν Windows Firewall μπλοκάρει την πόρτα:
  ```cmd
  netsh advfirewall firewall add rule name="MyApp" dir=in action=allow protocol=TCP localport=3000
  ```
- Έλεγξε logs (αν η εφαρμογή σου γράφει σε `logs/`)

---

## ΕΠΕΚΤΑΣΕΙΣ (Προαιρετικά)

### Auto-update mechanism

Πρόσθεσε `auto-update.bat` που:

1. Κατεβάζει νέα έκδοση ZIP από URL σου
2. Σταματάει το service
3. Αντικαθιστά τα αρχεία (εκτός `data/`, `config.xml`)
4. Ξεκινάει ξανά το service

### PWA install button

Αν το web UI της εφαρμογής σου υποστηρίζει PWA (manifest.json + service worker), οι χρήστες μπορούν να το «εγκαταστήσουν» ως desktop app από Chrome/Edge.

### License lock (machine fingerprint)

Για να εμποδίσεις casual copying σε άλλο PC, πρόσθεσε στο `server.js`:

```javascript
const { enforceMachineLock } = require('./lib/license');
enforceMachineLock(); // exit αν δεν ταιριάζει με αδειοδοτημένο hardware
```

Το `lib/license.js` υπολογίζει fingerprint από:

- Windows MachineGuid (registry)
- BIOS UUID (wmic / PowerShell)
- Volume Serial του C:
- Hostname

Με tolerant 3-of-4 matching και dev-mode bypass μέσω `.dev-mode` file στο root του project.

### Auto-start browser

Στο `install-windows-service.bat`, μετά τη δημιουργία του service, μπορείς να δημιουργήσεις και shortcut στο Windows Startup folder ώστε ο browser να ανοίγει αυτόματα όταν κάνει login κάποιος χρήστης:

```bat
set "STARTUP=%ProgramData%\Microsoft\Windows\Start Menu\Programs\StartUp"
(
echo [InternetShortcut]
echo URL=http://localhost:3000/
) > "%STARTUP%\MyApp.url"
```

---

## ΛΙΣΤΑ ΕΛΕΓΧΟΥ ΠΡΙΝ ΤΟ DEPLOY

- [ ] Έχω αλλάξει `MyApp`, `MyAppService`, port, server.js σε όλα τα .bat
- [ ] Τα .bat είναι σε CP737 + CRLF (ή ASCII αν δεν χρειάζεσαι ελληνικά)
- [ ] Έχω `package.json` με σωστό `main` ή `server.js` ως entry point
- [ ] Έχω δοκιμάσει `start.bat` (manual run) και η εφαρμογή τρέχει
- [ ] Έχω αφαιρέσει `node_modules/` και test files από το ZIP
- [ ] Έχω συμπεριλάβει `package-lock.json` για deterministic install
- [ ] Έχω δοκιμάσει σε καθαρό Windows PC χωρίς προεγκατεστημένο Node.js
- [ ] Έχω γράψει `ΟΔΗΓΙΕΣ-ΕΓΚΑΤΑΣΤΑΣΗΣ.txt` για τον τελικό χρήστη
- [ ] Έχω ελέγξει ότι το service ξεκινάει σωστά μετά από reboot

---

## ΓΡΗΓΟΡΟΣ ΟΔΗΓΟΣ ΓΙΑ ΝΕΟ PROJECT

1. Αντίγραψε τα 5 .bat templates από εδώ στο root του project σου
2. Search & replace `MyApp`, `MyAppService`, port στα `.bat`
3. Σιγουρέψου ότι το `server.js` (ή ό,τι entry point έχεις) είναι στο root
4. Σιγουρέψου ότι το `package.json` έχει τις εξαρτήσεις σου
5. Μετάτρεψε τα `.bat` σε CP737 + CRLF (αν θες ελληνικά)
6. Φτιάξε το deployment ZIP (χωρίς `node_modules`)
7. Test σε καθαρό Windows VM
8. Deploy!

---

**Συντάκτης**: Alpha ΠΛΗΡΟΦΟΡΙΚΗ Α.Ε. — https://axd.gr
**Έκδοση**: 1.0 (Ιούνιος 2026)
**Άδεια χρήσης**: Internal use — Alpha ΠΛΗΡΟΦΟΡΙΚΗ
