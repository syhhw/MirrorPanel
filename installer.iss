; Script do instalador do MirrorPanel (Inno Setup).
; Para gerar o instalador: compile este arquivo com o ISCC.exe (Inno Setup Compiler)
; depois de rodar o PyInstaller em modo --onedir (pasta dist\MirrorPanel).

#define MyAppName "MirrorPanel"
#define MyAppVersion "1.0.0-2"
#define MyAppPublisher "MirrorPanel"
#define MyAppExeName "MirrorPanel.exe"
; Pasta gerada pelo PyInstaller --onedir (troque se o seu caminho for diferente)
#define MyDistDir "dist\MirrorPanel"

[Setup]
AppId={{7C1B2F1A-9B3E-4E5A-9B0E-4C6D6A1B7E10}}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
DefaultDirName={autopf}\{#MyAppName}
DefaultGroupName={#MyAppName}
AllowNoIcons=yes
; Sem exigir admin por padrao (como VS Code/Discord) - {autopf} vira a pasta
; de programas do proprio usuario quando nao elevado. Dialog deixa escolher
; "so pra mim" (sem UAC) ou "para todos os usuarios" (com UAC) na instalacao.
PrivilegesRequired=lowest
PrivilegesRequiredOverridesAllowed=commandline dialog
LicenseFile=TERMOS_INSTALADOR.txt
OutputDir=installer_output
OutputBaseFilename=MirrorPanel-Setup
SetupIconFile=mirrorpanel.ico
UninstallDisplayIcon={app}\{#MyAppExeName}
Compression=lzma
SolidCompression=yes
WizardStyle=modern
ArchitecturesInstallIn64BitMode=x64compatible
DisableProgramGroupPage=yes

[Languages]
; Portugues listado primeiro = idioma padrao/pre-selecionado na tela de escolha.
; Com mais de um idioma aqui, o Inno Setup mostra essa tela sozinho, sem codigo extra.
Name: "brazilianportuguese"; MessagesFile: "compiler:Languages\BrazilianPortuguese.isl"
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
; Caixa de selecao "Criar atalho na Area de Trabalho" (desmarcada = usuario decide)
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"

[Files]
; Copia a pasta INTEIRA gerada pelo PyInstaller (exe + _internal com DLLs/adb/scrcpy)
; recursesubdirs + createallsubdirdirs garantem que a estrutura de pastas seja preservada
Source: "{#MyDistDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
; Atalho no Menu Iniciar (sempre criado)
Name: "{group}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"
Name: "{group}\Desinstalar {#MyAppName}"; Filename: "{uninstallexe}"
; Atalho na Area de Trabalho (so se o usuario marcar a caixa acima)
Name: "{autodesktop}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; Tasks: desktopicon

[Run]
; Caixa de selecao "Abrir o MirrorPanel" ao final da instalacao
Filename: "{app}\{#MyAppExeName}"; Description: "{cm:LaunchProgram,{#MyAppName}}"; Flags: nowait postinstall skipifsilent
