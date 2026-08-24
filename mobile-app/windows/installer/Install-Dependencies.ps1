# Silently installs the Microsoft-signed VCLibs/WinUI redistributable .appx
# packages the unpackaged setalink.exe needs (VCRUNTIME140_1_APP.DLL /
# MSVCP140_APP.DLL come from these). Run by the installer's [Run] step,
# pointed at its own Dependencies\ folder. Kept as a separate file rather
# than an inline Parameters string in RealGram.iss because Inno Setup's
# {constant} syntax collides with PowerShell's { } script blocks in a
# quoted -Command string (confirmed: "Unknown constant" compile error).
param(
    [Parameter(Mandatory = $true)]
    [string]$DependenciesPath
)

Get-ChildItem -Path $DependenciesPath -Filter *.appx | ForEach-Object {
    try {
        Add-AppxPackage -Path $_.FullName -ErrorAction Stop
    } catch {
        if ($_.Exception.Message -notmatch 'already installed|higher version') {
            throw
        }
    }
}
