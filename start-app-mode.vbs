Set WshShell = CreateObject("WScript.Shell")
Set objFSO = CreateObject("Scripting.FileSystemObject")

' Get the script directory
strScriptPath = objFSO.GetParentFolderName(WScript.ScriptFullName)
strLogFile = strScriptPath & "\startup.log"

' Helper function to write to log file
Sub WriteLog(message)
    On Error Resume Next
    Set objLogFile = objFSO.OpenTextFile(strLogFile, 8, True)
    objLogFile.WriteLine Now & " - " & message
    objLogFile.Close
    On Error Goto 0
End Sub

WriteLog "========== Starting TestCaseGenie (App Mode) =========="
WriteLog "Script path: " & strScriptPath

' Check and install npm dependencies for Angular frontend only if needed
angularNodeModules = strScriptPath & "\bin\front\angular-frontend\node_modules"
If Not objFSO.FolderExists(angularNodeModules) Then
    WriteLog "Running npm install for Angular frontend..."
    npmInstallCmd = "cmd /c cd /d """ & strScriptPath & "\bin\front\angular-frontend"" && npm install >> """ & strLogFile & """ 2>&1"
    npmExitCode = WshShell.Run(npmInstallCmd, 0, True)
    
    ' Check if npm install succeeded
    If npmExitCode <> 0 Then
        WriteLog "ERROR: Angular npm install failed with exit code: " & npmExitCode
        MsgBox "ERROR: Failed to install Angular npm dependencies." & vbCrLf & vbCrLf & _
               "Please check your internet connection and try again." & vbCrLf & _
               "Check startup.log for details.", vbCritical, "TestCaseGenie Error"
        WScript.Quit 1
    Else
        WriteLog "Angular npm install successful"
    End If
Else
    WriteLog "Angular node_modules exists, skipping npm install"
End If

' Check and install npm dependencies for Node.js backend only if needed
backendNodeModules = strScriptPath & "\bin\system\model\Backend\node_modules"
If Not objFSO.FolderExists(backendNodeModules) Then
    WriteLog "Running npm install for Node.js backend..."
    backendNpmInstallCmd = "cmd /c cd /d """ & strScriptPath & "\bin\system\model\Backend"" && npm install >> """ & strLogFile & """ 2>&1"
    backendNpmExitCode = WshShell.Run(backendNpmInstallCmd, 0, True)
    
    ' Check if backend npm install succeeded
    If backendNpmExitCode <> 0 Then
        WriteLog "ERROR: Node.js backend npm install failed with exit code: " & backendNpmExitCode
        MsgBox "ERROR: Failed to install Node.js backend npm dependencies." & vbCrLf & vbCrLf & _
               "Please check your internet connection and try again." & vbCrLf & _
               "Check startup.log for details.", vbCritical, "TestCaseGenie Error"
        WScript.Quit 1
    Else
        WriteLog "Node.js backend npm install successful"
    End If
Else
    WriteLog "Backend node_modules exists, skipping npm install"
End If

' Setup Python virtual environment and install dependencies
WriteLog "Checking Python environment..."
pythonBackendPath = strScriptPath & "\bin\system\jira\TestGenie-BE"
venvPath = pythonBackendPath & "\venv"
Dim needsPipInstall
needsPipInstall = False

' Check if virtual environment exists, create if not
If Not objFSO.FolderExists(venvPath) Then
    WriteLog "Creating Python virtual environment..."
    createVenvCmd = "cmd /c cd /d """ & pythonBackendPath & """ && py -m venv venv >> """ & strLogFile & """ 2>&1"
    createVenvExitCode = WshShell.Run(createVenvCmd, 0, True)
    
    If createVenvExitCode <> 0 Then
        WriteLog "ERROR: Python venv creation failed with exit code: " & createVenvExitCode
        MsgBox "ERROR: Failed to create Python virtual environment." & vbCrLf & vbCrLf & _
               "Please ensure Python is installed correctly." & vbCrLf & _
               "Check startup.log for details.", vbCritical, "TestCaseGenie Error"
        WScript.Quit 1
    Else
        WriteLog "Python venv created successfully"
        needsPipInstall = True
    End If
Else
    WriteLog "Python venv already exists"
End If

' Install Python requirements only if venv is new
If needsPipInstall Then
    WriteLog "Running pip install for Python backend..."
    pipInstallCmd = "cmd /c cd /d """ & pythonBackendPath & """ && call venv\Scripts\activate && pip install -r requirements.txt >> """ & strLogFile & """ 2>&1"
    pipExitCode = WshShell.Run(pipInstallCmd, 0, True)
    
    ' Check if pip install succeeded
    If pipExitCode <> 0 Then
        WriteLog "ERROR: Python pip install failed with exit code: " & pipExitCode
        MsgBox "ERROR: Failed to install Python dependencies." & vbCrLf & vbCrLf & _
               "Please check your internet connection and try again." & vbCrLf & _
               "Check startup.log for details.", vbCritical, "TestCaseGenie Error"
        WScript.Quit 1
    Else
        WriteLog "Python pip install successful"
    End If
Else
    WriteLog "Python dependencies already installed, skipping pip install"
End If

' Show starting message
' MsgBox "Starting TestCaseGenie..." & vbCrLf & vbCrLf & _
'        "Please wait about 15 seconds." & vbCrLf & _
'        "The application will open automatically." & vbCrLf & vbCrLf & _
'        "Click OK to continue.", vbInformation, "TestCaseGenie"

WriteLog "Starting Node.js backend server..."
' Start Backend (Node.js) - Hidden
WshShell.Run "cmd /c cd /d """ & strScriptPath & "\bin\system\model\Backend"" && node server.js", 0, False

WriteLog "Starting Angular frontend server..."
' Start Angular Frontend - Hidden
WshShell.Run "cmd /c cd /d """ & strScriptPath & "\bin\front\angular-frontend"" && npm start", 0, False

WriteLog "Starting Python backend server..."
' Start Python Backend - Hidden
WshShell.Run "cmd /c cd /d """ & strScriptPath & "\bin\system\jira\TestGenie-BE"" && call venv\Scripts\activate && py -m uvicorn main:app --host 0.0.0.0 --port 8000 --reload", 0, False

' Wait for servers to start (15 seconds)
WriteLog "Waiting for servers to start..."
WScript.Sleep 15000

WriteLog "Opening browser in app mode..."
' Try to open in Chrome App Mode (looks like native app)
On Error Resume Next
WshShell.Run "chrome.exe --app=http://localhost:4200 --window-size=1400,900", 1, False
If Err.Number <> 0 Then
    ' If Chrome not found, try Edge App Mode
    WriteLog "Chrome not found, trying Edge..."
    WshShell.Run "msedge.exe --app=http://localhost:4200 --window-size=1400,900", 1, False
    If Err.Number <> 0 Then
        ' Fallback to regular browser
        WriteLog "Edge not found, using default browser..."
        WshShell.Run "http://localhost:4200", 1, False
    End If
End If
On Error Goto 0

WriteLog "All servers started successfully"
WriteLog "========== Startup Complete =========="

' Show control panel for stopping servers
WshShell.Run """" & strScriptPath & "\TestCaseGenie-Control.hta""", 1, True
