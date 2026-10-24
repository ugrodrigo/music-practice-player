"""Sync regression: python tests/sync_smoke.py (isolated local clients; no cloud writes)."""
import base64, hashlib, json, os, socket, struct, subprocess, tempfile, time, urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
profile = tempfile.mkdtemp(prefix='music-player-edge-')
port = 19366
browser = subprocess.Popen([r'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe', '--headless=new', '--disable-gpu', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--no-first-run', '--no-default-browser-check', '--autoplay-policy=no-user-gesture-required', f'--remote-debugging-port={port}', f'--user-data-dir={profile}', 'about:blank'], stdout=subprocess.DEVNULL, stderr=open(Path(tempfile.gettempdir(), 'music-edge.log'),'w'), creationflags=subprocess.CREATE_NO_WINDOW)

class CDP:
    def __init__(self, url):
        from urllib.parse import urlparse
        parsed = urlparse(url)
        self.sock = socket.create_connection((parsed.hostname, parsed.port), 20)
        key = base64.b64encode(os.urandom(16)).decode()
        self.sock.sendall(f'GET {parsed.path} HTTP/1.1\r\nHost: {parsed.netloc}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: {key}\r\nSec-WebSocket-Version: 13\r\n\r\n'.encode())
        header = b''
        while not header.endswith(b'\r\n\r\n'): header += self.sock.recv(1)
        assert header.startswith(b'HTTP/1.1 101 '), header
        self.seq = 0
        self.errors = []
    def read(self, n):
        result = b''
        while len(result) < n:
            chunk = self.sock.recv(n - len(result))
            if not chunk: raise EOFError()
            result += chunk
        return result
    def recv(self):
        first, second = self.read(2)
        length = second & 127
        if length == 126: length = struct.unpack('!H', self.read(2))[0]
        if length == 127: length = struct.unpack('!Q', self.read(8))[0]
        data = self.read(length)
        return json.loads(data)
    def call(self, method, params=None):
        print('CHECK', method, flush=True)
        self.seq += 1
        data = json.dumps({'id': self.seq, 'method': method, 'params': params or {}}).encode()
        mask = os.urandom(4)
        header = bytes([129, 128 | len(data)]) if len(data) < 126 else (bytes([129, 254]) + struct.pack('!H', len(data)) if len(data) < 65536 else bytes([129,255]) + struct.pack('!Q', len(data)))
        self.sock.sendall(header + mask + bytes(b ^ mask[i % 4] for i, b in enumerate(data)))
        while True:
            message = self.recv()
            if message.get('method') == 'Runtime.consoleAPICalled': print(message, flush=True)
            if message.get('method') == 'Runtime.exceptionThrown': self.errors.append(message)
            if message.get('id') == self.seq:
                if 'error' in message: raise RuntimeError(message)
                return message.get('result', {})
    def js(self, expression):
        result = self.call('Runtime.evaluate', {'expression': expression, 'awaitPromise': True, 'returnByValue': True, 'userGesture': True})
        if 'exceptionDetails' in result: raise RuntimeError(json.dumps(result))
        return result.get('result', {}).get('value')

try:
    for attempt in range(30):
        try:
            pages = json.load(urllib.request.urlopen(f'http://127.0.0.1:{port}/json', timeout=1))
            break
        except Exception: time.sleep(.2)
    cdp = CDP(next(p['webSocketDebuggerUrl'] for p in pages if p['type'] == 'page'))
    cdp.call('Runtime.enable')
    cdp.call('Page.enable')
    source = (ROOT / 'src/js/sync-store.js').read_text(encoding='utf-8')
    cdp.js('window.syncSource = ' + json.dumps(source))
    print(cdp.js(r'''(async () => {
      const check = (value, message) => { if (!value) throw Error(message); };
      const clone = x => JSON.parse(JSON.stringify(x));
      function client() {
        const frame = document.createElement('iframe'); document.body.append(frame);
        const win = frame.contentWindow, storage = new Map();
        Object.defineProperty(win, 'localStorage', {value: {
          getItem: key => storage.get(key) ?? null,
          setItem: (key, value) => storage.set(key, value),
        }});
        Object.defineProperty(win.navigator, 'onLine', {value: true, configurable: true});
        win.eval(syncSource); return {win, sync: win.PracticeSync, storage};
      }
      const cloud = {}, listeners = new Set();
      const remote = () => ({
        watch(next) { listeners.add(next); next(clone(cloud)); return () => listeners.delete(next); },
        async write(key, value, revision) {
          const existing = cloud[key] || {value: null, revision: 0};
          if (existing.revision !== revision) return {conflict: clone(existing)};
          cloud[key] = {value: clone(value), revision: revision + 1};
          listeners.forEach(next => next(clone(cloud)));
          return {revision: revision + 1};
        },
      });
      const a = client(), b = client();
      a.sync.put('notes', 'guest notes');
      a.sync.setAccount('alice', remote()); b.sync.setAccount('alice', remote());
      check(a.sync.get('notes') === null, 'Guest notes must not leak into account');
      a.sync.importGuest(); await a.sync.flush();
      check(b.sync.get('notes') === 'guest notes', 'Explicit import syncs');
      check(!a.sync.state().pending && !a.sync.state().conflicts.length, 'Own echo is acknowledged');
      a.sync.put('notes', 'new notes'); await a.sync.flush();
      check(b.sync.get('notes') === 'new notes', 'Second device receives update');
      a.sync.put('notes', {format: 'html-v1', html: '<strong>formatted notes</strong>'}); await a.sync.flush();
      check(b.sync.get('notes').html === '<strong>formatted notes</strong>', 'Formatted notes sync');
      a.sync.put('track-a-cue-0', {time: 3, name: 'Intro'});
      b.sync.put('track-a-cue-1', {time: 8, name: 'Verse'});
      await a.sync.flush(); await b.sync.flush();
      check(a.sync.get('track-a-cue-1').time === 8 && b.sync.get('track-a-cue-0').time === 3, 'Independent cues merge');
      b.sync.setAccount('alice');
      Object.defineProperty(b.win.navigator, 'onLine', {value: false, configurable: true});
      b.sync.put('notes', 'offline edit');
      a.sync.put('notes', 'online edit'); await a.sync.flush();
      b.sync.setAccount('alice', remote());
      check(b.sync.get('notes') === 'offline edit', 'Offline edit persists');
      check(b.sync.state().conflicts[0].cloud === 'online edit', 'Both conflicting versions preserved');
      b.sync.resolve('notes', 'local');
      Object.defineProperty(b.win.navigator, 'onLine', {value: true, configurable: true});
      await b.sync.flush();
      check(a.sync.get('notes') === 'offline edit', 'Conflict resolution syncs');
      a.sync.put('track-a-cue-0', null); await a.sync.flush();
      check(b.sync.get('track-a-cue-0') === null, 'Cue reset syncs');
      a.sync.setAccount('bob');
      check(a.sync.get('notes') === null, 'Account isolation');
      a.sync.setAccount(null);
      check(a.sync.get('notes') === 'guest notes', 'Sign out restores guest');
      let release;
      const delayed = {watch(next) {next({}); return () => {};}, write: () => new Promise(resolve => release = resolve)};
      a.sync.setAccount('carol', delayed); a.sync.put('notes', 'private');
      const pending = a.sync.flush(); a.sync.setAccount('bob');
      release({revision: 1}); await pending;
      check(a.sync.get('notes') === null && !a.sync.state().pending, 'Late write does not enter another account');
      a.sync.setAccount(null); b.sync.setAccount(null);
      return 'PASS: two-device sync, explicit migration, independent cues, offline persistence, conflicts, resets, sign-out and in-flight account switch';
    })()'''), flush=True)
    assert not cdp.errors, cdp.errors
    cdp.call('Browser.close')
finally:
    try: browser.wait(timeout=5)
    except subprocess.TimeoutExpired: browser.terminate()
