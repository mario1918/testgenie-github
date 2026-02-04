Set WshShell = CreateObject("WScript.Shell")
Set objFSO = CreateObject("Scripting.FileSystemObject")

' Get the script directory
strScriptPath = objFSO.GetParentFolderName(WScript.ScriptFullName)
strStatusFile = strScriptPath & "\bin\front\status.txt"
strLogFile = strScriptPath & "\startup.log"

' Helper function to write to log file
Sub WriteLog(message)
    On Error Resume Next
    Set objLogFile = objFSO.OpenTextFile(strLogFile, 8, True)
    objLogFile.WriteLine Now & " - " & message
    objLogFile.Close
    On Error Goto 0
End Sub

' Helper function to update status
Sub UpdateStatus(message)
    Set objFile = objFSO.CreateTextFile(strStatusFile, True)
    objFile.WriteLine message
    objFile.Close
    WriteLog message
End Sub

WriteLog "========== Starting TestCaseGenie =========="
WriteLog "Script path: " & strScriptPath

' Update status: Checking for updates
UpdateStatus "Checking for updates..."
WScript.Sleep 500

' First, check if we have local uncommitted changes
WriteLog "Checking for local uncommitted changes..."
gitStatusCmd = "cmd /c cd /d """ & strScriptPath & """ && git diff --quiet"
gitStatusExitCode = WshShell.Run(gitStatusCmd, 0, True)

Dim hasLocalChanges
hasLocalChanges = False
If gitStatusExitCode <> 0 Then
    hasLocalChanges = True
    WriteLog "Local changes detected"
Else
    WriteLog "No local changes"
End If

' Check for git updates (hidden)
WriteLog "Fetching updates from origin..."
gitFetchCmd = "cmd /c cd /d """ & strScriptPath & """ && git fetch origin 2>&1"
gitFetchExitCode = WshShell.Run(gitFetchCmd, 0, True)

If gitFetchExitCode <> 0 Then
    UpdateStatus "Warning: Could not check for updates. Starting with local version..."
    WriteLog "ERROR: git fetch failed with exit code: " & gitFetchExitCode
    WScript.Sleep 2000
    ' Continue with local version - don't block startup
Else
    WriteLog "Git fetch successful"
End If

' Check if there are differences between local and remote (hidden)
WriteLog "Comparing local and remote versions..."
gitDiffCmd = "cmd /c cd /d """ & strScriptPath & """ && git diff --quiet HEAD origin/main"
gitDiffExitCode = WshShell.Run(gitDiffCmd, 0, True)

' If there are changes (exit code not 0), pull them
Dim hasUpdates
hasUpdates = False

If gitDiffExitCode <> 0 Then
    UpdateStatus "Updates available. Downloading..."
    WriteLog "Updates available, pulling changes..."
    
    ' If there are local changes, stash them first
    If hasLocalChanges Then
        UpdateStatus "Saving local changes..."
        WriteLog "Stashing local changes..."
        gitStashCmd = "cmd /c cd /d """ & strScriptPath & """ && git stash push -m ""Auto-stash before update"""
        WshShell.Run gitStashCmd, 0, True
    End If
    
    ' Pull the latest changes
    gitPullCmd = "cmd /c cd /d """ & strScriptPath & """ && git pull origin main 2>&1"
    gitPullExitCode = WshShell.Run(gitPullCmd, 0, True)
    
    If gitPullExitCode <> 0 Then
        ' Pull failed - try to restore stashed changes
        WriteLog "ERROR: git pull failed with exit code: " & gitPullExitCode
        If hasLocalChanges Then
            WshShell.Run "cmd /c cd /d """ & strScriptPath & """ && git stash pop", 0, True
        End If
        
        MsgBox "Failed to pull latest changes from repository." & vbCrLf & vbCrLf & _
               "Your local changes have been preserved." & vbCrLf & _
               "Please sync manually or run git-sync-diagnostic.bat for help.", _
               vbExclamation, "TestCaseGenie - Update Warning"
        ' Continue anyway - don't block startup
    Else
        ' Pull succeeded
        hasUpdates = True
        UpdateStatus "Updates installed. Clearing cache..."
        WriteLog "Git pull successful"
        
        ' Restore stashed changes if any
        If hasLocalChanges Then
            UpdateStatus "Restoring local changes..."
            WriteLog "Restoring stashed changes..."
            gitStashPopCmd = "cmd /c cd /d """ & strScriptPath & """ && git stash pop"
            WshShell.Run gitStashPopCmd, 0, True
        End If
    End If
Else
    UpdateStatus "App is up to date."
    WriteLog "App is already up to date"
    WScript.Sleep 1000
End If

' Always clear Angular cache to ensure fresh build (even for local changes)
UpdateStatus "Clearing Angular build cache..."
WriteLog "Clearing Angular cache..."

' Delete entire .angular folder (not just cache)
angularFolder = strScriptPath & "\bin\front\angular-frontend\.angular"
If objFSO.FolderExists(angularFolder) Then
    On Error Resume Next
    objFSO.DeleteFolder angularFolder, True
    WriteLog "Deleted .angular folder"
    On Error Goto 0
End If

' Delete node_modules/.cache folder
nodeModulesCachePath = strScriptPath & "\bin\front\angular-frontend\node_modules\.cache"
If objFSO.FolderExists(nodeModulesCachePath) Then
    On Error Resume Next
    objFSO.DeleteFolder nodeModulesCachePath, True
    WriteLog "Deleted node_modules/.cache folder"
    On Error Goto 0
End If

' Delete dist folder
distFolder = strScriptPath & "\bin\front\angular-frontend\dist"
If objFSO.FolderExists(distFolder) Then
    On Error Resume Next
    objFSO.DeleteFolder distFolder, True
    WriteLog "Deleted dist folder"
    On Error Goto 0
End If

WScript.Sleep 500

' Check and install npm dependencies for Angular frontend only if needed or after updates
angularNodeModules = strScriptPath & "\bin\front\angular-frontend\node_modules"
If Not objFSO.FolderExists(angularNodeModules) Or hasUpdates Then
    UpdateStatus "Installing Angular frontend dependencies..."
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

' Check and install npm dependencies for Node.js backend only if needed or after updates
backendNodeModules = strScriptPath & "\bin\system\model\Backend\node_modules"
If Not objFSO.FolderExists(backendNodeModules) Or hasUpdates Then
    UpdateStatus "Installing Node.js backend dependencies..."
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

' Check and install npm dependencies for AI Automation only if needed or after updates
aiAutomationNodeModules = strScriptPath & "\AI Automation\node_modules"
If Not objFSO.FolderExists(aiAutomationNodeModules) Or hasUpdates Then
    UpdateStatus "Installing AI Automation dependencies..."
    WriteLog "Running npm install for AI Automation..."
    aiAutomationNpmInstallCmd = "cmd /c cd /d """ & strScriptPath & "\AI Automation"" && npm install >> """ & strLogFile & """ 2>&1"
    aiAutomationNpmExitCode = WshShell.Run(aiAutomationNpmInstallCmd, 0, True)
    
    If aiAutomationNpmExitCode <> 0 Then
        WriteLog "ERROR: AI Automation npm install failed with exit code: " & aiAutomationNpmExitCode
        MsgBox "ERROR: Failed to install AI Automation npm dependencies." & vbCrLf & vbCrLf & _
               "Please check your internet connection and try again." & vbCrLf & _
               "Check startup.log for details.", vbCritical, "TestCaseGenie Error"
        WScript.Quit 1
    Else
        WriteLog "AI Automation npm install successful"
    End If
Else
    WriteLog "AI Automation node_modules exists, skipping npm install"
End If

' Check and install npm dependencies for BugGen only if needed or after updates
bugGenNodeModules = strScriptPath & "\BugGen\node_modules"
If Not objFSO.FolderExists(bugGenNodeModules) Or hasUpdates Then
    UpdateStatus "Installing BugGen dependencies..."
    WriteLog "Running npm install for BugGen..."
    bugGenNpmInstallCmd = "cmd /c cd /d """ & strScriptPath & "\BugGen"" && npm install >> """ & strLogFile & """ 2>&1"
    bugGenNpmExitCode = WshShell.Run(bugGenNpmInstallCmd, 0, True)
    
    If bugGenNpmExitCode <> 0 Then
        WriteLog "ERROR: BugGen npm install failed with exit code: " & bugGenNpmExitCode
        MsgBox "ERROR: Failed to install BugGen npm dependencies." & vbCrLf & vbCrLf & _
               "Please check your internet connection and try again." & vbCrLf & _
               "Check startup.log for details.", vbCritical, "TestCaseGenie Error"
        WScript.Quit 1
    Else
        WriteLog "BugGen npm install successful"
    End If
Else
    WriteLog "BugGen node_modules exists, skipping npm install"
End If

' Setup Python virtual environment and install dependencies
UpdateStatus "Checking Python environment..."
WriteLog "Checking Python environment..."
pythonBackendPath = strScriptPath & "\bin\system\jira\TestGenie-BE"
venvPath = pythonBackendPath & "\venv"

' Check if virtual environment exists and is valid
Dim venvNeedsRecreation
venvNeedsRecreation = False

If objFSO.FolderExists(venvPath) Then
    WriteLog "Python venv folder exists, checking validity..."
    venvPythonExe = venvPath & "\Scripts\python.exe"
    
    If Not objFSO.FileExists(venvPythonExe) Then
        WriteLog "WARNING: venv Python executable not found at: " & venvPythonExe
        WriteLog "Virtual environment is broken, will recreate"
        venvNeedsRecreation = True
    Else
        WriteLog "venv Python executable found: " & venvPythonExe
        
        ' Test if venv Python actually works
        testPythonCmd = "cmd /c """ & venvPythonExe & """ --version 2>&1"
        Set objExec = WshShell.Exec(testPythonCmd)
        Do While objExec.Status = 0
            WScript.Sleep 100
        Loop
        
        If objExec.ExitCode <> 0 Then
            WriteLog "WARNING: venv Python is broken (exit code: " & objExec.ExitCode & ")"
            WriteLog "Virtual environment will be recreated"
            venvNeedsRecreation = True
        Else
            WriteLog "venv Python is working correctly"
        End If
    End If
    
    ' Delete broken venv
    If venvNeedsRecreation Then
        WriteLog "Deleting broken venv folder..."
        On Error Resume Next
        objFSO.DeleteFolder venvPath, True
        WScript.Sleep 1000
        On Error Goto 0
        
        If objFSO.FolderExists(venvPath) Then
            WriteLog "ERROR: Could not delete broken venv folder"
            MsgBox "ERROR: Could not delete broken virtual environment." & vbCrLf & vbCrLf & _
                   "Please manually delete: " & venvPath & vbCrLf & _
                   "Then run the script again.", vbCritical, "TestCaseGenie Error"
            WScript.Quit 1
        Else
            WriteLog "Broken venv deleted successfully"
        End If
    End If
End If

' Create venv if it doesn't exist or was deleted
If Not objFSO.FolderExists(venvPath) Then
    UpdateStatus "Creating Python virtual environment..."
    WriteLog "Creating Python virtual environment..."
    WriteLog "Running: py -m venv venv"
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
        ' Force pip install after creating new venv
        hasUpdates = True
    End If
End If

' Install Python requirements only if venv is new or after updates
If hasUpdates Or Not objFSO.FolderExists(venvPath) Then
    UpdateStatus "Installing Python dependencies..."
    WriteLog "Using venv pip directly: " & pythonBackendPath & "\venv\Scripts\pip.exe"
    
    ' First, upgrade pip itself
    WriteLog "Upgrading pip to latest version..."
    upgradePipCmd = "cmd /c cd /d """ & pythonBackendPath & """ && venv\Scripts\python.exe -m pip install --upgrade pip >> """ & strLogFile & """ 2>&1"
    upgradePipExitCode = WshShell.Run(upgradePipCmd, 0, True)
    
    If upgradePipExitCode = 0 Then
        WriteLog "Pip upgraded successfully"
    Else
        WriteLog "WARNING: Pip upgrade failed, continuing anyway"
    End If
    
    ' Try installing with --upgrade flag for Python 3.12 compatibility
    WriteLog "Installing Python requirements (with --upgrade for compatibility)..."
    pipInstallCmd = "cmd /c cd /d """ & pythonBackendPath & """ && venv\Scripts\pip.exe install --upgrade -r requirements.txt >> """ & strLogFile & """ 2>&1"
    pipExitCode = WshShell.Run(pipInstallCmd, 0, True)
    
    ' Check if pip install succeeded
    If pipExitCode <> 0 Then
        WriteLog "ERROR: Pip install with requirements.txt failed (exit code: " & pipExitCode & ")"
        WriteLog "Trying fallback: installing packages without strict versions..."
        
        ' Fallback: install packages by name only (latest compatible versions)
        altInstallCmd = "cmd /c cd /d """ & pythonBackendPath & """ && venv\Scripts\pip.exe install fastapi uvicorn[standard] pydantic httpx python-jose[cryptography] passlib[bcrypt] PyJWT python-dotenv python-multipart aiofiles starlette requests pydantic-settings >> """ & strLogFile & """ 2>&1"
        altExitCode = WshShell.Run(altInstallCmd, 0, True)
        
        If altExitCode <> 0 Then
            WriteLog "ERROR: Fallback pip install also failed (exit code: " & altExitCode & ")"
            MsgBox "ERROR: Failed to install Python dependencies." & vbCrLf & vbCrLf & _
                   "This may be due to Python version compatibility." & vbCrLf & _
                   "Check startup.log for details.", vbCritical, "TestCaseGenie Error"
            WScript.Quit 1
        Else
            WriteLog "Fallback pip install successful (using latest compatible versions)"
        End If
    Else
        WriteLog "Python pip install successful"
    End If
Else
    WriteLog "Python dependencies already installed, skipping pip install"
End If

' Kill ALL old server processes (more aggressive)
UpdateStatus "Cleaning up old processes..."
WriteLog "Killing old server processes..."

' Kill ALL Node.js processes
On Error Resume Next
WshShell.Run "taskkill /F /IM node.exe", 0, True
WScript.Sleep 500

' Kill ALL Python processes
WshShell.Run "taskkill /F /IM python.exe", 0, True
WshShell.Run "taskkill /F /IM py.exe", 0, True
WScript.Sleep 500
On Error Goto 0

WriteLog "Old processes cleaned up"
WScript.Sleep 2000
' Update status: Starting servers
UpdateStatus "Starting servers..."
WriteLog "========== Starting Servers =========="

' Check if ports are available before starting
WriteLog "Checking port availability..."
Set objWMI = GetObject("winmgmts:\\localhost\root\cimv2")

' Check port 4200 (Angular)
Set colPorts = objWMI.ExecQuery("SELECT * FROM Win32_Process WHERE CommandLine LIKE '%4200%'")
If colPorts.Count > 0 Then
    WriteLog "WARNING: Port 4200 may already be in use"
Else
    WriteLog "Port 4200 is available"
End If

' Check port 8000 (Python)
Set colPorts = objWMI.ExecQuery("SELECT * FROM Win32_Process WHERE CommandLine LIKE '%8000%'")
If colPorts.Count > 0 Then
    WriteLog "WARNING: Port 8000 may already be in use"
Else
    WriteLog "Port 8000 is available"
End If

' Check port 3000 (AI Automation)
Set colPorts = objWMI.ExecQuery("SELECT * FROM Win32_Process WHERE CommandLine LIKE '%3000%'")
If colPorts.Count > 0 Then
    WriteLog "WARNING: Port 3000 may already be in use"
Else
    WriteLog "Port 3000 is available"
End If

' Check port 4000 (BugGen AI Backend)
Set colPorts = objWMI.ExecQuery("SELECT * FROM Win32_Process WHERE CommandLine LIKE '%4000%'")
If colPorts.Count > 0 Then
    WriteLog "WARNING: Port 4000 may already be in use"
Else
    WriteLog "Port 4000 is available"
End If

WriteLog "Starting Node.js backend server..."
WriteLog "Command: cd /d """ & strScriptPath & "\bin\system\model\Backend"" && node server.js"
' Start Backend (Node.js) - Hidden
WshShell.Run "cmd /c cd /d """ & strScriptPath & "\bin\system\model\Backend"" && node server.js > """ & strScriptPath & "\backend.log"" 2>&1", 0, False
WriteLog "Node.js backend process started"
WScript.Sleep 2000

