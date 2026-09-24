[CmdletBinding()]
param(
    [string]$PsqlPath = 'C:\Program Files\PostgreSQL\18\bin\psql.exe',
    [string]$EnvironmentPath = '',
    [string]$PublicBaseUrl = 'https://shopee.ninetyfour.fun',
    [string]$ExternalShopId = '1819834906'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

if ([string]::IsNullOrWhiteSpace($EnvironmentPath)) {
    $EnvironmentPath = Join-Path $PSScriptRoot '..\.env'
}

$ExpectedTables = @(
    'organizations',
    'users',
    'memberships',
    'shop_connections',
    'delivery_commands',
    'outbox_events',
    'queue_jobs',
    'scheduled_triggers',
    'dead_letter_jobs',
    'staging_feature_flags',
    'staging_reconciliation_snapshots',
    'oauth_states',
    'credential_subjects',
    'shop_credential_bindings',
    'catalog_collection_runs',
    'catalog_products',
    'catalog_variants',
    'analytics_collection_runs',
    'analytics_metric_snapshots',
    'copy_previews',
    'copy_intents',
    'write_commands',
    'write_attempts',
    'write_recovery_decisions',
    'external_operation_attempts',
    'pilot_workflow_measurements',
    'oauth_grants',
    'oauth_grant_subjects',
    'oauth_grant_subject_shops',
    'oauth_exchange_commands'
)

function Test-NeonDatabaseUrl {
    param([AllowNull()][string]$Value)

    if ([string]::IsNullOrWhiteSpace($Value)) {
        return $false
    }
    $ParsedValue = $null
    $IsAbsolute = [Uri]::TryCreate($Value.Trim(), [UriKind]::Absolute, [ref]$ParsedValue)
    return (
        $IsAbsolute -and
        $ParsedValue.Scheme -in @('postgres', 'postgresql') -and
        $ParsedValue.Host -match '(^|\.)neon\.tech$' -and
        -not [string]::IsNullOrWhiteSpace($ParsedValue.UserInfo) -and
        $ParsedValue.AbsolutePath.Length -gt 1 -and
        -not $Value.Contains("`r") -and
        -not $Value.Contains("`n")
    )
}

function Read-NeonDatabaseUrl {
    Add-Type -AssemblyName System.Windows.Forms
    Add-Type -AssemblyName System.Drawing

    $ClipboardValue = [System.Windows.Forms.Clipboard]::GetText().Trim()
    if (Test-NeonDatabaseUrl -Value $ClipboardValue) {
        [System.Windows.Forms.Clipboard]::Clear()
        Write-Host 'DATABASE_URL_SOURCE=CLIPBOARD'
        Write-Host 'CLIPBOARD_CLEARED=PASS'
        return $ClipboardValue
    }

    $Form = New-Object System.Windows.Forms.Form
    $Form.Text = 'Shopee Management - Neon Production Setup'
    $Form.StartPosition = 'CenterScreen'
    $Form.ClientSize = New-Object System.Drawing.Size(720, 190)
    $Form.FormBorderStyle = 'FixedDialog'
    $Form.MaximizeBox = $false
    $Form.MinimizeBox = $false

    $Instruction = New-Object System.Windows.Forms.Label
    $Instruction.Location = New-Object System.Drawing.Point(20, 18)
    $Instruction.Size = New-Object System.Drawing.Size(680, 45)
    $Instruction.Text = 'Paste Neon production DATABASE_URL. Nilai disamarkan dan tidak ditulis ke log.'
    $Form.Controls.Add($Instruction)

    $InputBox = New-Object System.Windows.Forms.TextBox
    $InputBox.Location = New-Object System.Drawing.Point(20, 72)
    $InputBox.Size = New-Object System.Drawing.Size(680, 28)
    $InputBox.UseSystemPasswordChar = $true
    $Form.Controls.Add($InputBox)

    $OkButton = New-Object System.Windows.Forms.Button
    $OkButton.Location = New-Object System.Drawing.Point(520, 125)
    $OkButton.Size = New-Object System.Drawing.Size(85, 32)
    $OkButton.Text = 'Jalankan'
    $OkButton.DialogResult = [System.Windows.Forms.DialogResult]::OK
    $Form.AcceptButton = $OkButton
    $Form.Controls.Add($OkButton)

    $CancelButton = New-Object System.Windows.Forms.Button
    $CancelButton.Location = New-Object System.Drawing.Point(615, 125)
    $CancelButton.Size = New-Object System.Drawing.Size(85, 32)
    $CancelButton.Text = 'Batal'
    $CancelButton.DialogResult = [System.Windows.Forms.DialogResult]::Cancel
    $Form.CancelButton = $CancelButton
    $Form.Controls.Add($CancelButton)

    $Form.Add_Shown({ $InputBox.Focus() })
    $Result = $Form.ShowDialog()
    $Value = $InputBox.Text.Trim()
    $InputBox.Clear()
    $Form.Dispose()

    if ($Result -ne [System.Windows.Forms.DialogResult]::OK) {
        throw 'Setup dibatalkan oleh pengguna.'
    }
    if (-not (Test-NeonDatabaseUrl -Value $Value)) {
        throw 'DATABASE_URL tidak valid. Copy ulang connection string Neon dan jalankan setup sekali lagi.'
    }
    Write-Host 'DATABASE_URL_SOURCE=MASKED_DIALOG'
    return $Value
}

function Read-DotEnv {
    param([Parameter(Mandatory)][string]$Path)

    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        throw "File environment tidak ditemukan: $Path"
    }

    $Values = @{}
    foreach ($Line in Get-Content -LiteralPath $Path) {
        if ($Line -notmatch '^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$') {
            continue
        }
        $Name = $Matches[1]
        $Value = $Matches[2].Trim()
        if (
            $Value.Length -ge 2 -and
            (($Value.StartsWith('"') -and $Value.EndsWith('"')) -or
             ($Value.StartsWith("'") -and $Value.EndsWith("'")))
        ) {
            $Value = $Value.Substring(1, $Value.Length - 2)
        }
        $Values[$Name] = $Value
    }
    return $Values
}

