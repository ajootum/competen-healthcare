# COMPETEN-DIG-001 proof of concept: the independent reference. PowerPoint's own object model says what each slide holds,
# so no engine under test is marking its own work. Opens the deck read-only, in a window (charts and SmartArt need one), and
# writes a JSON file and one PNG per slide into the output folder. The deck is never saved. Local only, nothing leaves this PC.
param([Parameter(Mandatory)][string]$Deck, [Parameter(Mandatory)][string]$Out, [switch]$Pictures)
$ErrorActionPreference = 'Stop'
New-Item -ItemType Directory -Force -Path $Out | Out-Null
$pp = New-Object -ComObject PowerPoint.Application
$pres = $pp.Presentations.Open((Resolve-Path $Deck).Path, -1, 0, -1)

function Read-Shape($s, $depth) {
  $o = [ordered]@{ id = $s.Id; name = $s.Name; type = [int]$s.Type; left = [double]$s.Left; top = [double]$s.Top; width = [double]$s.Width; height = [double]$s.Height; depth = $depth; alt = "$($s.AlternativeText)" }
  if ($s.Type -eq 6) {
    $o.children = @(); foreach ($g in $s.GroupItems) { $o.children += ,(Read-Shape $g ($depth + 1)) }
    return $o
  }
  if ($s.HasTable) {
    $t = $s.Table; $rows = @()
    for ($r = 1; $r -le $t.Rows.Count; $r++) {
      $cells = @(); for ($c = 1; $c -le $t.Columns.Count; $c++) { $cells += "$($t.Cell($r, $c).Shape.TextFrame.TextRange.Text)" }
      $rows += ,$cells
    }
    $o.table = $rows
  }
  if ($s.HasChart) {
    $ch = $s.Chart; $o.chart = [ordered]@{ title = $(if ($ch.HasTitle) { "$($ch.ChartTitle.Text)" } else { "" }); series = @() }
    foreach ($i in 1..$ch.SeriesCollection().Count) {
      $se = $ch.SeriesCollection($i)
      $o.chart.series += ,([ordered]@{ name = "$($se.Name)"; categories = @($se.XValues | ForEach-Object { "$_" }); values = @($se.Values | ForEach-Object { "$_" }) })
    }
  }
  if ($s.HasSmartArt) {
    $o.smartart = @(); foreach ($n in $s.SmartArt.AllNodes) { $o.smartart += "$($n.TextFrame2.TextRange.Text)" }
  }
  if ($s.HasTextFrame -and $s.TextFrame.HasText) {
    $o.text = "$($s.TextFrame.TextRange.Text)"
  }
  try { if ($s.Type -eq 14) { $o.placeholder = [int]$s.PlaceholderFormat.Type } } catch { }
  return $o
}

$slides = @()
foreach ($sl in $pres.Slides) {
  $shapes = @(); foreach ($s in $sl.Shapes) { $shapes += ,(Read-Shape $s 0) }
  $notes = ""
  if ($sl.HasNotesPage) { foreach ($s in $sl.NotesPage.Shapes) { if ($s.Type -eq 14 -and $s.PlaceholderFormat.Type -eq 2 -and $s.HasTextFrame) { $notes = "$($s.TextFrame.TextRange.Text)" } } }
  $slides += ,([ordered]@{ index = $sl.SlideIndex; slideId = $sl.SlideID; hidden = [bool]$sl.SlideShowTransition.Hidden; shapes = $shapes; notes = $notes })
  if ($Pictures) { $sl.Export((Join-Path (Resolve-Path $Out).Path ("slide-{0:d2}.png" -f $sl.SlideIndex)), "PNG", 1920, 1080) }
}
$doc = [ordered]@{ slides = $slides; width = $pres.PageSetup.SlideWidth; height = $pres.PageSetup.SlideHeight }
$json = $doc | ConvertTo-Json -Depth 20
[IO.File]::WriteAllText((Join-Path (Resolve-Path $Out).Path "reference.json"), $json, (New-Object Text.UTF8Encoding($false)))
$pres.Close()
if ($pp.Presentations.Count -eq 0) { $pp.Quit() }
"slides: $($slides.Count)"
