param([string[]]$Versions = @('6.0', '7.0'))
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot

function Invoke-Docker {
    $output = & docker @args
    if ($LASTEXITCODE -ne 0) { throw "Docker failed: $($args[0])" }
    return $output
}

foreach ($version in $Versions) {
    if ($version -notin @('6.0', '7.0')) { throw 'Only disposable WordPress 6.0 and 7.0 targets are supported.' }
    $phpVersion = if ($version -eq '6.0') { '7.4' } else { '8.3' }
    $image = "wordpress:$version-php$phpVersion-apache"
    foreach ($debug in @('0', '1')) {
        $id = 'semd-smoke-' + [Guid]::NewGuid().ToString('N').Substring(0, 12)
        $db = "$id-db"
        $wp = "$id-wp"
        $networkCreated = $false
        $dbCreated = $false
        $wpCreated = $false
        try {
            $null = Invoke-Docker network create $id
            $networkCreated = $true
            $null = Invoke-Docker run -d --name $db --network $id -e MARIADB_ALLOW_EMPTY_ROOT_PASSWORD=1 -e MARIADB_DATABASE=wordpress mariadb:11.8
            $dbCreated = $true
            $null = Invoke-Docker run -d --name $wp --network $id -p '127.0.0.1::80' `
                -e "WORDPRESS_DB_HOST=$db" -e WORDPRESS_DB_USER=root -e WORDPRESS_DB_PASSWORD= -e WORDPRESS_DB_NAME=wordpress `
                -e SIMPLE_EXPORT_MD_AUDIT=1 -e "SIMPLE_EXPORT_MD_SCRIPT_DEBUG=$debug" `
                -e 'WORDPRESS_CONFIG_EXTRA=define(''SCRIPT_DEBUG'', getenv(''SIMPLE_EXPORT_MD_SCRIPT_DEBUG'') === ''1'');' `
                --mount "type=bind,source=$root,target=/var/www/html/wp-content/plugins/simple-export-md,readonly" $image
            $wpCreated = $true
            $binding = Invoke-Docker port $wp '80/tcp'
            $url = 'http://' + $binding.Trim()
            $ready = $false
            for ($attempt = 0; $attempt -lt 60; $attempt++) {
                & docker exec $db mariadb-admin ping --silent 2>$null | Out-Null
                if ($LASTEXITCODE -eq 0) {
                    try { $null = Invoke-WebRequest -Uri "$url/wp-login.php" -UseBasicParsing -TimeoutSec 3; $ready = $true; break } catch {}
                }
                Start-Sleep -Seconds 1
            }
            if (-not $ready) { throw "Disposable WordPress did not start: $version" }
            Invoke-Docker exec $wp php /var/www/html/wp-content/plugins/simple-export-md/scripts/wordpress-fixture.php $url
            & node (Join-Path $PSScriptRoot 'wordpress-export-md.js') $url
            if ($LASTEXITCODE -ne 0) { throw "Gutenberg smoke failed: WordPress $version, SCRIPT_DEBUG=$debug" }
        } finally {
            # Only containers created by this invocation are removed; no existing environment is touched.
            if ($wpCreated) { & docker rm -f -v $wp | Out-Null }
            if ($dbCreated) { & docker rm -f -v $db | Out-Null }
            if ($networkCreated) { & docker network rm $id | Out-Null }
        }
    }
}