WriteLog "Starting Angular frontend server..."
WriteLog "Command: cd /d """ & strScriptPath & "\bin\front\angular-frontend"" && npm start"
' Start Angular Frontend - Hidden
WshShell.Run "cmd /c cd /d """ & strScriptPath & "\bin\front\angular-frontend"" && npm start > """ & strScriptPath & "\frontend.log"" 2>&1", 0, False
WriteLog "Angular frontend process started"
WScript.Sleep 2000

WriteLog "Starting Python backend server..."
WriteLog "Using venv python: " & pythonBackendPath & "\venv\Scripts\python.exe"
WriteLog "Command: cd /d """ & pythonBackendPath & """ && venv\Scripts\python.exe -m uvicorn main:app --host 0.0.0.0 --port 8000 --reload"
' Start Python Backend - Hidden
WshShell.Run "cmd /c cd /d """ & strScriptPath & "\bin\system\jira\TestGenie-BE"" && venv\Scripts\python.exe -m uvicorn main:app --host 0.0.0.0 --port 8000 --reload > """ & strScriptPath & "\python.log"" 2>&1", 0, False
WriteLog "Python backend process started"
WScript.Sleep 2000

WriteLog "Starting AI Automation server..."
WriteLog "Command: cd /d """ & strScriptPath & "\AI Automation"" && npm run dev"
' Start AI Automation - Hidden
WshShell.Run "cmd /c cd /d """ & strScriptPath & "\AI Automation"" && npm run dev > """ & strScriptPath & "\ai-automation.log"" 2>&1", 0, False
WriteLog "AI Automation process started"
WScript.Sleep 2000

