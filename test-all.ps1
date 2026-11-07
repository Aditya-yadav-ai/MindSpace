# MindSpace Stage 8 — One-Command Comprehensive Test Runner
#
# Usage:
#   .\test-all.ps1

Write-Host "============================================================" -ForegroundColor Cyan
Write-Host "     MINDSPACE STAGE 8 — FULL SUITE VERIFICATION RUNNER" -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan

$pyPath = "apps/api/.venv312/Scripts/python.exe"
if (-not (Test-Path $pyPath)) { $pyPath = "python" }

# 1. Google Workspace Tests
Write-Host "`n[1/5] Running Google Workspace Service Tests..." -ForegroundColor Yellow
npm run test:google
if ($LASTEXITCODE -ne 0) { Write-Host "Google tests failed!" -ForegroundColor Red; exit 1 }

# 2. Chrome Extension Browser Tests
Write-Host "`n[2/5] Running Headless Chrome Extension Tests..." -ForegroundColor Yellow
npm run test:extension
if ($LASTEXITCODE -ne 0) { Write-Host "Extension tests failed!" -ForegroundColor Red; exit 1 }

# 3. Python Backend Pytest Suite
Write-Host "`n[3/5] Running Python FastAPI & Multi-Agent Tests..." -ForegroundColor Yellow
$env:PYTHONPATH = "apps/api"
& $pyPath -m pytest apps/api/tests/test_gap_analysis_hardening.py apps/api/tests/test_jwt_and_multitenancy.py apps/api/tests/test_production_security_hardening.py apps/api/tests/test_api_v1.py -v
if ($LASTEXITCODE -ne 0) { Write-Host "Backend tests failed!" -ForegroundColor Red; exit 1 }

# 4. Multi-Agent Demonstration Walkthrough
Write-Host "`n[4/5] Executing 8-Step Multi-Agent Live Walkthrough..." -ForegroundColor Yellow
& $pyPath apps/api/scripts/demo_walkthrough.py
if ($LASTEXITCODE -ne 0) { Write-Host "Multi-agent walkthrough failed!" -ForegroundColor Red; exit 1 }

# 5. ESLint Code Standards
Write-Host "`n[5/5] Checking Code Standards & Linting..." -ForegroundColor Yellow
npm run lint
if ($LASTEXITCODE -ne 0) { Write-Host "Linting failed!" -ForegroundColor Red; exit 1 }

Write-Host "`n============================================================" -ForegroundColor Green
Write-Host "     ALL TEST SUITES PASSED CLEANLY (100% PASS RATE)     " -ForegroundColor Green
Write-Host "============================================================`n" -ForegroundColor Green
