# deploy/build.ps1 - Build and export Docker images for deployment
$ErrorActionPreference = "Stop"

Write-Host "=== Building app image ===" -ForegroundColor Cyan
docker build --platform linux/amd64 --target runner -t autobriify:latest -f deploy/Dockerfile .
if ($LASTEXITCODE -ne 0) { throw "App build failed" }

Write-Host "=== Building migrator image ===" -ForegroundColor Cyan
docker build --platform linux/amd64 --target migrator -t autobriify-migrator:latest -f deploy/Dockerfile .
if ($LASTEXITCODE -ne 0) { throw "Migrator build failed" }

Write-Host "=== Saving images ===" -ForegroundColor Cyan

function Save-DockerImageGzip([string]$ImageName, [string]$OutputFile) {
    $tarFile = $OutputFile -replace '\.gz$', ''
    docker save $ImageName -o $tarFile
    if ($LASTEXITCODE -ne 0) { throw "docker save failed for $ImageName" }

    $inStream = [System.IO.File]::OpenRead($tarFile)
    $outStream = [System.IO.File]::Create($OutputFile)
    $gzip = [System.IO.Compression.GZipStream]::new($outStream, [System.IO.Compression.CompressionLevel]::Optimal)
    $inStream.CopyTo($gzip)
    $gzip.Dispose(); $outStream.Dispose(); $inStream.Dispose()
    Remove-Item $tarFile
}

Save-DockerImageGzip "autobriify:latest" "deploy/autobriify.tar.gz"
Save-DockerImageGzip "autobriify-migrator:latest" "deploy/autobriify-migrator.tar.gz"

Write-Host "=== Done ===" -ForegroundColor Green
Write-Host "Output:"
Get-Item deploy/autobriify*.tar.gz | Format-Table Name, @{N="Size(MB)";E={[math]::Round($_.Length/1MB,1)}}