WriteLog "Starting BugGen AI Backend server..."
WriteLog "Command: cd /d """ & strScriptPath & "\BugGen"" && npm run dev:ai-backend"
' Start BugGen AI Backend - Hidden
WshShell.Run "cmd /c cd /d """ & strScriptPath & "\BugGen"" && npm run dev:ai-backend > """ & strScriptPath & "\buggen-backend.log"" 2>&1", 0, False
WriteLog "BugGen AI Backend process started"
WScript.Sleep 2000

WriteLog "Starting BugGen AI Frontend server..."
WriteLog "Command: cd /d """ & strScriptPath & "\BugGen"" && npm run dev:ai-frontend"
' Start BugGen AI Frontend - Hidden
WshShell.Run "cmd /c cd /d """ & strScriptPath & "\BugGen"" && npm run dev:ai-frontend > """ & strScriptPath & "\buggen-frontend.log"" 2>&1", 0, False
WriteLog "BugGen AI Frontend process started"

' Wait for servers to start
WriteLog "Waiting 10 seconds for servers to initialize..."
UpdateStatus "Waiting for servers to start..."
WScript.Sleep 10000

WriteLog "Checking if servers are running..."
' Check if Angular process is running
Set colProcesses = objWMI.ExecQuery("SELECT * FROM Win32_Process WHERE Name='node.exe' AND CommandLine LIKE '%angular%'")
If colProcesses.Count > 0 Then
    WriteLog "[OK] Angular server is running (PID: " & colProcesses.ItemIndex(0).ProcessId & ")"
