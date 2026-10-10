# Used by number_files.bat. Renames downloaded files (SaveClip.App_..., IMG_...,
# VID_..., anything not already a plain number) in every media\NN folder to
# 1, 2, 3... in the order they were downloaded. Files that already have a plain
# number keep it, and new ones continue after the highest number. Nothing is
# deleted, and *.preview.jpg files are left alone. Folders that already have a
# manifest.json (already set up for the site) are skipped entirely.
$ErrorActionPreference = 'Stop'
$root = Join-Path $PSScriptRoot '..\media'
$mediaExt = @('.jpg', '.jpeg', '.png', '.webp', '.gif', '.mp4', '.webm', '.mov', '.m4v')
$total = 0

foreach ($dir in (Get-ChildItem -LiteralPath $root -Directory | Sort-Object Name)) {
    if (Test-Path -LiteralPath (Join-Path $dir.FullName 'manifest.json')) { continue }
    $files = @(Get-ChildItem -LiteralPath $dir.FullName -File | Where-Object {
        ($mediaExt -contains $_.Extension.ToLower()) -and ($_.Name -notlike '*.preview.*')
    })
    $numbered = @($files | Where-Object { $_.BaseName -match '^\d+$' })
    $todo = @($files | Where-Object { $_.BaseName -notmatch '^\d+$' } | Sort-Object LastWriteTime, Name)
    if ($todo.Count -eq 0) { continue }

    $next = 1
    if ($numbered.Count -gt 0) {
        $next = ($numbered | ForEach-Object { [int]$_.BaseName } | Measure-Object -Maximum).Maximum + 1
    }
    foreach ($f in $todo) {
        $newName = "$next$($f.Extension.ToLower())"
        Rename-Item -LiteralPath $f.FullName -NewName $newName
        Write-Host ("  media\{0}\{1}   (was {2})" -f $dir.Name, $newName, $f.Name)
        $next++
        $total++
    }
}

Write-Host ''
Write-Host "Renamed $total file(s)."
