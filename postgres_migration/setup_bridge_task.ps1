# Registra el puente SQL Server -> Postgres como tarea programada de Windows.
# Corre run_bridge.py todos los dias a las 3:00 AM (fuera de horario de oficina,
# para no competir con cargas del equipo a la BD .99 durante el dia).
#
# Uso (PowerShell como el usuario actual, no requiere admin si el Task Scheduler
# lo permite para tareas del usuario):
#   powershell -ExecutionPolicy Bypass -File postgres_migration\setup_bridge_task.ps1
#
# Para cambiar la hora, edita $Hora abajo y vuelve a correr este script
# (Register-ScheduledTask con -Force sobreescribe la tarea existente).

$TaskName = "TIH_Puente_SQLServer_a_Postgres"
$Hora = "03:00"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$PythonExe = (Get-Command py -ErrorAction SilentlyContinue).Source
if (-not $PythonExe) { $PythonExe = (Get-Command python -ErrorAction SilentlyContinue).Source }

$Action = New-ScheduledTaskAction -Execute $PythonExe -Argument "-3 `"$ScriptDir\run_bridge.py`"" -WorkingDirectory $ScriptDir
$Trigger = New-ScheduledTaskTrigger -Daily -At $Hora
$Settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -DontStopOnIdleEnd -ExecutionTimeLimit (New-TimeSpan -Hours 2)

Register-ScheduledTask -TaskName $TaskName -Action $Action -Trigger $Trigger -Settings $Settings -Description "Extrae de SQL Server (172.16.200.99) y recarga Postgres (staging->core->api) para TIH." -Force

Write-Host "Tarea '$TaskName' registrada: corre todos los dias a las $Hora."
Write-Host "Para correrla manualmente ahora: Start-ScheduledTask -TaskName '$TaskName'"
Write-Host "Para ver su historial: Get-ScheduledTaskInfo -TaskName '$TaskName'"
