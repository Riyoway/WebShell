import * as CheerpX from '@leaningtech/cheerpx';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebglAddon } from '@xterm/addon-webgl';
import './style.css';
import { IMAGE_MODE, IMAGE_URL, OVERLAY_ID } from './image.generated.js';

const terminalElement = document.getElementById('terminal');
const encoder = new TextEncoder();

const MIN_TERMINAL_COLS = 20;
const MIN_TERMINAL_ROWS = 5;
const MIN_STABLE_FONT_SIZE = 7;
const MAX_STABLE_FONT_SIZE = 17;
const TAILSCALE_RUNNING = 6;
const EXIT_NODE_DISCOVERY_TIMEOUT_MS = 20_000;
const GUEST_HOSTNAME = 'Riyo-WebShell';
const GUEST_DNS_SERVERS = ['8.8.8.8', '8.8.4.4'];
const BROWSER_SHORTCUTS_TO_TERMINAL = new Set(['p', 'r', 'l', 'f', 's', 'w', 't', 'n']);

let terminal;
let fitAddon;
let webglAddon = null;
let cxInstance = null;
let sendInput = null;
let fitFrame = 0;
let guestCols = 0;
let guestRows = 0;
let geometryLocked = false;
let responsiveHandlersInstalled = false;
let lastViewportKey = '';

let prebootInputHandler = null;
let pendingLoginUrl = null;
let loginActionResolve = null;
let loginUrlResolve;
let networkRunningResolve;
let exitNodeReadyResolve;
let networkState = null;
let networkIp = null;
let exitNodeReady = false;

const loginUrlPromise = new Promise((resolve) => { loginUrlResolve = resolve; });
const networkRunningPromise = new Promise((resolve) => { networkRunningResolve = resolve; });
const exitNodeReadyPromise = new Promise((resolve) => { exitNodeReadyResolve = resolve; });

function timeout(ms) {
  return new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms));
}

function nextFrame() {
  return new Promise((resolve) => requestAnimationFrame(resolve));
}

function getVisualViewportRect() {
  const viewport = window.visualViewport;
  if (viewport) {
    return {
      width: Math.max(1, viewport.width),
      height: Math.max(1, viewport.height),
      left: viewport.offsetLeft,
      top: viewport.offsetTop
    };
  }

  return {
    width: Math.max(1, document.documentElement.clientWidth || window.innerWidth),
    height: Math.max(1, document.documentElement.clientHeight || window.innerHeight),
    left: 0,
    top: 0
  };
}

function responsiveFontSize(width, height) {
  let size = 14;
  if (width <= 360) size = 11;
  else if (width <= 480) size = 12;
  else if (width <= 768) size = 13;

  if (height <= 430) size = Math.min(size, 11);
  else if (height <= 560) size = Math.min(size, 12);
  return size;
}

function updateViewportCSSVars() {
  const rect = getVisualViewportRect();
  const root = document.documentElement;
  root.style.setProperty('--app-width', `${rect.width}px`);
  root.style.setProperty('--app-height', `${rect.height}px`);
  root.style.setProperty('--app-left', `${rect.left}px`);
  root.style.setProperty('--app-top', `${rect.top}px`);
}

function writeLine(message = '') {
  terminal.write(`${message}\r\n`);
}

function writeConsole(buffer, vt) {
  if (vt !== 1 || !terminal) return;
  terminal.write(new Uint8Array(buffer));
}

function sendGuestData(data) {
  if (!sendInput) return;
  const bytes = encoder.encode(data);
  for (const byte of bytes) sendInput(byte);
}

function fitUnlockedTerminal() {
  const { width, height } = getVisualViewportRect();
  const fontSize = responsiveFontSize(width, height);
  if (terminal.options.fontSize !== fontSize) terminal.options.fontSize = fontSize;
  fitAddon.fit();
}

function fitLockedTerminal() {
  const rect = getVisualViewportRect();
  const key = `${Math.round(rect.width)}x${Math.round(rect.height)}`;
  if (key === lastViewportKey && terminal.cols === guestCols && terminal.rows === guestRows) return;
  lastViewportKey = key;

  let low = MIN_STABLE_FONT_SIZE;
  let high = MAX_STABLE_FONT_SIZE;
  let chosen = MIN_STABLE_FONT_SIZE;

  while (low <= high) {
    const size = Math.floor((low + high) / 2);
    terminal.options.fontSize = size;
    const proposed = fitAddon.proposeDimensions?.();
    if (proposed && proposed.cols >= guestCols && proposed.rows >= guestRows) {
      chosen = size;
      low = size + 1;
    } else {
      high = size - 1;
    }
  }

  terminal.options.fontSize = chosen;
  if (terminal.cols !== guestCols || terminal.rows !== guestRows) {
    terminal.resize(guestCols, guestRows);
  }
  if (terminal.rows > 0) terminal.refresh(0, terminal.rows - 1);
}

