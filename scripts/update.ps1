#Requires -Version 5.1
# Keep argument handling in the CLI so usage errors share its JSON/exit contract.
$ErrorActionPreference = "Stop"
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$tool = Join-Path $here "..\tools\paperclip-ru.mjs"
$names = @{
  '-version' = '--release-version'; '-installdir' = '--install-dir'
  '-serverdir' = '--server-dir'; '-sourcedir' = '--source-dir'
  '-repo' = '--repo'; '-assetname' = '--asset'; '-dryrun' = '--dry-run'
  '-json' = '--json'; '-skipapply' = '--skip-apply'
}
$mapped = @()
foreach ($argument in $args) {
  $key = [string]$argument
  $lowerKey = $key.ToLowerInvariant()
  if ($names.ContainsKey($lowerKey)) { $mapped += $names[$lowerKey] }
  elseif ($lowerKey -in @('-noninteractive', '-keepbaselineonconflict')) { }
  else { $mapped += $key }
}
& node $tool "update" @mapped
exit $LASTEXITCODE
