# Zips the latest Playwright HTML report into reports\test-report_<date>.zip
# Run: npm run report:zip
$stamp = Get-Date -Format 'yyyy-MM-dd_HHmm'
New-Item -ItemType Directory -Force reports | Out-Null
$zip = "reports\test-report_$stamp.zip"
Compress-Archive -Path 'playwright-report\*' -DestinationPath $zip -Force
$mb = [math]::Round((Get-Item $zip).Length / 1MB, 1)
Write-Host "Saved $zip ($mb MB)"