function fitTerminal() {
  if (!terminal || !fitAddon) return;
  updateViewportCSSVars();
  if (geometryLocked) fitLockedTerminal();
  else fitUnlockedTerminal();
}

function queueFit() {
  if (fitFrame) cancelAnimationFrame(fitFrame);
  fitFrame = requestAnimationFrame(() => {
    fitFrame = 0;
    fitTerminal();
  });
}

function installResponsiveViewportHandlers() {
  if (responsiveHandlersInstalled) return;
  responsiveHandlersInstalled = true;

  const resizeObserver = new ResizeObserver(queueFit);
  resizeObserver.observe(terminalElement);
  window.addEventListener('resize', queueFit, { passive: true });
  window.addEventListener('orientationchange', () => {
    queueFit();
    setTimeout(queueFit, 120);
    setTimeout(queueFit, 320);
  }, { passive: true });

  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', queueFit, { passive: true });
    window.visualViewport.addEventListener('scroll', queueFit, { passive: true });
  }
}

async function createTerminal() {
  const { width, height } = getVisualViewportRect();
  terminal = new Terminal({
    cursorBlink: true,
    convertEol: true,
    scrollback: 5000,
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
    fontSize: responsiveFontSize(width, height),
    lineHeight: 1,
    letterSpacing: 0,
    theme: {
      background: '#000000',
      foreground: '#f4f4f5',
      cursor: '#f4f4f5',
      cursorAccent: '#000000',
      selectionBackground: '#3f3f46'
    }
  });

  fitAddon = new FitAddon();
  terminal.loadAddon(fitAddon);
  terminal.open(terminalElement);

  try {
    webglAddon = new WebglAddon();
    webglAddon.onContextLoss(() => {
      webglAddon?.dispose();
      webglAddon = null;
    });
    terminal.loadAddon(webglAddon);
  } catch (error) {
    console.warn('WebShell: WebGL renderer unavailable; using xterm fallback.', error);
  }

  updateViewportCSSVars();
  fitUnlockedTerminal();
  await nextFrame();
  await nextFrame();
  fitUnlockedTerminal();
  terminal.focus();

  terminal.attachCustomKeyEventHandler((event) => {
    const key = event.key.toLowerCase();
    const ctrlOrMeta = event.ctrlKey || event.metaKey;

    if (ctrlOrMeta && !event.altKey && BROWSER_SHORTCUTS_TO_TERMINAL.has(key)) {
      event.preventDefault();
      return true;
    }

    if (event.altKey && !event.ctrlKey && !event.metaKey &&
        (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
      event.preventDefault();
      return true;
    }

    return true;
  });

  terminal.onData((data) => {
    if (prebootInputHandler && prebootInputHandler(data)) return;
    sendGuestData(data);
  });

  terminalElement.addEventListener('pointerdown', () => {
    terminal.focus();
    if (pendingLoginUrl) openPendingLogin();
  });
  terminalElement.addEventListener('click', () => terminal.focus());
}

function attachCheerpXConsole() {
  if (!cxInstance || !terminal || sendInput) return;
  if (terminal.cols < MIN_TERMINAL_COLS || terminal.rows < MIN_TERMINAL_ROWS) {
    throw new Error(`Terminal is too small: ${terminal.cols}x${terminal.rows}`);
  }

  guestCols = terminal.cols;
  guestRows = terminal.rows;
  sendInput = cxInstance.setCustomConsole(writeConsole, guestCols, guestRows);
  geometryLocked = true;
  installResponsiveViewportHandlers();
  fitLockedTerminal();
}

async function createBaseDisk() {
  if (IMAGE_MODE === 'cloud') return CheerpX.CloudDevice.create(IMAGE_URL);

  const probe = await fetch(IMAGE_URL, {
    method: 'GET',
    headers: { Range: 'bytes=0-0' },
    cache: 'no-cache'
  });
  if (!probe.ok && probe.status !== 206) {
    throw new Error(`Failed to load ${IMAGE_URL}: HTTP ${probe.status}`);
  }
  const contentType = probe.headers.get('content-type') || '';
  if (contentType.includes('text/html')) {
    throw new Error(`${IMAGE_URL} resolved to HTML instead of the ext2 image`);
  }
  await probe.body?.cancel();
  return CheerpX.HttpBytesDevice.create(IMAGE_URL);
}

function readNetworkOptionsFromFragment() {
  const raw = location.hash.startsWith('#') ? location.hash.slice(1) : '';
  const params = new URLSearchParams(raw);
  const controlUrl = params.get('controlUrl')?.trim() || undefined;
  const authKey = params.get('authKey')?.trim() || undefined;
  if (authKey) history.replaceState(null, '', `${location.pathname}${location.search}`);
  return { controlUrl, authKey };
}

function validateLoginUrl(url) {
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new Error(`Unsupported Tailscale login URL: ${parsed.protocol}`);
  }
  return parsed.href;
}