function Get-RequiredEnvironmentValue {
    param(
        [Parameter(Mandatory)][hashtable]$Values,
        [Parameter(Mandatory)][string]$Name
    )

    if (-not $Values.ContainsKey($Name) -or [string]::IsNullOrWhiteSpace($Values[$Name])) {
        throw "Value $Name belum tersedia di file .env lokal."
    }
    return [string]$Values[$Name]
}

function Get-QueryValue {
    param(
        [Parameter(Mandatory)][Uri]$Uri,
        [Parameter(Mandatory)][string]$Name
    )

    foreach ($Pair in $Uri.Query.TrimStart('?').Split('&', [System.StringSplitOptions]::RemoveEmptyEntries)) {
        $Parts = $Pair.Split('=', 2)
        if ([Uri]::UnescapeDataString($Parts[0]) -eq $Name) {
            if ($Parts.Count -eq 1) {
                return ''
            }
            return [Uri]::UnescapeDataString($Parts[1].Replace('+', ' '))
        }
    }
    return $null
}

function Invoke-CompatibleWebRequest {
    param(
        [Parameter(Mandatory)][string]$Uri,
        [ValidateSet('Get', 'Post')][string]$Method = 'Get',
        [string]$ContentType,
        [string]$Body,
        [Microsoft.PowerShell.Commands.WebRequestSession]$WebSession
    )

    $RequestParameters = @{
        Uri = $Uri
        Method = $Method
        UseBasicParsing = $true
        ErrorAction = 'Stop'
    }
    if (-not [string]::IsNullOrWhiteSpace($ContentType)) {
        $RequestParameters['ContentType'] = $ContentType
    }
    if ($PSBoundParameters.ContainsKey('Body')) {
        $RequestParameters['Body'] = $Body
    }
    if ($null -ne $WebSession) {
        $RequestParameters['WebSession'] = $WebSession
    }

    try {
        return Invoke-WebRequest @RequestParameters
    }
    catch {
        $ExceptionProperties = @($_.Exception.PSObject.Properties.Name)
        if ($ExceptionProperties -notcontains 'Response' -or $null -eq $_.Exception.Response) {
            throw
        }
        $Response = $_.Exception.Response
        return [pscustomobject]@{
            StatusCode = [int]$Response.StatusCode
            Content = ''
        }
    }
}

if (-not (Test-Path -LiteralPath $PsqlPath -PathType Leaf)) {
    $ResolvedPsql = Get-Command 'psql.exe' -ErrorAction SilentlyContinue
    if ($null -eq $ResolvedPsql) {
        throw 'psql.exe tidak ditemukan. Install PostgreSQL client atau berikan -PsqlPath.'
    }
    $PsqlPath = $ResolvedPsql.Source
}

