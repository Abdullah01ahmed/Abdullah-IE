; Twin Rivers Arena — NSIS customisation, included by electron-builder (nsis.include).
;
; Hosting a match binds a TCP port (27600 by default) inside the game process,
; so the installer registers a Windows Defender Firewall inbound rule for the
; executable. netsh needs administrator rights: in an elevated install the rule
; is created silently; in a per-user (non-elevated) install the command fails
; harmlessly and Windows shows its usual firewall prompt the first time the
; player hosts. ${APP_EXECUTABLE_FILENAME} is "Twin Rivers Arena.exe".

!macro customInstall
  ; Remove a stale rule from a previous install location before adding the new one.
  nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="Twin Rivers Arena"'
  Pop $0
  nsExec::ExecToLog 'netsh advfirewall firewall add rule name="Twin Rivers Arena" dir=in action=allow program="$INSTDIR\${APP_EXECUTABLE_FILENAME}" enable=yes'
  Pop $0
!macroend

!macro customUnInstall
  nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="Twin Rivers Arena"'
  Pop $0
!macroend
