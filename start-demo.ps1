# MindSpace Stage 8 — One-Command Local Demonstration & Setup Script
#
# Usage:
#   .\start-demo.ps1

Write-Host "============================================================" -ForegroundColor Cyan
Write-Host "   MINDSPACE STAGE 8 — ZERO-EXTERNAL-DEPENDENCY SETUP" -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan

# 1. Check Node.js
Write-Host "`n[1/5] Checking Node.js environment..." -ForegroundColor Yellow
try {
    $nodeVer = node -v
    Write-Host "  ✔ Node.js installed: $nodeVer" -ForegroundColor Green
} catch {
    Write-Host "  ✖ Node.js is required (v20+ recommended). Please install Node.js." -ForegroundColor Red
    exit 1
}

# 2. Check Python
Write-Host "`n[2/5] Checking Python environment..." -ForegroundColor Yellow
$pyPath = "apps/api/.venv312/Scripts/python.exe"
if (-not (Test-Path $pyPath)) {
    $pyPath = "python"
}
try {
    $pyVer = & $pyPath --version
    Write-Host "  ✔ Python runtime: $pyVer" -ForegroundColor Green
} catch {
    Write-Host "  ✖ Python 3.12 is required. Please install Python or set up .venv312." -ForegroundColor Red
    exit 1
}

# 3. Database Initialization & Demo Seeding
Write-Host "`n[3/5] Initializing local database and seeding demo records..." -ForegroundColor Yellow
try {
    $env:PYTHONPATH = "apps/api"
    & $pyPath apps/api/scripts/db_admin.py migrate
    & $pyPath apps/api/scripts/db_admin.py seed
    Write-Host "  ✔ Database schema verified and demo records seeded." -ForegroundColor Green
} catch {
    Write-Host "  ✖ Database initialization warning: $_" -ForegroundColor DarkYellow
}

# 4. Build Chrome Extension
Write-Host "`n[4/5] Compiling unpacked Chrome Extension (MV3 Side Panel)..." -ForegroundColor Yellow
try {
    npm run build:extension
    Write-Host "  ✔ Extension built cleanly into 'dist-extension/'" -ForegroundColor Green
} catch {
    Write-Host "  ✖ Extension build failed: $_" -ForegroundColor Red
    exit 1
}

# 5. Ready to Run Instructions
Write-Host "`n[5/5] Setup Complete! Zero-Cloud Local Demo is Ready." -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host "`nTo start the MindSpace services:" -ForegroundColor White
Write-Host "  Terminal 1 (Backend API, Port 8010):" -ForegroundColor Gray
Write-Host "    `$env:PORT = '8010'; `$env:PYTHONPATH = 'apps/api'; & '$pyPath' -m app.main" -ForegroundColor White
Write-Host "`n  Terminal 2 (Web UI, Port 8080):" -ForegroundColor Gray
Write-Host "    npm run dev" -ForegroundColor White
Write-Host "`nTo load the extension in Google Chrome:" -ForegroundColor White
Write-Host "  1. Navigate to chrome://extensions" -ForegroundColor Gray
Write-Host "  2. Enable Developer mode (top right)" -ForegroundColor Gray
Write-Host "  3. Click 'Load unpacked' and select:" -ForegroundColor Gray
Write-Host "     $(Get-Location)\dist-extension" -ForegroundColor Yellow
Write-Host "  4. Press Alt+B on any tab to open MindSpace." -ForegroundColor Gray
Write-Host "`nTo execute the Multi-Agent Live Walkthrough:" -ForegroundColor White
Write-Host "    npm run demo" -ForegroundColor Green
Write-Host "============================================================`n" -ForegroundColor Cyan

