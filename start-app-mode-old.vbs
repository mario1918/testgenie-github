Set WshShell = CreateObject("WScript.Shell")
Set objFSO = CreateObject("Scripting.FileSystemObject")

' Get the script directory
strScriptPath = objFSO.GetParentFolderName(WScript.ScriptFullName)

' Install npm dependencies for Angular frontend (hidden)
npmInstallCmd = "cmd /c cd /d """ & strScriptPath & "\bin\front\angular-frontend"" && npm install"
npmExitCode = WshShell.Run(npmInstallCmd, 0, True)

' Check if npm install succeeded
If npmExitCode <> 0 Then
    MsgBox "ERROR: Failed to install npm dependencies." & vbCrLf & vbCrLf & _
           "Please check your internet connection and try again.", vbCritical, "TestCaseGenie Error"
    WScript.Quit 1
End If

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

' Try to open in Chrome App Mode (looks like native app)
On Error Resume Next
WshShell.Run "chrome.exe --app=http://localhost:4200 --window-size=1400,900", 1, False
If Err.Number <> 0 Then
    ' If Chrome not found, try Edge App Mode
    WshShell.Run "msedge.exe --app=http://localhost:4200 --window-size=1400,900", 1, False
    If Err.Number <> 0 Then
        ' Fallback to regular browser
        WshShell.Run "http://localhost:4200", 1, False
    End If
End If
On Error Goto 0

' Show control panel for stopping servers
WshShell.Run """" & strScriptPath & "\TestCaseGenie-Control.hta""", 1, True
