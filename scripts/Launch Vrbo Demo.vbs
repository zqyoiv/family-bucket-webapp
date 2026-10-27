' Double-click launcher for the Vrbo dual-monitor demo.
'   vrbo-left  -> 2nd display to the right of the main screen
'   vrbo-right -> 1st display to the right of the main screen
Option Explicit

Dim shell, fso, scriptDir, ps1, cmd, exitCode
Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)
ps1 = scriptDir & "\launch-vrbo-demo.ps1"

If Not fso.FileExists(ps1) Then
  MsgBox "Missing launch-vrbo-demo.ps1 next to this launcher.", vbCritical, "Vrbo Demo"
  WScript.Quit 1
End If

' Show a minimized console so failures are not completely invisible.
' Exit code is checked; PowerShell also shows a MessageBox on error.
cmd = "powershell.exe -NoProfile -ExecutionPolicy Bypass -File """ & ps1 & """"
exitCode = shell.Run(cmd, 7, True)

If exitCode <> 0 Then
  MsgBox "Launch failed (exit " & exitCode & ")." & vbCrLf & vbCrLf & _
         "Check log:" & vbCrLf & _
         shell.ExpandEnvironmentStrings("%TEMP%\vrbo-demo-launch.log"), _
         vbCritical, "Vrbo Demo"
  WScript.Quit exitCode
End If
