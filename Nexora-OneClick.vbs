Set shell = CreateObject("WScript.Shell")
shell.Run """" & Replace(WScript.ScriptFullName, "Nexora-OneClick.vbs", "START-NEXORA.bat") & """", 1, False
