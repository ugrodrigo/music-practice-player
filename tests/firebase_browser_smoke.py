"""Two browser profiles against Firebase Auth and Firestore emulators. Run npm run test:sync-browser."""
import base64, hashlib, json, os, socket, struct, subprocess, tempfile, time, urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
assert os.environ.get('FIRESTORE_EMULATOR_HOST') == '127.0.0.1:18080'
assert os.environ.get('FIREBASE_AUTH_EMULATOR_HOST') == '127.0.0.1:19099'
profile = tempfile.mkdtemp(prefix='music-player-edge-')
port = 19368
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

from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from functools import partial
from threading import Thread

class TestServer(SimpleHTTPRequestHandler):
    def log_message(self, *args): pass
    def do_GET(self):
        path = self.path.split('?')[0]
        if path == '/src/js/firebase-config.js':
            body = "export const firebaseConfig = {apiKey:'demo-key',projectId:'demo-music-practice',authDomain:'localhost',appId:'demo-app'}; export const appCheckSiteKey = 'emulator-only';"
        elif path == '/src/js/firebase-app-check.js':
            body = 'export async function startAppCheck() {}'  # Emulators do not attest browsers.
        elif path == '/src/js/firebase-sync.js':
            body = (ROOT / 'src/js/firebase-sync.js').read_text(encoding='utf-8')
            auth_line = 'auth = api.getAuth(app);'
            db_line = 'db = api.initializeFirestore(app, { localCache: api.memoryLocalCache() });'
            assert body.count(auth_line) == body.count(db_line) == 1
            body = body.replace(auth_line, auth_line + "api.connectAuthEmulator(auth, 'http://127.0.0.1:19099', {disableWarnings:true});")
            body = body.replace(db_line, db_line + "api.connectFirestoreEmulator(db, '127.0.0.1', 18080);")
        elif path == '/sw.js':
            self.send_error(404); return  # Never cache the test-only emulator overrides.
        else:
            return super().do_GET()
        payload = body.encode('utf-8')
        self.send_response(200)
        self.send_header('Content-Type', 'text/javascript; charset=utf-8')
        self.send_header('Cache-Control', 'no-store')
        self.send_header('Content-Length', str(len(payload)))
        self.end_headers(); self.wfile.write(payload)

def connect(debug_port):
    for attempt in range(40):
        try:
            pages = json.load(urllib.request.urlopen(f'http://127.0.0.1:{debug_port}/json', timeout=1))
            return CDP(next(p['webSocketDebuggerUrl'] for p in pages if p['type'] == 'page'))
        except Exception: time.sleep(.2)
    raise RuntimeError('Browser did not start')

def wait(client, expression, label):
    deadline = time.monotonic() + 30
    while time.monotonic() < deadline:
        if client.js(expression): return
        time.sleep(.2)
    raise AssertionError(label + ': ' + str(client.js("document.getElementById('sync-status').textContent")))

def account(email):
    request = urllib.request.Request('http://127.0.0.1:19099/identitytoolkit.googleapis.com/v1/accounts:signUp?key=demo-key',
        data=json.dumps({'email': email, 'password': 'test-only-password', 'returnSecureToken': True}).encode(),
        headers={'Content-Type': 'application/json'})
    with urllib.request.urlopen(request) as response: return json.load(response)['localId']

def signin(client, email, uid):
    client.js("(async()=>{const sdk=await import('https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js');await sdk.signInWithEmailAndPassword(sdk.getAuth()," + json.dumps(email) + ", 'test-only-password');})()")
    wait(client, 'PracticeSync.owner === ' + json.dumps(uid) + ' && PracticeSync.state().connected', 'Account connection')

