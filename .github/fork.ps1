try {
    $r = Invoke-RestMethod -Uri 'https://api.github.com/repos/tdevid523-bot/orangechat/forks' -Method Post -UseBasicParsing
    Write-Host "Fork created: $($r.full_name)"
} catch {
    Write-Host $_.Exception.Message
}
