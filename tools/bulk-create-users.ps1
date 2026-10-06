# Creates a Cognito account for everyone listed in tools\people.csv.
# CSV columns: rank,name,email,phone,driver,appointment,al,oil,phol,total_leave_balance,total_duties,mc_count
#   rank: LTA, WO2, SGT1, SGT2, CPL or LCP   driver: Yes or No   appointment: FF, SC, RC or DRC
#   al, oil, phol: numbers (blank = 0).   mc_count: a whole number (blank = 0). total_leave_balance and total_duties may be left blank:
#   they are then worked out as AL + OIL + PHOL, and that total divided by 2.
# Login ID is the email. Everyone gets the same temporary password below and
# must choose their own at first sign-in.
# Balances are saved to the Member table when you give -MemberTable (DynamoDB console, Tables, "Member-...-NONE").
# Run from your project root:
#   Sandbox (reads amplify_outputs.json):  .\tools\bulk-create-users.ps1
#   LIVE (the deployed app):               .\tools\bulk-create-users.ps1 -PoolId ap-southeast-1_AbCdEfGhI -Region ap-southeast-1
# Needs: AWS CLI installed and signed in (aws configure) to the AWS account that owns the user pool.

param(
  [string]$PoolId,   # the live user pool ID. Leave out to use the sandbox from amplify_outputs.json
  [string]$Region,
  [string]$MemberTable   # the Member table name. Leave out to create accounts only and skip the balances
)

# Min 8 characters with an uppercase letter, a lowercase letter, a number and a symbol.
$tempPassword = "Fire@Temp2026"

if ($PoolId -and $Region) {
  $pool   = $PoolId
  $region = $Region
  Write-Host "LIVE pool: $pool ($region)" -ForegroundColor Cyan
} else {
  $outputs = Get-Content .\amplify_outputs.json -Raw | ConvertFrom-Json
  $pool    = $outputs.auth.user_pool_id
  $region  = $outputs.auth.aws_region
  Write-Host "SANDBOX pool: $pool ($region)" -ForegroundColor Yellow
}

# Stop early, with a clear message, if the AWS CLI is missing or not signed in.
if (-not (Get-Command aws -ErrorAction SilentlyContinue)) {
  Write-Host "The AWS CLI was not found. Install it (winget install Amazon.AWSCLI), then CLOSE and reopen this window and try again." -ForegroundColor Red
  exit 1
}
aws sts get-caller-identity 2>&1 | Out-Null
if ($LASTEXITCODE -ne 0) {
  Write-Host "The AWS CLI is not signed in. Run 'aws configure' first, then try again." -ForegroundColor Red
  exit 1
}

# Keeps only normal printable characters and trims the ends.
function Clean($text) { return (($text + "") -replace "[^\x20-\x7E]", "").Trim() }

# Reads a number from the CSV. Blank means 0. Returns $null if it is not a number.
function Num($text) {
  $t = Clean $text
  if ($t -eq "") { return [double]0 }
  $d = 0.0
  if ([double]::TryParse($t, [Globalization.NumberStyles]::Float, [Globalization.CultureInfo]::InvariantCulture, [ref]$d)) { return $d }
  return $null
}
function Fmt($d) { return ([double]$d).ToString([Globalization.CultureInfo]::InvariantCulture) }

if ($MemberTable) { Write-Host "Balances table: $MemberTable" } else { Write-Host "No balances table given: balances will be skipped" -ForegroundColor Yellow }

$ok = 0
$failed = @()

