Set WshShell = CreateObject("WScript.Shell")
Set objWMIService = GetObject("winmgmts:\\.\root\cimv2")

' Monitor for Chrome/Edge processes with localhost:4200
Function IsBrowserRunning()
    On Error Resume Next
    ' Check for Chrome processes
    Set colProcesses = objWMIService.ExecQuery("SELECT * FROM Win32_Process WHERE Name = 'chrome.exe' OR Name = 'msedge.exe'")
    
    For Each objProcess In colProcesses
        ' Check if command line contains localhost:4200
        If Not IsNull(objProcess.CommandLine) Then
            If InStr(objProcess.CommandLine, "localhost:4200") > 0 Then
                IsBrowserRunning = True
                Exit Function
            End If
        End If
    Next
    
    IsBrowserRunning = False
    On Error Goto 0
End Function

' Wait for browser to navigate to localhost:4200 (app is fully loaded)
WScript.Sleep 5000
waitCount = 0
Do Until IsBrowserRunning()
    WScript.Sleep 2000
    waitCount = waitCount + 1
    ' If waiting too long (60 seconds), exit to prevent infinite loop
    If waitCount > 30 Then
        WScript.Quit
    End If
Loop

' Now monitor - wait while browser is still running
Do While IsBrowserRunning()
    WScript.Sleep 2000
Loop

' Browser closed, kill TestCaseGenie server processes only
WScript.Sleep 1000

On Error Resume Next

' Get the script directory to identify our processes
Set objFSO = CreateObject("Scripting.FileSystemObject")
strScriptPath = objFSO.GetParentFolderName(WScript.ScriptFullName)

' Kill only Node.js processes running from our project directories
Set colProcesses = objWMIService.ExecQuery("SELECT * FROM Win32_Process WHERE Name = 'node.exe'")
For Each objProcess In colProcesses
    If Not IsNull(objProcess.CommandLine) Then
        ' Only kill if it's our backend or frontend server
        If InStr(objProcess.CommandLine, strScriptPath) > 0 Then
            objProcess.Terminate()
        End If
    End If
Next

' Kill only Python processes running uvicorn from our project
Set colProcesses = objWMIService.ExecQuery("SELECT * FROM Win32_Process WHERE Name = 'python.exe' OR Name = 'py.exe'")
For Each objProcess In colProcesses
    If Not IsNull(objProcess.CommandLine) Then
        ' Only kill if it's our uvicorn server
        If InStr(objProcess.CommandLine, strScriptPath) > 0 And InStr(objProcess.CommandLine, "uvicorn") > 0 Then
            objProcess.Terminate()
        End If
    End If
Next

' Kill npm processes from our project only
Set colProcesses = objWMIService.ExecQuery("SELECT * FROM Win32_Process WHERE Name LIKE '%npm%'")
For Each objProcess In colProcesses
    If Not IsNull(objProcess.CommandLine) Then
        If InStr(objProcess.CommandLine, strScriptPath) > 0 Then
            objProcess.Terminate()
        End If
    End If
Next

On Error Goto 0

WScript.Quit
