"""Windows Edge update/preview regression: python tests/pwa_update_smoke.py."""
import base64, hashlib, json, os, socket, struct, subprocess, tempfile, time, urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
profile = tempfile.mkdtemp(prefix='music-player-edge-')
port = 19361
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
    for attempt in range(15):
        try:
            pages = json.load(urllib.request.urlopen(f'http://127.0.0.1:{port}/json', timeout=1))
            break
        except Exception:
            print('Waiting for Edge', browser.poll(), flush=True)
            time.sleep(.1)
    cdp = CDP(next(p['webSocketDebuggerUrl'] for p in pages if p['type'] == 'page'))
    cdp.call('Runtime.enable')
    cdp.call('Page.enable')
    cdp.call('Page.addScriptToEvaluateOnNewDocument', {'source': 'Object.defineProperty(window,"PracticeAudio",{configurable:true,get(){return this._testPracticeAudio;},set(Class){this._testPracticeAudio=class extends Class{constructor(...args){super(...args);window.testAudio=this;}};}});'})
    cdp.call('Emulation.setDeviceMetricsOverride', {'width': 1440, 'height': 1150, 'deviceScaleFactor': 1, 'mobile': False})
    cdp.call('Page.navigate', {'url': (ROOT / 'index.html').as_uri()})
    time.sleep(.6)
    helpers = r'''
      window.check = (condition, label) => { if (!condition) throw new Error(label); return label; };
      window.key = (key, code, shiftKey=false, repeat=false) => (document.activeElement || document.body).dispatchEvent(new KeyboardEvent('keydown', {key, code, shiftKey, repeat, bubbles:true, cancelable:true}));
      window.waitFor = async (predicate) => { for (let i=0;i<100;i++) { if (predicate()) return; await new Promise(r=>setTimeout(r,20)); } throw Error('Timed out'); };
      window.makeFile = (name='practice.wav') => {
        const rate=8000, count=rate*65, bytes=new ArrayBuffer(44+count*2), v=new DataView(bytes);
        const text=(offset,s)=>[...s].forEach((c,i)=>v.setUint8(offset+i,c.charCodeAt(0)));
        text(0,'RIFF');v.setUint32(4,36+count*2,true);text(8,'WAVE');text(12,'fmt ');v.setUint32(16,16,true);v.setUint16(20,1,true);v.setUint16(22,1,true);v.setUint32(24,rate,true);v.setUint32(28,rate*2,true);v.setUint16(32,2,true);v.setUint16(34,16,true);text(36,'data');v.setUint32(40,count*2,true);
        for(let i=0;i<count;i++)v.setInt16(44+i*2, Math.sin(i*2*Math.PI*220/rate)*1000,true);
        return new File([bytes], name, {type:'audio/wav'});
      };
      window.loadTestFile = async (name='practice.wav', drop=true) => {
        const transfer = new DataTransfer(); transfer.items.add(makeFile(name));
        if(drop) document.dispatchEvent(new DragEvent('drop',{dataTransfer:transfer,bubbles:true,cancelable:true}));
        else { const input=document.getElementById('file-input');input.files=transfer.files; input.dispatchEvent(new Event('change',{bubbles:true})); }
        await waitFor(()=>!document.getElementById('play').disabled);
      };
    '''
    cdp.js(helpers)
    import shutil, importlib.util
    from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
    from threading import Thread
    site=Path(tempfile.mkdtemp(prefix='mpp-update-test-'))
    for name in ['index.html','style.css','app.js','practice-audio.js','audio-store.js','lyrics.js','waveform.js','pwa.js','recording-folder.js','looper-store.js','looper.js','looper-io.js','sw.js','manifest.webmanifest']:
        shutil.copy2(ROOT/name,site/name)
    shutil.copytree(ROOT/'icons',site/'icons');shutil.copytree(ROOT/'vendor',site/'vendor')
    spec=importlib.util.spec_from_file_location('mpp_preview',ROOT/'preview.py')
    preview=importlib.util.module_from_spec(spec);spec.loader.exec_module(preview);preview.ROOT=site
    preview_mode=False
    class Handler(preview.PreviewHandler):
        def log_message(self,*args):pass
        def do_GET(self):
            if preview_mode:super().do_GET()
            else:SimpleHTTPRequestHandler.do_GET(self)
    server=ThreadingHTTPServer(('127.0.0.1',0),Handler)
    Thread(target=server.serve_forever,daemon=True).start()
    url=f'http://127.0.0.1:{server.server_port}/'
    cdp.call('Page.navigate',{'url':url});time.sleep(.5)
    cdp.js('(async()=>{await navigator.serviceWorker.ready;})()')
    cdp.call('Page.reload');time.sleep(.6);cdp.js(helpers)
    before=cdp.js('performance.timeOrigin')
    cdp.js("document.getElementById('update-app').hidden=false;document.getElementById('update-app').click()")
    def wait_reload(before):
        for i in range(100):
            time.sleep(.1)
            try:
                if cdp.js('performance.timeOrigin')!=before and cdp.js("document.readyState==='complete'"):return
            except RuntimeError:pass
        raise AssertionError('Update did not reload')
    wait_reload(before);cdp.js(helpers)
    print('PASS: stale update button reloads even with no waiting worker',flush=True)
    cdp.js("localStorage.setItem('update-data-check','keep');caches.open('unrelated-cache')")
    page=site/'index.html';page.write_bytes(page.read_bytes().replace(b'<body ',b'<body data-update-test="new" '))
    worker=site/'sw.js';worker.write_bytes(worker.read_bytes().replace(b"'v32'",b"'test-update-v33'"))
    cdp.js('(async()=>{const r=await navigator.serviceWorker.getRegistration();await r.update();})()')
    for i in range(100):
        if cdp.js("!document.getElementById('update-app').hidden"):break
        time.sleep(.1)
    cdp.js("window.looperBusy=true;document.getElementById('update-app').click()")
    print(cdp.js("check(document.getElementById('update-status').textContent.includes('Finish recording'),'Blocked update explains why in visible UI');check(!document.body.dataset.updateTest,'Busy looper prevents reload')"),flush=True)
    before=cdp.js('performance.timeOrigin')
    cdp.js("window.looperBusy=false;document.getElementById('update-app').click()")
    wait_reload(before);cdp.js(helpers)
    print(cdp.js("check(document.body.dataset.updateTest==='new','Activated update delivers new HTML');check(localStorage.getItem('update-data-check')==='keep','Update preserves saved data')"),flush=True)
    preview_mode=True
    script=site/'app.js';script.write_bytes(script.read_bytes()+b'\nwindow.livePreviewRevision=1;\n')
    cdp.call('Page.navigate',{'url':url+'__preview__/'});time.sleep(.7);cdp.js(helpers)
    print(cdp.js("check(window.livePreviewRevision===1,'Preview bypasses old root-scope cache');check(document.getElementById('update-app').hidden,'Preview has no update button');check(localStorage.getItem('update-data-check')==='keep','Preview preserves existing app data')"),flush=True)
    script.write_bytes(script.read_bytes().replace(b'livePreviewRevision=1',b'livePreviewRevision=2'))
    cdp.call('Page.reload');time.sleep(.6);cdp.js(helpers)
    print(cdp.js("check(window.livePreviewRevision===2,'Ordinary reload gets edited files without version bump');(async()=>check((await navigator.serviceWorker.getRegistrations()).length===1,'Preview adds no service worker'))()"),flush=True)
    with urllib.request.urlopen(url+'__preview__/app.js') as response:assert 'no-store' in response.headers['Cache-Control']
    assert not cdp.errors,cdp.errors
    cdp.call('Browser.close');server.shutdown()
finally:
    try:browser.wait(timeout=5)
    except subprocess.TimeoutExpired:browser.terminate()
