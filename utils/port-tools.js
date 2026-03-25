#!/usr/bin/env node

const { execSync } = require('child_process');

const action = (process.argv[2] || 'check').toLowerCase();
const port = Number(process.argv[3] || process.env.PORT || 5000);

if (!Number.isInteger(port) || port <= 0 || port > 65535) {
  console.error(`Invalid port: ${process.argv[3] || process.env.PORT}`);
  process.exit(1);
}

const isWindows = process.platform === 'win32';

function parseWindowsPids(portNumber) {
  const output = execSync(`netstat -ano | findstr :${portNumber}`, { encoding: 'utf8' });
  const lines = output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => /\sLISTENING\s/i.test(line));

  const pids = new Set();
  for (const line of lines) {
    const parts = line.split(/\s+/);
    const pid = parts[parts.length - 1];
    if (/^\d+$/.test(pid)) pids.add(Number(pid));
  }

  return [...pids];
}

function parseUnixPids(portNumber) {
  const output = execSync(`lsof -t -i tcp:${portNumber} -sTCP:LISTEN`, { encoding: 'utf8' });
  return output
    .split(/\r?\n/)
    .map((v) => v.trim())
    .filter(Boolean)
    .filter((v) => /^\d+$/.test(v))
    .map((v) => Number(v));
}

function getListeningPids(portNumber) {
  try {
    return isWindows ? parseWindowsPids(portNumber) : parseUnixPids(portNumber);
  } catch {
    return [];
  }
}

function killPid(pid) {
  if (isWindows) {
    execSync(`taskkill /PID ${pid} /F`, { stdio: 'ignore' });
    return;
  }
  process.kill(pid, 'SIGKILL');
}

const pids = getListeningPids(port);

if (action === 'check') {
  if (pids.length === 0) {
    console.log(`Port ${port} is free.`);
    process.exit(0);
  }
  console.log(`Port ${port} is busy. PID(s): ${pids.join(', ')}`);
  process.exit(0);
}

if (action === 'kill') {
  if (pids.length === 0) {
    console.log(`No process is listening on port ${port}.`);
    process.exit(0);
  }

  const killed = [];
  for (const pid of pids) {
    try {
      killPid(pid);
      killed.push(pid);
    } catch (error) {
      console.error(`Failed to kill PID ${pid}: ${error.message}`);
    }
  }

  const remaining = getListeningPids(port);
  if (remaining.length === 0) {
    console.log(`Freed port ${port}. Killed PID(s): ${killed.join(', ')}`);
    process.exit(0);
  }

  console.error(`Port ${port} is still busy. Remaining PID(s): ${remaining.join(', ')}`);
  process.exit(1);
}

console.error(`Unknown action: ${action}. Use 'check' or 'kill'.`);
process.exit(1);