Else
    WriteLog "[WARNING] Angular server may not be running!"
End If

' Check if Python process is running
Set colProcesses = objWMI.ExecQuery("SELECT * FROM Win32_Process WHERE (Name='python.exe' OR Name='py.exe') AND CommandLine LIKE '%uvicorn%'")
If colProcesses.Count > 0 Then
    WriteLog "[OK] Python server is running (PID: " & colProcesses.ItemIndex(0).ProcessId & ")"
Else
    WriteLog "[WARNING] Python server may not be running!"
End If

' Check if Node backend is running
Set colProcesses = objWMI.ExecQuery("SELECT * FROM Win32_Process WHERE Name='node.exe' AND CommandLine LIKE '%Backend%'")
If colProcesses.Count > 0 Then
    WriteLog "[OK] Node.js backend is running (PID: " & colProcesses.ItemIndex(0).ProcessId & ")"
Else
    WriteLog "[WARNING] Node.js backend may not be running!"
End If

UpdateStatus "Almost ready..."
WriteLog "Waiting additional 5 seconds for full initialization..."
WScript.Sleep 5000

' Clean up status file
If objFSO.FileExists(strStatusFile) Then
    objFSO.DeleteFile strStatusFile
End If

WriteLog "All server startup commands executed"
' WriteLog "========== Opening Browser =========="

