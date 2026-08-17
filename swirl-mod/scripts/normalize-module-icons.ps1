param(
    [Parameter(Mandatory = $true)] [string] $Manifest,
    [Parameter(Mandatory = $true)] [string] $OutputDirectory,
    [string] $ContactSheet
)

Add-Type -AssemblyName System.Drawing
$entries = Get-Content -LiteralPath $Manifest | ConvertFrom-Json
New-Item -ItemType Directory -Force -Path $OutputDirectory | Out-Null

foreach ($entry in $entries) {
    $source = [Drawing.Bitmap]::FromFile([string]$entry.path)
    try {
        $left = $source.Width
        $top = $source.Height
        $right = -1
        $bottom = -1
        for ($y = 0; $y -lt $source.Height; $y += 2) {
            for ($x = 0; $x -lt $source.Width; $x += 2) {
                $pixel = $source.GetPixel($x, $y)
                $light = ($pixel.R + $pixel.G + $pixel.B) / 3
                if ($light -ge 250) {
                    $left = [Math]::Min($left, $x)
                    $top = [Math]::Min($top, $y)
                    $right = [Math]::Max($right, $x)
                    $bottom = [Math]::Max($bottom, $y)
                }
            }
        }
        if ($right -lt $left -or $bottom -lt $top) { throw "No white artwork found in $($entry.path)" }

        $logical = New-Object Drawing.Bitmap 64, 64, ([Drawing.Imaging.PixelFormat]::Format32bppArgb)
        try {
            $logical.SetResolution(96, 96)
            $artSize = 52
            $artLeft = 6
            $artTop = 6
            $sourceWidth = $right - $left + 1
            $sourceHeight = $bottom - $top + 1
            $scale = [Math]::Min($artSize / $sourceWidth, $artSize / $sourceHeight)
            $drawWidth = [Math]::Max(1, [int][Math]::Round($sourceWidth * $scale))
            $drawHeight = [Math]::Max(1, [int][Math]::Round($sourceHeight * $scale))
            $destLeft = $artLeft + [int][Math]::Floor(($artSize - $drawWidth) / 2)
            $destTop = $artTop + [int][Math]::Floor(($artSize - $drawHeight) / 2)

            for ($dy = 0; $dy -lt $drawHeight; $dy++) {
                for ($dx = 0; $dx -lt $drawWidth; $dx++) {
                    $sx0 = $left + [int][Math]::Floor($dx * $sourceWidth / $drawWidth)
                    $sy0 = $top + [int][Math]::Floor($dy * $sourceHeight / $drawHeight)
                    $sx1 = $left + [int][Math]::Ceiling(($dx + 1) * $sourceWidth / $drawWidth) - 1
                    $sy1 = $top + [int][Math]::Ceiling(($dy + 1) * $sourceHeight / $drawHeight) - 1
                    $best = 0
                    for ($sy = $sy0; $sy -le $sy1; $sy += [Math]::Max(1, [int](($sy1 - $sy0 + 1) / 3))) {
                        for ($sx = $sx0; $sx -le $sx1; $sx += [Math]::Max(1, [int](($sx1 - $sx0 + 1) / 3))) {
                            $p = $source.GetPixel([Math]::Min($sx, $source.Width - 1), [Math]::Min($sy, $source.Height - 1))
                            $light = ($p.R + $p.G + $p.B) / 3
                            $alpha = [Math]::Max(0, [Math]::Min(255, [int][Math]::Round(($light - 248) * 36.5)))
                            $best = [Math]::Max($best, $alpha)
                        }
                    }
                    if ($best -gt 0) { $logical.SetPixel($destLeft + $dx, $destTop + $dy, [Drawing.Color]::FromArgb($best, 255, 255, 255)) }
                }
            }

            $output = New-Object Drawing.Bitmap 256, 256, ([Drawing.Imaging.PixelFormat]::Format32bppArgb)
            try {
                for ($ly = 0; $ly -lt 64; $ly++) {
                    for ($lx = 0; $lx -lt 64; $lx++) {
                        $pixel = $logical.GetPixel($lx, $ly)
                        if ($pixel.A -eq 0) { continue }
                        $white = [Drawing.Color]::FromArgb($pixel.A, 255, 255, 255)
                        for ($oy = 0; $oy -lt 4; $oy++) {
                            for ($ox = 0; $ox -lt 4; $ox++) { $output.SetPixel($lx * 4 + $ox, $ly * 4 + $oy, $white) }
                        }
                    }
                }
                $target = Join-Path $OutputDirectory ($entry.id + '.png')
                $output.Save($target, [Drawing.Imaging.ImageFormat]::Png)
            } finally { $output.Dispose() }
        } finally { $logical.Dispose() }
    } finally { $source.Dispose() }
}

if ($ContactSheet) {
    $sheet = New-Object Drawing.Bitmap 1024, 1024, ([Drawing.Imaging.PixelFormat]::Format32bppArgb)
    try {
        $graphics = [Drawing.Graphics]::FromImage($sheet)
        try {
            $graphics.Clear([Drawing.Color]::FromArgb(255, 8, 9, 10))
            $graphics.InterpolationMode = [Drawing.Drawing2D.InterpolationMode]::NearestNeighbor
            for ($index = 0; $index -lt $entries.Count; $index++) {
                $icon = [Drawing.Bitmap]::FromFile((Join-Path $OutputDirectory ($entries[$index].id + '.png')))
                try {
                    $column = $index % 6
                    $row = [int][Math]::Floor($index / 6)
                    $x = 24 + $column * 168
                    $y = 24 + $row * 168
                    $graphics.DrawImage($icon, [Drawing.Rectangle]::new($x + 28, $y + 4, 112, 112))
                    $graphics.DrawString([string]$entries[$index].id, [Drawing.Font]::new('Consolas', 11), [Drawing.Brushes]::White, $x + 8, $y + 124)
                } finally { $icon.Dispose() }
            }
        } finally { $graphics.Dispose() }
        New-Item -ItemType Directory -Force -Path (Split-Path -Parent $ContactSheet) | Out-Null
        $sheet.Save($ContactSheet, [Drawing.Imaging.ImageFormat]::Png)
    } finally { $sheet.Dispose() }
}