$DatabaseUrl = $null
$Environment = $null
$LoginToken = $null
$WebSession = $null

try {
    $Environment = Read-DotEnv -Path $EnvironmentPath
    $OrganizationId = Get-RequiredEnvironmentValue -Values $Environment -Name 'INTERNAL_ORGANIZATION_ID'
    $AuthSubject = Get-RequiredEnvironmentValue -Values $Environment -Name 'INTERNAL_AUTH_SUBJECT'
    $LoginToken = Get-RequiredEnvironmentValue -Values $Environment -Name 'INTERNAL_LOGIN_TOKEN'
    $PartnerApplicationId = Get-RequiredEnvironmentValue -Values $Environment -Name 'SHOPEE_PARTNER_APPLICATION_ID'
    $PartnerId = Get-RequiredEnvironmentValue -Values $Environment -Name 'SHOPEE_PARTNER_ID'

    $ParsedOrganizationId = [guid]::Empty
    $ParsedPartnerApplicationId = [guid]::Empty
    $ParsedPublicBaseUrl = $null
    if (-not [guid]::TryParse($OrganizationId, [ref]$ParsedOrganizationId)) {
        throw 'INTERNAL_ORGANIZATION_ID bukan UUID valid.'
    }
    if (-not [guid]::TryParse($PartnerApplicationId, [ref]$ParsedPartnerApplicationId)) {
        throw 'SHOPEE_PARTNER_APPLICATION_ID bukan UUID valid.'
    }
    if ($AuthSubject.Length -gt 255) {
        throw 'INTERNAL_AUTH_SUBJECT melebihi 255 karakter.'
    }
    if ($LoginToken -notmatch '^[A-Za-z0-9_-]{43}$') {
        throw 'INTERNAL_LOGIN_TOKEN tidak valid.'
    }
    if ($PartnerId -notmatch '^[1-9][0-9]*$') {
        throw 'SHOPEE_PARTNER_ID tidak valid.'
    }
    if ($ExternalShopId -notmatch '^[1-9][0-9]*$') {
        throw 'ExternalShopId tidak valid.'
    }
    if (
        -not [Uri]::TryCreate($PublicBaseUrl, [UriKind]::Absolute, [ref]$ParsedPublicBaseUrl) -or
        $ParsedPublicBaseUrl.Scheme -ne 'https' -or
        -not [string]::IsNullOrEmpty($ParsedPublicBaseUrl.UserInfo) -or
        $ParsedPublicBaseUrl.AbsolutePath -ne '/' -or
        -not [string]::IsNullOrEmpty($ParsedPublicBaseUrl.Query) -or
        -not [string]::IsNullOrEmpty($ParsedPublicBaseUrl.Fragment)
    ) {
        throw 'PublicBaseUrl harus berupa origin HTTPS tanpa path, query, atau fragment.'
    }
    $PublicBaseUrl = $ParsedPublicBaseUrl.GetLeftPart([UriPartial]::Authority)
    $Issuer = "$PublicBaseUrl/internal-auth"
    $ExpectedCallbackUri = "$PublicBaseUrl/api/auth/shopee/callback"
    Write-Host 'LOCAL_CONFIGURATION=PASS'

    $DatabaseUrl = Read-NeonDatabaseUrl
    $ParsedDatabaseUrl = $null
    $IsAbsoluteUrl = [Uri]::TryCreate($DatabaseUrl, [UriKind]::Absolute, [ref]$ParsedDatabaseUrl)
    $IsValid =
        $IsAbsoluteUrl -and
        $ParsedDatabaseUrl.Scheme -in @('postgres', 'postgresql') -and
        $ParsedDatabaseUrl.Host -match '(^|\.)neon\.tech$' -and
        -not [string]::IsNullOrWhiteSpace($ParsedDatabaseUrl.UserInfo) -and
        $ParsedDatabaseUrl.AbsolutePath.Length -gt 1 -and
        -not $DatabaseUrl.Contains("`r") -and
        -not $DatabaseUrl.Contains("`n")

    if (-not $IsValid) {
        throw 'DATABASE_URL tidak valid setelah input tervalidasi.'
    }

    Write-Host 'DATABASE_URL_VALID=PASS'

    function Invoke-SafePsql {
        param([Parameter(Mandatory)][string[]]$Arguments)

        $Output = & $PsqlPath "--dbname=$DatabaseUrl" '--no-psqlrc' @Arguments 2>&1
        if ($LASTEXITCODE -ne 0) {
            $SafeOutput = ($Output | Out-String).Trim()
            throw "psql gagal: $SafeOutput"
        }
        return $Output
    }

    function Invoke-SafePsqlScript {
        param(
            [Parameter(Mandatory)][string]$Sql,
            [Parameter(Mandatory)][hashtable]$Variables,
            [switch]$TuplesOnly
        )

        $TemporarySqlPath = Join-Path ([IO.Path]::GetTempPath()) "shopee-production-$([guid]::NewGuid()).sql"
        try {
            [IO.File]::WriteAllText(
                $TemporarySqlPath,
                $Sql,
                [Text.UTF8Encoding]::new($false)
            )
            $PsqlArguments = @('--set=ON_ERROR_STOP=1')
            if ($TuplesOnly) {
                $PsqlArguments += @('--tuples-only', '--no-align')
            }
            foreach ($Entry in $Variables.GetEnumerator()) {
                $PsqlArguments += "--set=$($Entry.Key)=$($Entry.Value)"
            }
            $PsqlArguments += "--file=$TemporarySqlPath"
            return Invoke-SafePsql -Arguments $PsqlArguments
        }
        finally {
            if (Test-Path -LiteralPath $TemporarySqlPath) {
                Remove-Item -LiteralPath $TemporarySqlPath -Force
            }
        }
    }

    $Identity = Invoke-SafePsql -Arguments @(
        '--set=ON_ERROR_STOP=1',
        '--tuples-only',
        '--no-align',
        '--command=select current_database() || ''|'' || current_user;'
    )
    if (@($Identity).Count -ne 1) {
        throw 'Koneksi berhasil tetapi identitas database tidak dapat diverifikasi.'
    }
    Write-Host 'NEON_CONNECTION=PASS'

    $TableValues = $ExpectedTables | ForEach-Object { "('$_')" }
    $TableQuery = @"
SELECT expected.table_name || '=' ||
       CASE WHEN to_regclass('public.' || expected.table_name) IS NULL THEN 'missing' ELSE 'present' END
  FROM (VALUES $($TableValues -join ',')) AS expected(table_name)
 ORDER BY expected.table_name;
"@
    $TableOutput = Invoke-SafePsql -Arguments @(
        '--set=ON_ERROR_STOP=1',
        '--tuples-only',
        '--no-align',
        "--command=$TableQuery"
    )
    $PresentTables = @($TableOutput | Where-Object { $_ -like '*=present' })
    $MissingTables = @($TableOutput | Where-Object { $_ -like '*=missing' })

    Write-Host "SCHEMA_TABLES_PRESENT=$($PresentTables.Count)"
    Write-Host "SCHEMA_TABLES_MISSING=$($MissingTables.Count)"

    if ($MissingTables.Count -eq 0) {
        Write-Host 'MIGRATION_ACTION=SKIP_ALREADY_COMPLETE'
    }
    elseif ($PresentTables.Count -ne 0) {
        $PresentNames = ($PresentTables -replace '=present$', '') -join ','
        $MissingNames = ($MissingTables -replace '=missing$', '') -join ','
        Write-Host 'MIGRATION_STATUS=PARTIAL_BLOCKED'
        Write-Host "PRESENT_TABLES=$PresentNames"
        Write-Host "MISSING_TABLES=$MissingNames"
        throw 'Migration otomatis diblokir karena database bersifat parsial.'
    }
    else {
        Write-Host 'MIGRATION_ACTION=AUTO_APPLY_EMPTY_DATABASE'
        $MigrationRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\db\migrations')).Path
        $Migrations = @(Get-ChildItem -LiteralPath $MigrationRoot -Filter '*.sql' -File | Sort-Object Name)
        if ($Migrations.Count -ne 15) {
            throw "Diharapkan 15 migration, ditemukan $($Migrations.Count)."
        }

        foreach ($Migration in $Migrations) {
            Write-Host "MIGRATION_START=$($Migration.Name)"
            Invoke-SafePsql -Arguments @(
                '--set=ON_ERROR_STOP=1',
                "--file=$($Migration.FullName)"
            ) | Out-Null
            Write-Host "MIGRATION_PASS=$($Migration.Name)"
        }
    }

    $PostMigrationOutput = Invoke-SafePsql -Arguments @(
        '--set=ON_ERROR_STOP=1',
        '--tuples-only',
        '--no-align',
        "--command=$TableQuery"
    )
    $PostMigrationMissing = @($PostMigrationOutput | Where-Object { $_ -like '*=missing' })
    if ($PostMigrationMissing.Count -ne 0) {
        throw "Migration selesai tetapi $($PostMigrationMissing.Count) tabel wajib masih hilang."
    }

    $ColumnQuery = @"
SELECT
  EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'oauth_states' AND column_name = 'market'
  )::text || '|' ||
  EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'oauth_exchange_commands' AND column_name = 'lease_owner'
  )::text || '|' ||
  EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'oauth_exchange_commands' AND column_name = 'shop_id'
  )::text;