' ' Try to open browser
' WriteLog "Attempting to open browser at http://localhost:4200"
' On Error Resume Next
' browserOpened = False

' ' Try Chrome first
' WriteLog "Trying to launch Chrome..."
' Set objShellApp = CreateObject("Shell.Application")
' WshShell.Run "chrome.exe http://localhost:4200", 1, False
' If Err.Number = 0 Then
'     WriteLog "[OK] Chrome launched successfully"
'     browserOpened = True
' Else
'     WriteLog "[FAILED] Chrome launch failed: " & Err.Description
'     Err.Clear
    
'     ' Try Edge
'     WriteLog "Trying to launch Microsoft Edge..."
'     WshShell.Run "msedge.exe http://localhost:4200", 1, False
'     If Err.Number = 0 Then
'         WriteLog "[OK] Edge launched successfully"
'         browserOpened = True
'     Else
'         WriteLog "[FAILED] Edge launch failed: " & Err.Description
'         Err.Clear
        
'         ' Try default browser
'         WriteLog "Trying to launch default browser..."
'         WshShell.Run "http://localhost:4200", 1, False
'         If Err.Number = 0 Then
'             WriteLog "[OK] Default browser launched successfully"
'             browserOpened = True
'         Else
'             WriteLog "[FAILED] Default browser launch failed: " & Err.Description
'             WriteLog "ERROR: Could not launch any browser!"
'         End If
'     End If
' End If
' On Error Goto 0

