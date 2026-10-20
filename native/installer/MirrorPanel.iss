; MirrorPanel installer (Inno Setup 6). Built by scripts/installer.mjs, which
; packages the app and passes AppVersion, FileVersion and SourceDir.

#ifndef AppVersion
  #error Build with npm run installer
#endif
; The 1.x installer wrote AppId={{7C1B...}} and Inno keeps the closing "}}"
; as part of the value, so the doubled brace must stay. With the same AppId
; this installer replaces 1.x in place: same folder, same entry in the list
; of installed apps. Tests override AppId and AppName.
#ifndef AppId
  #define AppId "{{7C1B2F1A-9B3E-4E5A-9B0E-4C6D6A1B7E10}}"
#endif
#ifndef AppName
  #define AppName "MirrorPanel"
#endif

[Setup]
AppId={#AppId}
AppName={#AppName}
AppVersion={#AppVersion}
AppVerName={#AppName} {#AppVersion}
AppPublisher=MirrorPanel
AppPublisherURL=https://github.com/syhhw/MirrorPanel
AppSupportURL=https://github.com/syhhw/MirrorPanel/issues
VersionInfoVersion={#FileVersion}
DefaultDirName={autopf}\{#AppName}
; Per-user install without UAC. Command-line overrides stay possible for
; managed installs; the 1.x updater passes /CURRENTUSER.
PrivilegesRequired=lowest
PrivilegesRequiredOverridesAllowed=commandline
DisableProgramGroupPage=yes
UninstallDisplayIcon={app}\MirrorPanel.exe
SetupIconFile=..\design\logo\mirrorpanel.ico
OutputBaseFilename=MirrorPanel-Setup-{#AppVersion}
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
CloseApplications=yes

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"
Name: "brazilianportuguese"; MessagesFile: "compiler:Languages\BrazilianPortuguese.isl"

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"

[InstallDelete]
; The 1.x Python runtime and installer marker, and the previous version's
; Electron files, so no stale file survives an update. Settings live in
; %APPDATA%\MirrorPanel and the 1.x settings.json next to the exe is kept.
Type: filesandordirs; Name: "{app}\_internal"
Type: files; Name: "{app}\installer_language.marker"
Type: filesandordirs; Name: "{app}\resources"
Type: filesandordirs; Name: "{app}\locales"
; The 1.x Start menu folder; this version adds a single shortcut instead.
Type: filesandordirs; Name: "{autoprograms}\{#AppName}"

[Files]
Source: "{#SourceDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{autoprograms}\{#AppName}"; Filename: "{app}\MirrorPanel.exe"
Name: "{autodesktop}\{#AppName}"; Filename: "{app}\MirrorPanel.exe"; Tasks: desktopicon

#ifndef NoLaunch
[Run]
; No skipifsilent: a silent update should reopen the app. Tests pass NoLaunch.
Filename: "{app}\MirrorPanel.exe"; Description: "{cm:LaunchProgram,{#AppName}}"; Flags: nowait postinstall
#endif