"@
    $ColumnResult = Invoke-SafePsql -Arguments @(
        '--set=ON_ERROR_STOP=1',
        '--tuples-only',
        '--no-align',
        "--command=$ColumnQuery"
    )
    if (($ColumnResult | Select-Object -First 1) -ne 'true|true|true') {
        throw 'Migration table lengkap tetapi kolom OAuth 0013-0015 belum lengkap.'
    }

    Write-Host 'MIGRATION_STATUS=COMPLETE'

    $UserId = [guid]::NewGuid().ToString()
    $ShopConnectionId = [guid]::NewGuid().ToString()
    $SeedSql = @'
BEGIN;
INSERT INTO organizations (id, name)
VALUES (:'organization_id', 'Shopee Internal Management')
ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name;

INSERT INTO users (id, oidc_issuer, oidc_subject)
VALUES (:'user_id', :'issuer', :'auth_subject')
ON CONFLICT (oidc_issuer, oidc_subject) DO NOTHING;

INSERT INTO memberships (organization_id, user_id, role, status, authz_revision)
SELECT :'organization_id', users.id, 'owner', 'active', 1
  FROM users
 WHERE users.oidc_issuer = :'issuer'
   AND users.oidc_subject = :'auth_subject'
ON CONFLICT (organization_id, user_id) DO UPDATE SET
  role = 'owner',
  status = 'active',
  authz_revision = memberships.authz_revision + 1,
  revoked_at = NULL;

