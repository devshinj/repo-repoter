# deploy/deploy-remote.ps1 - Transfer files and deploy to remote server via jump host
$ErrorActionPreference = "Stop"

$JUMP_HOST  = "root@112.216.247.186:52000"
$TARGET     = "root@192.168.102.2"
$REMOTE_DIR = "/home/sjs/briify"

$FILES = @(
    "deploy/autobriify.tar.gz"
    "deploy/deploy.sh"
    "deploy/docker-compose.yml"
    "deploy/.env"
)

# Validate all files exist before starting transfer
Write-Host "=== Checking files ===" -ForegroundColor Cyan
foreach ($f in $FILES) {
    if (-not (Test-Path $f)) {
        Write-Host "ERROR: $f not found" -ForegroundColor Red
        if ($f -eq "deploy/.env") {
            Write-Host "  -> Copy deploy/.env.example to deploy/.env and fill in secrets" -ForegroundColor Yellow
        }
        if ($f -like "*.tar.gz") {
            Write-Host "  -> Run 'powershell deploy/build.ps1' first" -ForegroundColor Yellow
        }
        exit 1
    }
}
Write-Host "All files OK" -ForegroundColor Green

# Create remote directory
Write-Host "`n=== Preparing remote directory ===" -ForegroundColor Cyan
ssh -J $JUMP_HOST $TARGET "mkdir -p $REMOTE_DIR"

# Transfer
Write-Host "`n=== Transferring files ===" -ForegroundColor Cyan
$scpArgs = @("-o", "ProxyJump=$JUMP_HOST") + $FILES + @("${TARGET}:${REMOTE_DIR}/")
scp @scpArgs
if ($LASTEXITCODE -ne 0) { throw "scp failed" }
Write-Host "Transfer complete" -ForegroundColor Green

# Deploy
Write-Host "`n=== Deploying on remote ===" -ForegroundColor Cyan
ssh -J $JUMP_HOST $TARGET "cd $REMOTE_DIR && sed -i 's/\r$//' deploy.sh docker-compose.yml .env && bash deploy.sh"
if ($LASTEXITCODE -ne 0) { throw "Remote deploy failed" }

Write-Host "`n=== Deployment finished ===" -ForegroundColor Green
