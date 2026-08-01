; Script do instalador do MirrorPanel (Inno Setup).
; Para gerar o instalador: compile este arquivo com o ISCC.exe (Inno Setup Compiler)
; depois de rodar o PyInstaller em modo --onedir (pasta dist\MirrorPanel).

#define MyAppName "MirrorPanel"
#define MyAppVersion "1.2.0-3"
#define MyAppPublisher "MirrorPanel"
#define MyAppExeName "MirrorPanel.exe"
; Pasta gerada pelo PyInstaller --onedir (troque se o seu caminho for diferente)
; Caminhos daqui pra baixo sao relativos a ESTE arquivo (dentro de installer/agora) -
; dist/ e installer_output/ continuam na raiz do projeto, por isso o "..\".
#define MyDistDir "..\dist\MirrorPanel"

[Setup]
AppId={{7C1B2F1A-9B3E-4E5A-9B0E-4C6D6A1B7E10}}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
DefaultDirName={autopf}\{#MyAppName}
DefaultGroupName={#MyAppName}
AllowNoIcons=yes
; Sem exigir admin, sem perguntar nada sobre isso (como VS Code/Discord/Chrome) -
; {autopf} vira a pasta de programas do proprio usuario quando nao elevado.
; So "commandline" (sem "dialog"): continua dando pra forcar instalacao para
; todos os usuarios via linha de comando (deploy corporativo), mas nunca mostra
; aquela tela perguntando "so pra mim ou para todos" - decisao tecnica que a
; imensa maioria dos usuarios nao sabe (nem precisa) responder.
PrivilegesRequired=lowest
PrivilegesRequiredOverridesAllowed=commandline
LicenseFile=TERMOS_INSTALADOR.txt
OutputDir=..\installer_output
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
; LicenseFile por idioma - sem isso, o texto dos Termos de Uso ficava sempre em
; portugues mesmo escolhendo English na tela de idioma (so a INTERFACE do
; instalador - Next/Cancel etc. - seguia o idioma escolhido; o LicenseFile do
; [Setup] e um arquivo fixo unico, a menos que cada idioma sobrescreva o dele).
Name: "brazilianportuguese"; MessagesFile: "compiler:Languages\BrazilianPortuguese.isl"; LicenseFile: "TERMOS_INSTALADOR.txt"
Name: "english"; MessagesFile: "compiler:Default.isl"; LicenseFile: "TERMOS_INSTALADOR_EN.txt"

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
; Abre o MirrorPanel ao final da instalacao. Numa instalacao normal isso vira
; uma caixa de selecao marcada por padrao na tela final; numa instalacao
; silenciosa (usada pela propria atualizacao automatica do programa) roda
; direto, sem tela nenhuma - SEM "skipifsilent" de proposito, porque e
; justamente na atualizacao silenciosa que precisamos reabrir o programa
; sozinho (sem isso, o usuario tinha que abrir manualmente depois de atualizar).
Filename: "{app}\{#MyAppExeName}"; Description: "{cm:LaunchProgram,{#MyAppName}}"; Flags: nowait postinstall

[Code]
// Liga o idioma escolhido no PROPRIO instalador ao idioma inicial do programa -
// antes os dois eram totalmente independentes (o instalador so usava a escolha
// pra si mesmo - assistente, Termos de Uso - e o programa sempre detectava o
// idioma do Windows sozinho, ignorando o que foi escolhido aqui).
//
// NAO escreve direto em settings.json (uma tentativa anterior fazia isso, e
// so o gerava se ele ainda nao existisse - o que soava seguro, mas na pratica
// significava que so a PRIMEIRA instalacao aplicava a escolha; reinstalar por
// cima, que e o caso normal, sempre ignorava o idioma escolhido aqui). Em vez
// disso, grava so um marcador simples - o proprio programa (mirror_engine.py,
// apply_installer_language_marker) le esse arquivo, MESCLA o idioma dentro do
// settings.json de verdade (sem apagar apelidos/Wi-Fi salvos/outras
// preferencias ja gravadas) e apaga o marcador em seguida. Grava TODA vez que
// o instalador roda (instalacao nova ou reinstalacao) - a pessoa esta
// escolhendo o idioma na tela agora mesmo, entao a escolha de agora e a que
// vale, mesmo numa reinstalacao.
procedure CurStepChanged(CurStep: TSetupStep);
var
  LangCode: string;
begin
  if CurStep = ssPostInstall then
  begin
    if ActiveLanguage = 'brazilianportuguese' then
      LangCode := 'pt'
    else
      LangCode := 'en';
    SaveStringToFile(ExpandConstant('{app}\installer_language.marker'), LangCode, False);
  end;
end;
