#!/usr/bin/env node
/**
 * browser-daemon.js — 持久化 Chromium 守护进程
 *
 * 用 Playwright launchServer() 启动常驻浏览器，
 * search.js / fetch.js 通过 CDP 复用，省去每次 1.5s+ 的 launch 开销。
 *
 * 用法：
 *   启动: node scripts/browser-daemon.js          (后台运行)
 *   停止: node scripts/browser-daemon.js --stop
 *   状态: node scripts/browser-daemon.js --status
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { launchBrowserServer } from './playwright-support.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(__dirname, '..');
const ENDPOINT_FILE = path.join(skillRoot, '.browser-endpoint');

function readInfo() {
  try { return JSON.parse(fs.readFileSync(ENDPOINT_FILE, 'utf-8')); } catch { return null; }
}

function isAlive() {
  const info = readInfo();
  if (!info) return false;
  try { process.kill(info.pid, 0); return true; } catch {
    try { fs.unlinkSync(ENDPOINT_FILE); } catch {}
    return false;
  }
}

async function startDaemon() {
  if (isAlive()) {
    const info = readInfo();
    const uptime = ((Date.now() - info.startedAt) / 1000).toFixed(0);
    console.log(`[daemon] Already running  PID: ${info.pid}  Uptime: ${uptime}s`);
    console.log(`  WS: ${info.wsEndpoint}`);
    return;
  }

  const server = await launchBrowserServer({ headless: true });

  const wsEndpoint = server.wsEndpoint();
  const info = {
    pid: process.pid,  // daemon 进程 PID（用于 isAlive 检查）
    wsEndpoint,
    startedAt: Date.now(),
  };

  fs.writeFileSync(ENDPOINT_FILE, JSON.stringify(info, null, 2));
  console.log(`[daemon] Chromium started  PID: ${info.pid}`);
  console.log(`[daemon] WS: ${wsEndpoint}`);
  console.log('[daemon] Running... (Ctrl+C or --stop to quit)');

  // Keep process alive
  process.on('SIGINT', async () => {
    console.log('[daemon] Stopping...');
    await server.close();
    try { fs.unlinkSync(ENDPOINT_FILE); } catch {}
    process.exit(0);
  });
  process.on('SIGTERM', async () => {
    await server.close();
    try { fs.unlinkSync(ENDPOINT_FILE); } catch {}
    process.exit(0);
  });
}

function stopDaemon() {
  const info = readInfo();
  if (!info) { console.log('[daemon] Not running'); return; }
  try {
    process.kill(info.pid, 'SIGTERM');
    console.log(`[daemon] Stopped  PID: ${info.pid}`);
  } catch {
    console.log('[daemon] Process already exited');
  }
  try { fs.unlinkSync(ENDPOINT_FILE); } catch {}
}

function showStatus() {
  if (!isAlive()) { console.log('[daemon] Not running'); return; }
  const info = readInfo();
  const uptime = ((Date.now() - info.startedAt) / 1000).toFixed(0);
  console.log(`[daemon] Running  PID: ${info.pid}  Uptime: ${uptime}s`);
  console.log(`  WS: ${info.wsEndpoint}`);
}

const arg = process.argv[2];
if (arg === '--stop') stopDaemon();
else if (arg === '--status') showStatus();
else startDaemon();