INSERT INTO shop_connections (
  id,
  organization_id,
  partner_application_id,
  market,
  external_shop_id,
  status
)
VALUES (
  :'shop_connection_id',
  :'organization_id',
  :'partner_application_id',
  'ID',
  :'external_shop_id',
  'active'
)
ON CONFLICT (organization_id, partner_application_id, market, external_shop_id)
DO UPDATE SET status = 'active', disconnected_at = NULL;
COMMIT;
'@
    Invoke-SafePsqlScript -Sql $SeedSql -Variables @{
        organization_id = $OrganizationId
        user_id = $UserId
        issuer = $Issuer
        auth_subject = $AuthSubject
        shop_connection_id = $ShopConnectionId
        partner_application_id = $PartnerApplicationId
        external_shop_id = $ExternalShopId
    } | Out-Null

    $SeedVerificationSql = @'
SELECT
  EXISTS (
    SELECT 1 FROM organizations WHERE id = :'organization_id'
  )::int || '|' ||
  EXISTS (
    SELECT 1
      FROM users
      JOIN memberships ON memberships.user_id = users.id
     WHERE users.oidc_issuer = :'issuer'
       AND users.oidc_subject = :'auth_subject'
       AND memberships.organization_id = :'organization_id'
       AND memberships.role = 'owner'
       AND memberships.status = 'active'
  )::int || '|' ||
  EXISTS (
    SELECT 1
      FROM shop_connections
     WHERE organization_id = :'organization_id'
       AND partner_application_id = :'partner_application_id'
       AND market = 'ID'
       AND external_shop_id = :'external_shop_id'
       AND status = 'active'
  )::int;
