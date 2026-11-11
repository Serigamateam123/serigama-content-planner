' Serigama Content Planner - silent Windows launcher.
' Runs Start-Planner.ps1 with no console window at all (window style 0), so
' opening the planner from the desktop shortcut shows only the planner itself.
Set fso = CreateObject("Scripting.FileSystemObject")
dir = fso.GetParentFolderName(WScript.ScriptFullName)
CreateObject("WScript.Shell").Run "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File """ & dir & "\Start-Planner.ps1""", 0, False
