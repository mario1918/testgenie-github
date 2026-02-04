Set WshShell = CreateObject("WScript.Shell")
Set objFSO = CreateObject("Scripting.FileSystemObject")

' Get the script directory
strScriptPath = objFSO.GetParentFolderName(WScript.ScriptFullName)

' Show starting message
' MsgBox "Starting TestCaseGenie..." & vbCrLf & vbCrLf & _
'        "Please wait about 15 seconds." & vbCrLf & _
'        "The application will open automatically." & vbCrLf & vbCrLf & _
'        "Click OK to continue.", vbInformation, "TestCaseGenie"

' Start Backend (Node.js) - Hidden
WshShell.Run "cmd /c cd /d """ & strScriptPath & "\bin\system\model\Backend"" && node server.js", 0, False

' Start Angular Frontend - Hidden
WshShell.Run "cmd /c cd /d """ & strScriptPath & "\bin\front\angular-frontend"" && npm start", 0, False

' Start Python Backend - Hidden
WshShell.Run "cmd /c cd /d """ & strScriptPath & "\bin\system\jira\TestGenie-BE"" && call venv\Scripts\activate && py -m uvicorn main:app --host 0.0.0.0 --port 8000 --reload", 0, False

' Wait for servers to start (15 seconds)
WScript.Sleep 15000

' Open TestCaseGenie App Window (HTA) - This will block until window is closed
WshShell.Run """" & strScriptPath & "\TestCaseGenie-App.hta""", 1, True