foreach ($p in (Import-Csv .\tools\people.csv)) {
  # Strip hidden characters (zero-width spaces, odd spaces) that sneak in when pasting from Excel, Word or chat.
  $email = (Clean $p.email).ToLower()
  $rank  = (Clean $p.rank) -replace "[^A-Za-z0-9]", ""   # "SGT 1" and "sgt-1" both become SGT1
  $rank  = $rank.ToUpper()
  $name  = ($p.name -replace "[\u200B-\u200D\uFEFF\u00A0]", " ").Trim()
  $phone = (Clean $p.phone) -replace "[\s-]", ""
  $driverText = (Clean $p.driver).ToLower()
  $isDriver = $driverText -in "yes", "y"
  $appt = ((Clean $p.appointment) -replace "[^A-Za-z]", "").ToUpper()

  $al = Num $p.al; $oil = Num $p.oil; $phol = Num $p.phol
  $tlb = Num $p.total_leave_balance; $tduty = Num $p.total_duties
  $mc = Num $p.mc_count

  # 8-digit Singapore numbers get +65 added automatically.
  if ($phone -match "^\d{8}$") { $phone = "+65$phone" }

  if ($rank -notin "LTA", "WO2", "SGT1", "SGT2", "CPL", "LCP") {
    Write-Host "SKIP $email - rank '$rank' must be LTA, WO2, SGT1, SGT2, CPL or LCP" -ForegroundColor Yellow
    $failed += "$email (bad rank)"; continue
  }
  if ($driverText -notin "yes", "y", "no", "n") {
    Write-Host "SKIP $email - driver '$($p.driver)' must be Yes or No" -ForegroundColor Yellow
    $failed += "$email (bad driver value)"; continue
  }
  if ($appt -notin "FF", "SC", "RC", "DRC") {
    Write-Host "SKIP $email - appointment '$($p.appointment)' must be FF, SC, RC or DRC" -ForegroundColor Yellow
    $failed += "$email (bad appointment)"; continue
  }
  if ($phone -notmatch "^\+\d{8,15}$") {
    Write-Host "SKIP $email - phone '$($p.phone)' is not valid" -ForegroundColor Yellow
    $failed += "$email (bad phone)"; continue
  }

  if ($null -in @($al, $oil, $phol, $tlb, $tduty, $mc)) {
    Write-Host "SKIP $email - AL, OIL, PHOL and the totals must be numbers" -ForegroundColor Yellow
    $failed += "$email (bad number)"; continue
  }
  if ($mc -lt 0 -or $mc -ne [math]::Floor($mc)) {
    Write-Host "SKIP $email - mc_count must be a whole number" -ForegroundColor Yellow
    $failed += "$email (bad MC count)"; continue
  }
  # Blank totals are worked out: total = AL + OIL + PHOL, duties = total / 2.
  if ((Clean $p.total_leave_balance) -eq "") { $tlb = $al + $oil + $phol }
  if ((Clean $p.total_duties) -eq "") { $tduty = $tlb / 2 }

  Write-Host "Creating $rank $name <$email>..."
  $out = aws cognito-idp admin-create-user --user-pool-id $pool --region $region `
    --username $email `
    --user-attributes "Name=email,Value=$email" "Name=email_verified,Value=true" `
                      "Name=name,Value=$name" "Name=phone_number,Value=$phone" "Name=phone_number_verified,Value=true" `
    --temporary-password $tempPassword --message-action SUPPRESS 2>&1 | Out-String
  if ($LASTEXITCODE -ne 0) {
    if ($out -notmatch "UsernameExistsException") {
      Write-Host "FAILED $email - $out" -ForegroundColor Red
      $failed += $email; continue
    }
    # Account already exists: update details and rank only. Their password is NOT touched.
    Write-Host "  already exists, updating name, phone and rank (password unchanged)"
    aws cognito-idp admin-update-user-attributes --user-pool-id $pool --region $region --username $email `
      --user-attributes "Name=name,Value=$name" "Name=phone_number,Value=$phone" "Name=phone_number_verified,Value=true" | Out-Null
  }

  # Everyone goes in their rank group. LTA and WO2 are KAH and can approve leave.
  aws cognito-idp admin-add-user-to-group --user-pool-id $pool --region $region `
    --username $email --group-name $rank | Out-Null
  if ($LASTEXITCODE -ne 0) { $failed += "$email (group)"; continue }

  # Drivers are also in the DRIVER group. Re-running with "No" removes them from it.
  if ($isDriver) {
    aws cognito-idp admin-add-user-to-group --user-pool-id $pool --region $region `
      --username $email --group-name DRIVER | Out-Null
    if ($LASTEXITCODE -ne 0) { $failed += "$email (driver group)"; continue }
  } else {
    aws cognito-idp admin-remove-user-from-group --user-pool-id $pool --region $region `
      --username $email --group-name DRIVER 2>&1 | Out-Null
  }

  # Appointment: in the chosen APPT_ group, out of the other three (so re-running with a change works).
  $apptOk = $true
  foreach ($a in "FF", "SC", "RC", "DRC") {
    if ($a -eq $appt) {
      aws cognito-idp admin-add-user-to-group --user-pool-id $pool --region $region `
        --username $email --group-name "APPT_$a" | Out-Null
      if ($LASTEXITCODE -ne 0) { $apptOk = $false }
    } else {
      aws cognito-idp admin-remove-user-from-group --user-pool-id $pool --region $region `
        --username $email --group-name "APPT_$a" 2>&1 | Out-Null
    }
  }
  if (-not $apptOk) { $failed += "$email (appointment group)"; continue }

  # Balances: one row per person in the Member table, keyed by their email so a re-run updates it.
  if ($MemberTable) {
    $now = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ss.000Z", [Globalization.CultureInfo]::InvariantCulture)
    $item = @{
  id = @{ S = $email }; __typename = @{ S = "Member" }; name = @{ S = $name }; email = @{ S = $email }
  rank = @{ S = $rank }
  mcCount = @{ N = (Fmt $mc) }; al = @{ N = (Fmt $al) }; oil = @{ N = (Fmt $oil) }; phol = @{ N = (Fmt $phol) }
  totalLeaveBalance = @{ N = (Fmt $tlb) }; totalDuties = @{ N = (Fmt $tduty) }
  createdAt = @{ S = $now }; updatedAt = @{ S = $now }
} | ConvertTo-Json -Depth 5
    $file = Join-Path $env:TEMP "member-item.json"
    [IO.File]::WriteAllText($file, $item, (New-Object Text.UTF8Encoding $false))
    $out = aws dynamodb put-item --table-name $MemberTable --region $region --item "file://$file" 2>&1 | Out-String
    if ($LASTEXITCODE -ne 0) {
      Write-Host "FAILED balances for $email - $out" -ForegroundColor Red
      $failed += "$email (balances)"; continue
    }
  }
  $ok++
}

Write-Host "`nDone. Created or updated: $ok"
if ($failed.Count) { Write-Host "Failed: $($failed -join ', ')" -ForegroundColor Red }