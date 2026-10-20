Option Explicit
Dim fs, folder, executable, runner
Set fs = CreateObject("Scripting.FileSystemObject")
folder = fs.GetParentFolderName(WScript.ScriptFullName)
executable = fs.BuildPath(folder, "native\dist\MirrorPanel-win32-x64\MirrorPanel.exe")
If Not fs.FileExists(executable) Then
  MsgBox "MirrorPanel 2.0 nao foi empacotado. Execute npm run package na pasta do projeto.", 48, "MirrorPanel"
  WScript.Quit 1
End If
Set runner = CreateObject("WScript.Shell")
runner.Run Chr(34) & executable & Chr(34), 1, False