' If browserOpened Then
'     WriteLog "Browser opened successfully"
' Else
'     WriteLog "CRITICAL: Failed to open browser - user must manually navigate to http://localhost:4200"
'     MsgBox "TestCaseGenie servers are running!" & vbCrLf & vbCrLf & _
'            "Please open your browser and go to:" & vbCrLf & _
'            "http://localhost:4200" & vbCrLf & vbCrLf & _
'            "Check startup.log for details.", vbInformation, "TestCaseGenie"
' End If

WriteLog "========== Startup Complete =========="
WriteLog "Frontend: http://localhost:4200"
WriteLog "Python API: http://localhost:8000"
WriteLog "AI Automation: http://localhost:3000"
WriteLog "BugGen AI Backend: http://localhost:4000"
WriteLog "Check frontend.log, backend.log, python.log, ai-automation.log, buggen-backend.log, buggen-frontend.log for server output"

' Start monitoring script to auto-cleanup when browser closes
WriteLog "Starting monitor-and-cleanup script..."
monitorScript = strScriptPath & "\monitor-and-cleanup.vbs"
WshShell.Run "wscript " & Chr(34) & monitorScript & Chr(34), 0, False
WriteLog "Monitor script started"

MsgBox "TestCaseGenie Startup Complete!" & vbCrLf & vbCrLf & _
    "Happy Testing :)", vbInformation, "TestCaseGenie"
