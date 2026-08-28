$ports = 3008, 3000
foreach ($port in $ports) {
    try {
        $r = Invoke-WebRequest -Uri "http://localhost:$port" -UseBasicParsing -TimeoutSec 10
        Write-Output "PORT $port STATUS=$($r.StatusCode)"
    } catch {
        Write-Output "PORT $port ERR=$($_.Exception.Message)"
    }
}