server = ThreadingHTTPServer(('127.0.0.1', 0), partial(TestServer, directory=str(ROOT)))
Thread(target=server.serve_forever, daemon=True).start()
second = None
try:
    args = list(browser.args)
    args = [f'--remote-debugging-port={port + 1}' if arg.startswith('--remote-debugging-port=')
            else f'--user-data-dir={tempfile.mkdtemp(prefix="music-sync-second-")}' if arg.startswith('--user-data-dir=') else arg for arg in args]
    second = subprocess.Popen(args, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, creationflags=subprocess.CREATE_NO_WINDOW)
    a, b = connect(port), connect(port + 1)
    for client in [a, b]:
        client.call('Runtime.enable'); client.call('Page.enable'); client.call('Network.enable')
        # Emulator traffic is loopback only. Block accidental production Google API calls.
        client.call('Network.setBlockedURLs', {'urls': ['https://*.googleapis.com/*']})
        client.call('Page.navigate', {'url': f'http://localhost:{server.server_port}/'})
        wait(client, "!!window.PracticeSync && !!document.getElementById('sync-signin')", 'Page loads')
        client.js("(async()=>{const sdk=await import('https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js');for(let i=0;i<100;i++){try{await sdk.getAuth().authStateReady();return;}catch{await new Promise(r=>setTimeout(r,50));}}throw Error('Auth startup');})()")
    alice = account('alice@example.test'); bob = account('bob@example.test')
    signin(a, 'alice@example.test', alice); signin(b, 'alice@example.test', alice)
    a.js("document.getElementById('lyrics-notes').click();const field=document.getElementById('notes-text');field.value='From desktop';field.dispatchEvent(new Event('input'))")
    wait(b, "document.getElementById('notes-text').value === 'From desktop'", 'Notes arrive in second profile')
    wait(a, '!PracticeSync.state().pending', 'First note acknowledged')
    print('PASS: real SDK authentication, owner rules, transactions and note snapshots across separate profiles', flush=True)

    cue = 'track-' + 'a' * 64 + '-cue-'
    a.js('PracticeSync.put(' + json.dumps(cue + '0') + ', {time:3,name:"Intro"})')
    b.js('PracticeSync.put(' + json.dumps(cue + '1') + ', {time:8,name:"Verse"})')
    wait(a, 'PracticeSync.get(' + json.dumps(cue + '1') + ')?.time === 8', 'Second cue arrives')
    wait(b, 'PracticeSync.get(' + json.dumps(cue + '0') + ')?.time === 3', 'First cue arrives')
    a.js('PracticeSync.put(' + json.dumps(cue + '0') + ', null)')
    wait(b, 'PracticeSync.get(' + json.dumps(cue + '0') + ') === null', 'Cue reset arrives')
    print('PASS: independent cues and resets sync through Firestore', flush=True)

    b.call('Network.emulateNetworkConditions', {'offline': True, 'latency': 0, 'downloadThroughput': -1, 'uploadThroughput': -1})
    b.js("PracticeSync.put('notes', 'Offline phone edit')")
    a.js("PracticeSync.put('notes', 'Online desktop edit')")
    wait(a, '!PracticeSync.state().pending', 'Online edit saved')
    b.call('Network.emulateNetworkConditions', {'offline': False, 'latency': 0, 'downloadThroughput': -1, 'uploadThroughput': -1})
    wait(b, 'PracticeSync.state().conflicts.length === 1', 'Offline conflict detected')
    b.js("PracticeSync.resolve('notes','local')")
    wait(a, "document.getElementById('notes-text').value === 'Offline phone edit'", 'Chosen version reaches other profile')
    wait(b, '!PracticeSync.state().pending', 'Resolution acknowledged')
    print('PASS: offline conflict preserves both versions and chosen version syncs', flush=True)

    b.call('Page.reload')
    wait(b, "window.PracticeSync?.get('notes') === 'Offline phone edit' && PracticeSync.state().connected", 'Reload restores signed-in account and notes')
    b.js("document.getElementById('sync-signout').click()")
    wait(b, "PracticeSync.owner === 'guest' && document.getElementById('notes-text').value === ''", 'Sign-out hides account notes')
    signin(b, 'bob@example.test', bob)
    assert b.js("PracticeSync.get('notes') === null && document.getElementById('notes-text').value === ''")
    b.js("PracticeSync.put('notes','Bob private')")
    wait(b, '!PracticeSync.state().pending', 'Bob note saved')
    assert a.js("PracticeSync.get('notes') === 'Offline phone edit'")
    print('PASS: auth persistence, sign-out and switching accounts isolate notes', flush=True)
    assert not a.errors and not b.errors, (a.errors, b.errors)
finally:
    for process in [browser, second]:
        if process and process.poll() is None:
            process.terminate(); process.wait(timeout=10)
    server.shutdown()