function createNetworkInterface() {
  const { controlUrl, authKey } = readNetworkOptionsFromFragment();
  const networkInterface = {
    loginUrlCb(url) {
      try {
        pendingLoginUrl = validateLoginUrl(url);
        loginUrlResolve(pendingLoginUrl);
      } catch (error) {
        console.error('WebShell: invalid Tailscale login URL', error);
      }
    },
    stateUpdateCb(state) {
      networkState = state;
      if (state === TAILSCALE_RUNNING) {
        pendingLoginUrl = null;
        networkRunningResolve(true);
        if (loginActionResolve) {
          const resolve = loginActionResolve;
          loginActionResolve = null;
          resolve('running');
        }
      }
    },
    netmapUpdateCb(map) {
      networkIp = map?.self?.addresses?.[0] || null;
      const peers = Array.isArray(map?.peers) ? map.peers : [];
      if (!exitNodeReady && peers.some((peer) => Boolean(peer?.exitNode))) {
        exitNodeReady = true;
        exitNodeReadyResolve(true);
      }
    }
  };

  if (controlUrl) networkInterface.controlUrl = controlUrl;
  if (authKey) networkInterface.authKey = authKey;
  return networkInterface;
}

function openPendingLogin() {
  if (!pendingLoginUrl) return false;
  const url = pendingLoginUrl;
  const popup = window.open('about:blank', '_blank');
  if (!popup) return false;

  try {
    popup.opener = null;
    popup.location.replace(url);
  } catch (error) {
    try { popup.close(); } catch {}
    console.warn('WebShell: could not navigate the Tailscale login tab', error);
    return false;
  }

  pendingLoginUrl = null;
  if (loginActionResolve) {
    const resolve = loginActionResolve;
    loginActionResolve = null;
    resolve('opened');
  }

  terminal.clear();
  writeLine('Tailscale login opened in a new tab.');
  writeLine('Finish authentication there, then return here.');
  writeLine('Waiting for the Tailnet connection...');
  return true;
}

function waitForLoginAction(url) {
  pendingLoginUrl = url;
  terminal.clear();
  writeLine('WebShell needs Tailscale authentication for TCP/IP networking.');
  writeLine('');
  writeLine('Press Enter (or click the terminal) to open the Tailscale login page.');
  writeLine('Press S to boot without networking.');

  return new Promise((resolve) => {
    loginActionResolve = resolve;
    prebootInputHandler = (data) => {
      if (data === '\r' || data === '\n') {
        if (!openPendingLogin()) writeLine('Popup was blocked. Click the terminal to open the login page.');
        return true;
      }
      if (data.toLowerCase() === 's' || data === '\x1b') {
        pendingLoginUrl = null;
        loginActionResolve = null;
        resolve('skip');
        return true;
      }
      return true;
    };
  }).finally(() => {
    loginActionResolve = null;
    prebootInputHandler = null;
  });
}

function waitForExitNodeAction() {
  writeLine('');
  writeLine('Tailnet is connected, but no online Exit Node is advertised yet.');
  writeLine('Press Enter to keep waiting, or S to boot without public Internet.');

  return new Promise((resolve) => {
    prebootInputHandler = (data) => {
      if (data === '\r' || data === '\n') {
        resolve('retry');
        return true;
      }
      if (data.toLowerCase() === 's' || data === '\x1b') {
        resolve('skip');
        return true;
      }
      return true;
    };
  }).finally(() => { prebootInputHandler = null; });
}

async function waitForExitNodeBeforeBoot() {
  if (exitNodeReady) return true;

  terminal.clear();
  writeLine(networkIp ? `Tailscale connected: ${networkIp}` : 'Tailscale connected.');
  writeLine('Waiting for an Exit Node...');

  while (!exitNodeReady) {
    const result = await Promise.race([
      exitNodeReadyPromise.then(() => 'ready'),
      new Promise((resolve) => setTimeout(() => resolve('timeout'), EXIT_NODE_DISCOVERY_TIMEOUT_MS))
    ]);

    if (result === 'ready' || exitNodeReady) break;
    const action = await waitForExitNodeAction();
    if (action === 'skip') return false;

    terminal.clear();
    writeLine(networkIp ? `Tailscale connected: ${networkIp}` : 'Tailscale connected.');
    writeLine('Still waiting for an online Exit Node...');
  }

  return true;
}