'@
    $SeedVerification = Invoke-SafePsqlScript -Sql $SeedVerificationSql -TuplesOnly -Variables @{
        organization_id = $OrganizationId
        issuer = $Issuer
        auth_subject = $AuthSubject
        partner_application_id = $PartnerApplicationId
        external_shop_id = $ExternalShopId
    }
    if (($SeedVerification | Select-Object -First 1) -ne '1|1|1') {
        throw 'Seed selesai tetapi organisasi, owner, atau koneksi toko gagal diverifikasi.'
    }
    Write-Host 'SEED_STATUS=PASS'

    $HealthResponse = Invoke-CompatibleWebRequest -Uri "$PublicBaseUrl/health" -Method Get
    if ($HealthResponse.StatusCode -ne 200) {
        throw "Health endpoint gagal dengan HTTP $($HealthResponse.StatusCode)."
    }
    Write-Host 'HEALTH_STATUS=PASS'

    $ReadyResponse = Invoke-CompatibleWebRequest -Uri "$PublicBaseUrl/ready" -Method Get
    if ($ReadyResponse.StatusCode -ne 200) {
        throw "Ready endpoint gagal dengan HTTP $($ReadyResponse.StatusCode)."
    }
    $ReadyPayload = $ReadyResponse.Content | ConvertFrom-Json
    if ($ReadyPayload.status -ne 'ready' -or $ReadyPayload.dependencies.database.state -ne 'ready') {
        throw 'Ready endpoint HTTP 200 tetapi database belum berstatus ready.'
    }
    Write-Host 'READY_STATUS=PASS'

    $WebSession = New-Object Microsoft.PowerShell.Commands.WebRequestSession
    $LoginBody = @{ loginToken = $LoginToken } | ConvertTo-Json -Compress
    $LoginResponse = Invoke-CompatibleWebRequest `
        -Uri "$PublicBaseUrl/api/session/login" `
        -Method Post `
        -ContentType 'application/json' `
        -Body $LoginBody `
        -WebSession $WebSession
    if ($LoginResponse.StatusCode -ne 204) {
        throw "Session login gagal dengan HTTP $($LoginResponse.StatusCode). Samakan INTERNAL_LOGIN_TOKEN lokal dan Hostinger."
    }
    Write-Host 'SESSION_LOGIN=PASS'

    $OAuthStartUri = "$PublicBaseUrl/api/auth/shopee/start?organizationId=$([Uri]::EscapeDataString($OrganizationId))&partnerApplicationId=$([Uri]::EscapeDataString($PartnerApplicationId))&market=ID"
    $OAuthResponse = Invoke-CompatibleWebRequest `
        -Uri $OAuthStartUri `
        -Method Get `
        -WebSession $WebSession
    if ($OAuthResponse.StatusCode -ne 200) {
        throw "OAuth start gagal dengan HTTP $($OAuthResponse.StatusCode). Periksa log runtime Hostinger tanpa menyalin secret."
    }
    $OAuthPayload = $OAuthResponse.Content | ConvertFrom-Json
    if (
        [string]::IsNullOrWhiteSpace($OAuthPayload.data.authorizationUrl) -or
        [string]::IsNullOrWhiteSpace($OAuthPayload.data.state)
    ) {
        throw 'OAuth start HTTP 200 tetapi authorization URL atau state tidak tersedia.'
    }
    Write-Host 'OAUTH_START=PASS'

    $AuthorizationUri = [Uri]$OAuthPayload.data.authorizationUrl
    if (
        $AuthorizationUri.Scheme -ne 'https' -or
        $AuthorizationUri.Host -ne 'open.shopee.com' -or
        $AuthorizationUri.AbsolutePath -ne '/auth'
    ) {
        throw 'Authorization URL tidak mengarah ke https://open.shopee.com/auth.'
    }
    if ((Get-QueryValue -Uri $AuthorizationUri -Name 'partner_id') -ne $PartnerId) {
        throw 'partner_id pada authorization URL tidak sesuai SHOPEE_PARTNER_ID.'
    }
    Write-Host 'AUTHORIZATION_HOST=PASS'

    $ObservedCallbackUri = Get-QueryValue -Uri $AuthorizationUri -Name 'redirect_uri'
    if ($ObservedCallbackUri -ne $ExpectedCallbackUri) {
        throw "Callback production belum sesuai. Expected=$ExpectedCallbackUri Observed=$ObservedCallbackUri"
    }
    Write-Host 'CALLBACK_URI=PASS'
    Write-Host 'PROVIDER_REQUESTS=0'
    Write-Host 'LIVE_TEST_READY=PASS'
}
finally {
    $DatabaseUrl = $null
    $ParsedDatabaseUrl = $null
    $LoginToken = $null
    $Environment = $null
    $WebSession = $null
}
