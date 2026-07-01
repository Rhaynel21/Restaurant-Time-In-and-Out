' Launches run-bridge.cmd completely hidden (no console window).
' Registered to run at logon by the "QuiHikvisionBridge" scheduled task.
Dim shell, here
Set shell = CreateObject("WScript.Shell")
here = CreateObject("Scripting.FileSystemObject").GetParentFolderName(WScript.ScriptFullName)
shell.CurrentDirectory = here
shell.Run """" & here & "\run-bridge.cmd""", 0, False