async function connectNetworkBeforeBoot() {
  terminal.clear();
  writeLine('Starting Tailscale...');

  try {
    void Promise.resolve(cxInstance.networkLogin()).catch((error) => {
      console.warn('WebShell: Tailscale networkLogin failed', error);
    });
  } catch (error) {
    console.warn('WebShell: Tailscale networkLogin failed', error);
    return false;
  }

  const first = await Promise.race([
    networkRunningPromise.then(() => ({ kind: 'running' })),
    loginUrlPromise.then((url) => ({ kind: 'login', url })),
    new Promise((resolve) => setTimeout(() => resolve({ kind: 'slow' }), 12_000))
  ]);

  if (first.kind === 'slow') {
    writeLine('Tailscale is still starting; booting local-only shell.');
    return false;
  }

  if (first.kind === 'login') {
    const action = await waitForLoginAction(first.url);
    if (action === 'skip') return false;
  }

  try {
    if (networkState !== TAILSCALE_RUNNING) {
      await Promise.race([networkRunningPromise, timeout(10 * 60 * 1000)]);
    }
  } catch {
    writeLine('Tailscale login timed out; booting local-only shell.');
    return false;
  }

  return waitForExitNodeBeforeBoot();
}

async function configureGuestBase() {
  const resolvConf = [
    ...GUEST_DNS_SERVERS.map((server) => `nameserver ${server}`),
    'options timeout:2 attempts:3',
    ''
  ].join('\n');
  const escapedDns = resolvConf.replace(/'/g, `'\\''`);

  try {
    await cxInstance.run('/bin/sh', [
      '-c',
      `printf '%s\\n' '${GUEST_HOSTNAME}' > /etc/hostname; ` +
      `hostname '${GUEST_HOSTNAME}' 2>/dev/null || true; ` +
      `printf '%s' '${escapedDns}' > /etc/resolv.conf`
    ], { cwd: '/', uid: 0, gid: 0 });
  } catch (error) {
    console.warn('WebShell: failed to configure guest hostname/DNS', error);
  }
}

async function boot() {
  if (!crossOriginIsolated) {
    throw new Error('Cross-origin isolation is disabled. COOP/COEP headers are required for CheerpX.');
  }

  terminal.write('Booting WebShell...\r\n');

  const baseDisk = await createBaseDisk();
  const overlayStore = await CheerpX.IDBDevice.create(OVERLAY_ID);
  const rootDisk = await CheerpX.OverlayDevice.create(baseDisk, overlayStore);
  const webDevice = await CheerpX.WebDevice.create('');

  const mounts = [
    { type: 'ext2', path: '/', dev: rootDisk },
    { type: 'dir', path: '/web', dev: webDevice },
    { type: 'devs', path: '/dev' },
    { type: 'devpts', path: '/dev/pts' },
    { type: 'proc', path: '/proc' },
    { type: 'sys', path: '/sys' }
  ];

  cxInstance = await CheerpX.Linux.create({
    mounts,
    networkInterface: createNetworkInterface()
  });
  attachCheerpXConsole();

  await configureGuestBase();
  const publicInternetReady = await connectNetworkBeforeBoot();
  if (publicInternetReady) await configureGuestBase();

  terminal.reset();
  terminal.clear();
  terminal.resize(guestCols, guestRows);
  terminal.refresh(0, guestRows - 1);
  terminal.focus();

  const env = [
    'HOME=/root',
    'USER=root',
    'LOGNAME=root',
    'SHELL=/bin/sh',
    'TERM=xterm-256color',
    'COLORTERM=truecolor',
    'LANG=C.UTF-8',
    'LC_ALL=C.UTF-8',
    `COLUMNS=${guestCols}`,
    `LINES=${guestRows}`,
    'PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin'
  ];

  const result = await cxInstance.run('/bin/sh', ['-l'], {
    cwd: '/root',
    uid: 0,
    gid: 0,
    env
  });

  writeLine(`Shell exited with status ${result.status}. Reload the page to restart.`);
}

function registerServiceWorker() {
  if (!('serviceWorker' in navigator) || !import.meta.env.PROD) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch((error) => {
      console.warn('WebShell: service worker registration failed', error);
    });
  });
}

async function main() {
  registerServiceWorker();
  updateViewportCSSVars();
  await createTerminal();

  try {
    await boot();
  } catch (error) {
    console.error(error);
    terminal.write('\x1b[31mWebShell failed to boot.\x1b[0m\r\n');
    terminal.write(`${error?.stack || error}\r\n`);
    terminal.focus();
  }
}

main();
