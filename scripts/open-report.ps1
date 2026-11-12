# Opens the Playwright HTML report.
# If a report server is already running on port 9323, just opens the browser to it
# (it always serves the latest report) instead of failing with EADDRINUSE.
# Run: npm run report
$port = 9323
$url = "http://localhost:$port"
$listener = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1

if ($listener) {
    $proc = Get-CimInstance Win32_Process -Filter "ProcessId=$($listener.OwningProcess)"
    if ($proc.CommandLine -like '*show-report*') {
        Write-Host "Report server already running - opening $url (refresh the page to see the latest run)."
        Start-Process $url
        exit 0
    }
    Write-Host "Port $port is used by another program (PID $($listener.OwningProcess)). Opening the report on port 9324 instead."
    npx playwright show-report --port 9324
    exit $LASTEXITCODE
}

Write-Host "Starting report server at $url (press Ctrl+C to stop it)."
npx playwright show-report --port $port
