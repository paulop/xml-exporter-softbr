import { app } from 'electron'
import { execFile } from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

// Tarefa do Agendador do Windows que abre o app com `--auto` na primeira
// segunda-feira de cada mês (o app então consulta e valida o mês anterior,
// e envia sozinho se "Enviar sem revisar" estiver ligado). StartWhenAvailable:
// se o PC estiver desligado no horário, o Windows abre assim que ele ligar.
export const AUTO_RUN_ARG = '--auto'
const TASK_NAME = 'SoftBR - Gerador de Arquivos XML - Envio mensal'
const START_TIME = '08:00:00'

function runSchtasks (args) {
  return new Promise((resolve, reject) => {
    execFile('schtasks', args, { windowsHide: true }, (err, stdout, stderr) => {
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

// O agendamento mensal por dia da semana ("1ª segunda-feira") não existe nos
// cmdlets do PowerShell, só no XML de tarefa — por isso o /XML no schtasks.
function taskXml () {
  const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
    'August', 'September', 'October', 'November', 'December']
    .map((m) => `<${m} />`).join('')

  return `<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo>
    <Description>Abre o Gerador de Arquivos XML - SoftBR para o envio mensal dos XMLs à contabilidade.</Description>
  </RegistrationInfo>
  <Triggers>
    <CalendarTrigger>
      <StartBoundary>2026-01-01T${START_TIME}</StartBoundary>
      <Enabled>true</Enabled>
      <ScheduleByMonthDayOfWeek>
        <Weeks><Week>1</Week></Weeks>
        <DaysOfWeek><Monday /></DaysOfWeek>
        <Months>${months}</Months>
      </ScheduleByMonthDayOfWeek>
    </CalendarTrigger>
  </Triggers>
  <Principals>
    <Principal id="Author">
      <LogonType>InteractiveToken</LogonType>
      <RunLevel>LeastPrivilege</RunLevel>
    </Principal>
  </Principals>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <StartWhenAvailable>true</StartWhenAvailable>
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
  const xmlPath = path.join(os.tmpdir(), `softbr-xml-task-${process.pid}.xml`)
  // schtasks só aceita o XML de forma confiável em UTF-16 LE com BOM.
  await fs.writeFile(xmlPath, '﻿' + taskXml(), 'utf16le')
  try {
    await runSchtasks(['/Create', '/TN', TASK_NAME, '/XML', xmlPath, '/F'])
  } finally {
    await fs.rm(xmlPath, { force: true })
  }
}

async function deleteTask () {
  try {
    await runSchtasks(['/Delete', '/TN', TASK_NAME, '/F'])
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
