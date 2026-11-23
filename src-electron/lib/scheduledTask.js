import { app } from 'electron'
import { execFile } from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { MONTHLY_HOURS } from './monthlyWindow.js'

// O Agendador dispara nos horários de fechamento e também no logon.
export const AUTO_RUN_ARG = '--auto'
const TASK_NAME = 'SoftBR - Gerador de Arquivos XML - Envio mensal'
export const MONTHLY_SCHEDULE_VERSION = 3

function runWindowsCommand (command, args) {
  return new Promise((resolve, reject) => {
    execFile(command, args, { windowsHide: true }, (err, stdout, stderr) => {
      if (err) reject(new Error(String(stderr || stdout || err.message).trim()))
      else resolve(stdout)
    })
  })
}

function escapeXml (value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

// O aplicativo restringe os disparos semanais à primeira segunda e à terça
// seguinte, inclusive quando a primeira segunda cai no dia 7.
function taskXml (userSid) {
  const triggers = MONTHLY_HOURS.map((hour) => `
    <CalendarTrigger>
      <StartBoundary>2026-01-01T${String(hour).padStart(2, '0')}:00:00</StartBoundary>
      <Enabled>true</Enabled>
      <ScheduleByWeek>
        <WeeksInterval>1</WeeksInterval>
        <DaysOfWeek><Monday /><Tuesday /></DaysOfWeek>
      </ScheduleByWeek>
    </CalendarTrigger>`).join('')

  return `<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo>
    <Description>Abre o TOTVS Chef | XML para o envio mensal dos XMLs à contabilidade.</Description>
  </RegistrationInfo>
  <Triggers>${triggers}
    <LogonTrigger>
      <Enabled>true</Enabled>
      <UserId>${userSid}</UserId>
    </LogonTrigger>
  </Triggers>
  <Principals>
    <Principal id="Author">
      <UserId>${userSid}</UserId>
      <LogonType>InteractiveToken</LogonType>
      <RunLevel>LeastPrivilege</RunLevel>
    </Principal>
  </Principals>
  <Settings>
    <MultipleInstancesPolicy>Parallel</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <StartWhenAvailable>false</StartWhenAvailable>
    <RunOnlyIfNetworkAvailable>false</RunOnlyIfNetworkAvailable>
    <ExecutionTimeLimit>PT0S</ExecutionTimeLimit>
    <Enabled>true</Enabled>
  </Settings>
  <Actions Context="Author">
    <Exec>
      <Command>${escapeXml(process.execPath)}</Command>
      <Arguments>${AUTO_RUN_ARG}</Arguments>
    </Exec>
  </Actions>
</Task>
`
}

async function createTask () {
  const identity = await runWindowsCommand('whoami.exe', ['/user', '/fo', 'csv', '/nh'])
  const userSid = identity.match(/"\s*,\s*"(S-1-\d+(?:-\d+)+)"\s*$/i)?.[1]
  if (!userSid) throw new Error('Não foi possível identificar a conta atual do Windows.')
  const xmlPath = path.join(os.tmpdir(), `softbr-xml-task-${process.pid}.xml`)
  // schtasks só aceita o XML de forma confiável em UTF-16 LE com BOM.
  await fs.writeFile(xmlPath, '﻿' + taskXml(userSid), 'utf16le')
  try {
    await runWindowsCommand('schtasks.exe', ['/Create', '/TN', TASK_NAME, '/XML', xmlPath, '/F'])
  } finally {
    await fs.rm(xmlPath, { force: true })
  }
}

async function deleteTask () {
  try {
    await runWindowsCommand('schtasks.exe', ['/Delete', '/TN', TASK_NAME, '/F'])
  } catch {
    // tarefa não existia — nada a remover
  }
}

// Cria (ou recria, mantendo o caminho do .exe atualizado se o app foi
// reinstalado em outra pasta) ou remove a tarefa conforme `enabled`.
export async function syncScheduledTask (enabled) {
  if (process.platform !== 'win32') {
    return { ok: false, message: 'O agendamento automático só está disponível no Windows.' }
  }
  if (!app.isPackaged) {
    // Em dev o execPath é o electron.exe cru, sem o app: a tarefa não abriria nada.
    return { ok: false, message: 'O agendamento só é criado na versão instalada do app.' }
  }
  try {
    if (enabled) await createTask()
    else await deleteTask()
    return { ok: true }
  } catch (err) {
    return { ok: false, message: `Não foi possível ${enabled ? 'criar' : 'remover'} a tarefa agendada: ${err.message}` }
  }
}
