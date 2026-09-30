"""Windows Edge smoke test: python tests/looper_smoke.py (fake microphone, isolated profile)."""
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
    cdp.call('Page.addScriptToEvaluateOnNewDocument', {'source': 'window.OriginalAudio = Audio; window.Audio = function(...args) { const a = new OriginalAudio(...args); window.testAudio = a; return a; };'})
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
    import shutil
    from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
    from functools import partial
    from threading import Thread
    stage=Path(tempfile.mkdtemp(prefix='mpp-pwa-site-'))
    site=stage/'music-practice-player'
    site.mkdir()
    for name in ['index.html','style.css','app.js','audio-store.js','lyrics.js','waveform.js','pwa.js','recording-folder.js','looper-store.js','looper.js','sw.js','manifest.webmanifest']:
        shutil.copy2(ROOT/name,site/name)
    shutil.copytree(ROOT/'icons',site/'icons')
    class QuietHandler(SimpleHTTPRequestHandler):
        def log_message(self,*args): pass
    server=ThreadingHTTPServer(('127.0.0.1',0),partial(QuietHandler,directory=str(stage)))
    Thread(target=server.serve_forever,daemon=True).start()
    url=f'http://127.0.0.1:{server.server_port}/music-practice-player/'
    cdp.call('Emulation.setDeviceMetricsOverride',{'width':390,'height':844,'deviceScaleFactor':1,'mobile':False})
    cdp.call('Page.addScriptToEvaluateOnNewDocument',{'source':"window.showDirectoryPicker=async()=>{if(window.cancelPicker)throw new DOMException('Cancelled','AbortError');return (await navigator.storage.getDirectory()).getDirectoryHandle('test-recordings',{create:true});};"})
    cdp.call('Page.navigate',{'url':url})
    time.sleep(.5)
    cdp.js(helpers)
    print(cdp.js(r'''(async()=>{
      window.el=id=>document.getElementById('looper-'+id);
      window.waitLong=async predicate=>{for(let i=0;i<300;i++){if(await predicate())return;await new Promise(r=>setTimeout(r,30));}throw Error('Looper timeout: '+el('status').textContent+' / '+el('save-status').textContent);};
      await loadTestFile('looper-practice.wav');await testAudio.play();
      window.cancelPicker=false;
      document.getElementById('mode-looper').click();
      check(testAudio.paused,'Practice pauses on mode switch');
      check(getComputedStyle(document.querySelector('.practice-content')).display==='none','Practice hidden');
      el('folder').click();await waitLong(()=>RecordingFolder.name==='test-recordings');
      el('record').click();await waitLong(()=>el('record').textContent==='Recording...');
      document.getElementById('mode-practice').click();check(document.body.dataset.appMode==='looper','Mode protected during recording');
      await new Promise(r=>setTimeout(r,1400));el('stop').click();
      await waitLong(()=>!el('play').disabled);
      check(el('save-status').textContent==='Saved on this device.','Recording saved');
      const list=await LooperStore.list();check(list.length===1&&list[0].duration>1,'Actual MediaRecorder capture decoded');window.savedId=list[0].id;
      await waitLong(()=>el('folder-status').textContent.startsWith('Saved to'));
      const dir=await(await navigator.storage.getDirectory()).getDirectoryHandle('test-recordings');
      const file=await(await dir.getFileHandle(list[0].fileName+'.wav')).getFile();
      check(new TextDecoder().decode((await file.arrayBuffer()).slice(0,4))==='RIFF','Folder contains real WAV');
      el('start').value='.15';el('start').dispatchEvent(new Event('change'));
      el('end').value=String(list[0].duration-.15);el('end').dispatchEvent(new Event('change'));
      el('name').value='Guitar phrase';el('name').dispatchEvent(new Event('input'));
      await waitLong(async()=> (await LooperStore.read(savedId)).name==='Guitar phrase');
      el('play').click();await waitLong(()=>el('status').textContent.startsWith('Loop playing'));
      check(!el('stop').disabled,'Loop plays');el('later').click();el('later').click();await new Promise(r=>setTimeout(r,100));el('stop').click();
      el('seam').click();await waitLong(()=>el('status').textContent.startsWith('Previewing'));await waitLong(()=>el('stop').disabled);
      el('zoom').value='4';el('zoom').dispatchEvent(new Event('change'));check(!el('pan').disabled,'Waveform zoom pans');
      window.downloads=[];HTMLAnchorElement.prototype.click=function(){if(this.download){const name=this.download;downloads.push(fetch(this.href).then(async r=>({name,bytes:await r.arrayBuffer()})));}};
      el('export-loop').click();await waitLong(()=>downloads.length===1);
      const output=await downloads[0],data=new DataView(output.bytes);
      check(output.name.endsWith('_loop.wav')&&data.getUint32(40,true)>0,'Trimmed WAV export');
      check(Math.abs(data.getUint32(40,true)/data.getUint32(28,true)-(Number(el('end').value)-Number(el('start').value)))<.002,'Export matches trim');
      return 'PASS: real simulated microphone, loop, trim, seam, zoom, WAV export, autosave and folder copy';
    })()'''),flush=True)
    for width in [320,390,760,1366]:
        cdp.call('Emulation.setDeviceMetricsOverride',{'width':width,'height':844,'deviceScaleFactor':1,'mobile':False})
        time.sleep(.1)
        print(cdp.js("check(document.documentElement.scrollWidth<=innerWidth,'Looper fits viewport');check(document.getElementById('looper-stop').getBoundingClientRect().right<=innerWidth,'Transport fits')"),flush=True)
    cdp.call('Emulation.setDeviceMetricsOverride',{'width':390,'height':844,'deviceScaleFactor':1,'mobile':False})
    screenshot=cdp.call('Page.captureScreenshot',{'format':'png'})
    Path(tempfile.gettempdir(),'music-looper-mobile.png').write_bytes(base64.b64decode(screenshot['data']))
    cdp.js('(async()=>{await navigator.serviceWorker.ready;})()')
    cdp.call('Network.enable')
    cdp.call('Network.emulateNetworkConditions',{'offline':True,'latency':0,'downloadThroughput':-1,'uploadThroughput':-1})
    cdp.call('Page.reload');time.sleep(.5);cdp.js(helpers)
    print(cdp.js(r'''(async()=>{
      window.el=id=>document.getElementById('looper-'+id);
      window.waitLong=async predicate=>{for(let i=0;i<300;i++){if(await predicate())return;await new Promise(r=>setTimeout(r,30));}throw Error('Looper timeout: '+el('status').textContent);};
      document.getElementById('mode-looper').click();el('saved').click();
      await waitLong(()=>document.querySelector('#looper-library-list button'));
      document.querySelector('#looper-library-list button').click();await waitLong(()=>!el('play').disabled);
      check(el('name').value==='Guitar phrase'&&Number(el('start').value)===.15,'Recording and trims restored');
      const real=navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
      navigator.mediaDevices.getUserMedia=async()=>{throw new DOMException('Blocked','NotAllowedError');};
      el('record').click();await waitLong(()=>el('status').textContent.includes('permission denied'));
      check(!el('play').disabled,'Permission denial preserves old recording');
      navigator.mediaDevices.getUserMedia=async()=>{const stream=await real({audio:true});window.delayedStream=stream;await new Promise(r=>setTimeout(r,400));return stream;};
      el('record').click();await waitLong(()=>window.delayedStream);el('stop').click();await new Promise(r=>setTimeout(r,600));
      check(delayedStream.getTracks().every(t=>t.readyState==='ended'),'Cancelled microphone request releases tracks');
      navigator.mediaDevices.getUserMedia=real;
      const save=LooperStore.save;LooperStore.save=async()=>{throw Error('Quota');};
      el('name').value='Unsaved rename';el('name').dispatchEvent(new Event('input'));
      await waitLong(()=>el('save-status').textContent.includes('Local save failed'));
      check(!el('export-full').disabled,'Save failure keeps download available');
      LooperStore.save=save;el('name').value='Recovered';el('name').dispatchEvent(new Event('input'));await waitLong(()=>el('save-status').textContent==='Saved on this device.');
      window.confirm=()=>true;el('saved').click();await waitLong(()=>document.querySelector('#looper-library-list button'));
      document.querySelector('#looper-library-list button:last-child').click();await waitLong(async()=>!(await LooperStore.list()).length);
      check(el('play').disabled,'Delete clears current loop');el('library-close').click();
      document.getElementById('mode-practice').click();check(document.body.dataset.appMode==='practice','Practice remains available');
      return 'PASS: saved library restore, permission denial, cancelled capture cleanup, quota recovery, delete and mode switching';
    })()'''),flush=True)
    assert not cdp.errors,cdp.errors
    cdp.call('Browser.close')
    server.shutdown()

finally:
    try: browser.wait(timeout=5)
    except subprocess.TimeoutExpired: browser.terminate()
