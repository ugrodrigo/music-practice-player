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
    import shutil
    from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
    from functools import partial
    from threading import Thread
    stage=Path(tempfile.mkdtemp(prefix='mpp-pwa-site-'))
    site=stage/'music-practice-player'
    site.mkdir()
    for name in ['index.html','style.css','app.js','practice-audio.js','audio-store.js','lyrics.js','waveform.js','pwa.js','recording-folder.js','looper-store.js','looper.js','looper-io.js','sw.js','manifest.webmanifest']:
        shutil.copy2(ROOT/name,site/name)
    shutil.copytree(ROOT/'icons',site/'icons')
    shutil.copytree(ROOT/'vendor',site/'vendor')
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
      await loadTestFile('looper-practice.wav');
      testAudio.pause();testAudio.currentTime=10;
      document.activeElement?.blur();key('ArrowRight','ArrowRight');check(testAudio.currentTime===10.5,'Arrow seeks 0.5s');
      key('[','BracketLeft');check(testAudio.currentTime===8.5,'Bracket seeks 2s while paused');
      key('ArrowRight','ArrowRight',true);check(testAudio.currentTime===13.5,'Shift arrow stays 5s');
      const slider=document.getElementById('practice-volume-slider'),toggle=document.getElementById('volume-toggle');
      toggle.click();check(toggle.getAttribute('aria-expanded')==='true','Mobile fader opens');
      slider.value='40';slider.dispatchEvent(new Event('input'));check(Math.abs(testAudio.volume-.16)<.001,'Practice volume taper applied');
      slider.focus();key('ArrowRight','ArrowRight');check(testAudio.currentTime===13.5,'Focused volume does not seek');
      document.getElementById('volume-mute').click();check(testAudio.volume===0,'Mute');
      document.getElementById('volume-mute').click();check(Math.abs(testAudio.volume-.16)<.001,'Unmute restores volume');
      document.body.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true}));check(toggle.getAttribute('aria-expanded')==='false','Outside closes fader');
      toggle.click();key('Escape','Escape');check(toggle.getAttribute('aria-expanded')==='false','Escape closes fader');
      await loadTestFile('volume-next.wav');check(Math.abs(testAudio.volume-.16)<.001,'Volume survives song replacement');
      await testAudio.play();
      window.cancelPicker=false;
      document.getElementById('mode-looper').click();
      check(testAudio.paused,'Practice pauses on mode switch');
      check(getComputedStyle(document.querySelector('.practice-content')).display==='none','Practice hidden');
      const io=id=>document.getElementById('io-'+id);
      document.getElementById('looper-io').open=true;
      io('refresh').click();await waitLong(()=>!io('refresh').disabled&&io('input').options.length>1);
      const mic=[...io('input').options].find(o=>o.value&&o.value!=='default'&&o.value!=='communications');
      check(!!mic,'Concrete microphone enumerated');io('input').value=mic.value;io('input').dispatchEvent(new Event('change'));
      const nativeInput=navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
      window.requestedInputs=[];window.inputStreams=[];
      navigator.mediaDevices.getUserMedia=async constraints=>{requestedInputs.push(constraints);const stream=await nativeInput(constraints);inputStreams.push(stream);return stream;};
      io('test-input').click();await waitLong(()=>io('status').textContent.startsWith('Speak'));
      check(requestedInputs.at(-1).audio.deviceId.exact===mic.value,'Input test requests the selected device exactly');
      check(io('active').textContent.includes('Microphone:'),'Active microphone identified');
      io('test-input').click();check(inputStreams.at(-1).getTracks().every(t=>t.readyState==='ended'),'Input test releases microphone');
      io('test-output').click();await waitLong(()=>io('status').textContent.startsWith('Test tone sent'));
      if(typeof AudioContext.prototype.setSinkId==='function'){
        io('output').add(new Option('Missing output','missing-output-test'));io('output').value='missing-output-test';io('output').dispatchEvent(new Event('change'));
        const requests=requestedInputs.length;el('record').click();await waitLong(()=>el('status').textContent.includes('Selected output is unavailable'));
        check(requestedInputs.length===requests,'Unavailable output prevents capture instead of silently rerouting');
        io('output').value='';io('output').dispatchEvent(new Event('change'));
      }
      io('input').add(new Option('Missing lapel','missing-input-test'));io('input').value='missing-input-test';io('input').dispatchEvent(new Event('change'));
      const requests=requestedInputs.length;el('record').click();await waitLong(()=>el('status').textContent.startsWith('Could not start recording'));
      check(requestedInputs.length===requests+1&&requestedInputs.at(-1).audio.deviceId.exact==='missing-input-test','Missing input does not fall back to default');
      io('input').value=mic.value;io('input').dispatchEvent(new Event('change'));
      document.getElementById('looper-io').open=false;

      el('folder').click();await waitLong(()=>RecordingFolder.name==='test-recordings');
      window.startedSources=[];
      const nativeStart=AudioBufferSourceNode.prototype.start;
      AudioBufferSourceNode.prototype.start=function(...args){startedSources.push(this);return nativeStart.apply(this,args);};
      check(el('count-in').value==='0','Count-in defaults to Off');
      el('count-in').value='4';el('count-in').dispatchEvent(new Event('change'));
      const before=performance.now();el('record').click();
      await waitLong(()=>el('status').textContent.startsWith('Count in:'));
      check(el('bpm').disabled&&!el('stop').disabled,'Count-in locks settings but allows cancellation');
      await waitLong(()=>el('record').textContent==='Recording...');
      check(performance.now()-before>=2350,'Four beats at 100 BPM before recording');
      document.getElementById('mode-practice').click();check(document.body.dataset.appMode==='looper','Mode protected during recording');
      await new Promise(r=>setTimeout(r,1400));el('stop').click();
      await waitLong(()=>!el('play').disabled);
      check(el('save-status').textContent==='Saved on this device.','Recording saved');check(requestedInputs.at(-1).audio.deviceId.exact===mic.value,'Recorder uses the selected microphone');
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
      check(!el('stop').disabled,'Loop plays');const count=startedSources.length,playing=startedSources.at(-1);el('later').click();el('later').click();check(startedSources.length===count&&playing.loopEnd===Number(el('end').value),'Editing boundaries updates the live source without restart');await new Promise(r=>setTimeout(r,100));el('stop').click();
      el('seam').click();await waitLong(()=>el('status').textContent.startsWith('Previewing'));await waitLong(()=>el('stop').disabled);
      el('zoom').value='4';el('zoom').dispatchEvent(new Event('change'));check(!el('pan').disabled,'Waveform zoom pans');
      window.downloads=[];HTMLAnchorElement.prototype.click=function(){if(this.download){const name=this.download;downloads.push(fetch(this.href).then(async r=>({name,bytes:await r.arrayBuffer()})));}};
      el('export-loop').click();await waitLong(()=>downloads.length===1);
      const output=await downloads[0],data=new DataView(output.bytes);
      check(output.name.endsWith('_loop.wav')&&data.getUint32(40,true)>0,'Trimmed WAV export');
      check(Math.abs(data.getUint32(40,true)/data.getUint32(28,true)-(Number(el('end').value)-Number(el('start').value)))<.002,'Export matches trim');
      return 'PASS: real simulated microphone, loop, trim, seam, zoom, WAV export, autosave and folder copy';
    })()'''),flush=True)
    cdp.js("el('zoom').value='1';el('zoom').dispatchEvent(new Event('change'));window.trimBefore=[el('start').value,el('end').value];")
    rect=cdp.js("(()=>{const r=el('waveform').getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height};})()")
    center=rect['x']+rect['w']/2
    y=rect['y']+rect['h']/2
    for kind,points in [('touchStart',[(center-30,y),(center+30,y)]),('touchMove',[(center-65,y),(center+65,y)]),('touchEnd',[])]:
        cdp.call('Input.dispatchTouchEvent',{'type':kind,'touchPoints':[{'x':x,'y':ty,'id':i+1} for i,(x,ty) in enumerate(points)]})
    print(cdp.js("check(Number(el('zoom').value)>2,'Two-finger pinch zooms continuously');check(JSON.stringify(trimBefore)===JSON.stringify([el('start').value,el('end').value]),'Pinch preserves both markers')"),flush=True)
    cdp.js("document.getElementById('looper-io').open=true")
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
      check(document.getElementById('io-input').value===JSON.parse(localStorage.getItem('music-practice-player:audio-io')).input,'Microphone preference restored');
      document.getElementById('mode-looper').click();el('saved').click();
      await waitLong(()=>document.querySelector('#looper-library-list button'));
      document.querySelector('#looper-library-list button').click();await waitLong(()=>!el('play').disabled);
      check(el('name').value==='Guitar phrase'&&Number(el('start').value)===.15,'Recording and trims restored');
      el('bpm').value='180';el('bpm').dispatchEvent(new Event('change'));
      el('count-in').value='8';el('count-in').dispatchEvent(new Event('change'));
      const savedCount=(await LooperStore.list()).length;
      el('record').click();await waitLong(()=>el('status').textContent.startsWith('Count in:'));el('stop').click();
      await new Promise(r=>setTimeout(r,2800));
      check(!el('record').disabled&&el('status').textContent==='Recording cancelled.'&&(await LooperStore.list()).length===savedCount,'Cancelling count-in creates no recording');
      el('count-in').value='0';el('count-in').dispatchEvent(new Event('change'));
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
    for width in [320,360,390,760,1366]:
        cdp.call('Emulation.setDeviceMetricsOverride',{'width':width,'height':844,'deviceScaleFactor':1,'mobile':False})
        time.sleep(.1)
        print(cdp.js("check(document.documentElement.scrollWidth<=innerWidth,'Practice volume fits viewport');check(document.getElementById('volume-toggle').getBoundingClientRect().right<=innerWidth,'Volume button in frame')"),flush=True)
    print(cdp.js("check(document.getElementById('practice-volume-slider').value==='40','Volume preference restored after reload');document.getElementById('volume-toggle').click();check(document.getElementById('practice-volume-slider').value==='0','Desktop speaker mutes');document.getElementById('volume-toggle').click();check(document.getElementById('practice-volume-slider').value==='40','Desktop speaker unmutes')"),flush=True)
    cdp.call('Page.addScriptToEvaluateOnNewDocument',{'source':"Object.defineProperty(AudioContext.prototype,'setSinkId',{value:undefined,configurable:true});"})
    cdp.call('Page.reload');time.sleep(.6);cdp.js(helpers)
    print(cdp.js(r'''(async()=>{
      document.getElementById('mode-looper').click();
      const output=document.getElementById('io-output'),status=document.getElementById('io-status');
      await waitFor(()=>status.textContent.includes('Output selection is unavailable'));
      check(output.disabled&&output.value==='','Unsupported output stays on system default');
      check(document.getElementById('io-choose-output').hidden,'Unsupported permission picker hidden');
      document.getElementById('io-test-output').click();await waitFor(()=>status.textContent.startsWith('Test tone sent'));
      return 'PASS: unsupported output fallback and system-output test tone';
    })()'''),flush=True)
    assert not cdp.errors,cdp.errors
    cdp.js("localStorage.setItem('music-practice-player:count-in',JSON.stringify({bpm:120,beats:4}))")
    cdp.call('Page.reload');time.sleep(.5);cdp.js(helpers)
    print(cdp.js("check(document.getElementById('looper-count-in').value==='0'&&document.getElementById('looper-bpm').value==='120','Old count-in resets to Off while BPM survives');document.getElementById('looper-count-in').value='8';document.getElementById('looper-count-in').dispatchEvent(new Event('change'));"),flush=True)
    cdp.call('Page.reload');time.sleep(.5);cdp.js(helpers)
    print(cdp.js("check(document.getElementById('looper-count-in').value==='8','Explicit count-in choice survives later reloads')"),flush=True)
    cdp.call('Emulation.setDeviceMetricsOverride',{'width':1366,'height':1000,'deviceScaleFactor':1,'mobile':False})
    print(cdp.js(r'''(async()=>{
      document.getElementById('mode-practice').click();await loadTestFile('centered-waveform.wav');
      await waitFor(()=>!document.getElementById('waveform-zoom').disabled);
      window.wave=document.getElementById('waveform');wave.scrollIntoView({block:'center'});
      const ctx=wave.getContext('2d'),fill=ctx.fillRect;
      window.mainHeads=[];
      ctx.fillRect=function(x,y,w,h){if(this.fillStyle==='#f0f8db'&&y===0&&w===2)mainHeads.push(x);return fill.call(this,x,y,w,h);};
      window.checkHead=async()=>{await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));check(mainHeads.length>0&&mainHeads.every(x=>Math.abs(x-(wave.width/2-1))<.01),'Main playhead remains centered');mainHeads=[];};
      testAudio.pause();testAudio.currentTime=20;Waveform.update(20,65);await checkHead();
      return 'PASS: centered waveform setup';
    })()'''),flush=True)
    rect=cdp.js("(()=>{const r=wave.getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height};})()")
    for overview in [False,True]:
        y=rect['y']+rect['h']*(.9 if overview else .3)
        cdp.js("document.activeElement?.blur();key('1','Digit1',true);window.dragStartTime=testAudio.currentTime;document.querySelector('#cues input').focus()")
        gestures=[('mousePressed',.25),('mouseMoved',.65),('mouseReleased',.65)] if overview else [('mousePressed',.25),('mouseMoved',.65),('mouseMoved',.15),('mouseReleased',.15)]
        for kind,fraction in gestures:
            cdp.call('Input.dispatchMouseEvent',{'type':kind,'x':rect['x']+rect['w']*fraction,'y':y,'button':'left','buttons':0 if kind=='mouseReleased' else 1,'clickCount':1})
            if kind!='mouseReleased':cdp.js('checkHead()')
            if not overview:
                expected=0 if kind=='mousePressed' else (.25-fraction)*30
                # Main waveform starts with its default 30-second span.
                print(cdp.js(f"check(Math.abs(testAudio.currentTime-Math.max(0,Math.min(65,dragStartTime+{expected})))<.05,'Main scrub rewinds right and advances left without an initial jump')"),flush=True)
        print(cdp.js("check(testAudio.paused,'Seeking preserves paused state')"),flush=True)
        cdp.call('Input.dispatchKeyEvent',{'type':'keyDown','key':'1','code':'Digit1','windowsVirtualKeyCode':49})
        cdp.call('Input.dispatchKeyEvent',{'type':'keyUp','key':'1','code':'Digit1','windowsVirtualKeyCode':49})
        print(cdp.js("check(document.activeElement===wave,'Waveform takes focus from cue name');check(Math.abs(testAudio.currentTime-dragStartTime)<.05,'Real keyboard cue works after waveform drag')"),flush=True)
    print(cdp.js(r'''(async()=>{
      const zoom=document.getElementById('waveform-zoom');zoom.value='0';zoom.dispatchEvent(new Event('change'));
      await checkHead();testAudio.currentTime=0;Waveform.update(0,65);await checkHead();
      testAudio.currentTime=65;Waveform.update(65,65);await checkHead();
      testAudio.currentTime=20;await testAudio.play();await new Promise(r=>setTimeout(r,150));await checkHead();testAudio.pause();
      return 'PASS: centered main playhead during main/overview drags, track boundaries, full zoom and playback';
    })()'''),flush=True)
    assert not cdp.errors,cdp.errors
    print(cdp.js(r'''(async()=>{
      const el=id=>document.getElementById(id),wait=async predicate=>{for(let i=0;i<600;i++){if(predicate())return;await new Promise(r=>setTimeout(r,25));}throw Error('Stretch timeout: '+el('playback-engine-status').textContent);};
      const speed=el('speed'),seek=el('seek');
      check(!el('stretch-engine'),'Engine selector removed');
      speed.value='0.5';speed.dispatchEvent(new Event('change'));
      seek.value='10';seek.dispatchEvent(new Event('input'));
      await testAudio.play();
      check(testAudio.node&&testAudio.native.paused,'Signalsmith is the sole playback engine');
      const stretchGain=testAudio.gain;
      const analyser=stretchGain.context.createAnalyser();analyser.fftSize=8192;stretchGain.connect(analyser);
      await new Promise(r=>setTimeout(r,700));
      check(!testAudio.paused&&el('play-label').textContent==='Pause','Signalsmith is playing');
      check(Number(seek.value)>10.2&&Number(seek.value)<10.6,'Half-speed original timeline advances accurately');
      const samples=new Float32Array(analyser.fftSize);analyser.getFloatTimeDomainData(samples);
      let crosses=0,power=0;for(let i=1;i<samples.length;i++){if(samples[i-1]<=0&&samples[i]>0)crosses++;power+=samples[i]*samples[i];}
      const frequency=crosses*stretchGain.context.sampleRate/samples.length;
      check(Math.sqrt(power/samples.length)>.0001&&Math.abs(frequency-220)<12,'WASM output is audible and preserves 220Hz pitch at half speed: '+frequency);
      const slider=el('practice-volume-slider');slider.value='30';slider.dispatchEvent(new Event('input'));await new Promise(r=>setTimeout(r,60));
      check(Math.abs(stretchGain.gain.value-.09)<.01,'Volume controls experimental output');
      seek.value='30';seek.dispatchEvent(new Event('input'));await new Promise(r=>setTimeout(r,100));check(Math.abs(Number(seek.value)-30)<.15,'Seek stays in original song time');
      el('play').click();const paused=Number(seek.value);await new Promise(r=>setTimeout(r,150));check(Number(seek.value)===paused,'Experimental pause freezes position');
      document.activeElement?.blur();key('1','Digit1',true);seek.value='40';seek.dispatchEvent(new Event('input'));key('1','Digit1');check(Math.abs(Number(seek.value)-paused)<.01,'Cues preserve original timestamps');
      for(const id of ['practice-volume-slider','volume-toggle','speed']){
        seek.value='40';seek.dispatchEvent(new Event('input'));el(id).focus();key('1','Digit1');
        check(Math.abs(Number(seek.value)-paused)<.01,'Number cue works with focused '+id);
      }
      el('practice-volume-slider').focus();seek.value='25';seek.dispatchEvent(new Event('input'));key('@','Digit2',true);
      seek.value='40';seek.dispatchEvent(new Event('input'));key('2','Numpad2');check(Number(seek.value)===25,'Shift-number saving and numpad cues work from volume');
      const name=document.querySelector('#cues input');name.focus();key('1','Digit1');check(Number(seek.value)===25,'Typing in cue names does not jump');name.blur();
      seek.value=String(paused);seek.dispatchEvent(new Event('input'));

      await testAudio.play();
      speed.value='0.75';speed.dispatchEvent(new Event('change'));const before=Number(seek.value);await new Promise(r=>setTimeout(r,400));check(Number(seek.value)-before>.2&&Number(seek.value)-before<.45,'Rate changes follow original timeline');
      document.getElementById('mode-looper').click();check(el('play-label').textContent==='Play','Looper stops experimental practice');document.getElementById('mode-practice').click();
      seek.value='64.5';seek.dispatchEvent(new Event('input'));el('play').click();await wait(()=>el('play-label').textContent==='Pause');await wait(()=>el('play-label').textContent==='Play');check(Number(seek.value)>=64.99,'Experimental end of track stops');
      await loadTestFile('stretch-retry.wav');
      const factory=window.SignalsmithStretch;window.SignalsmithStretch=async()=>{throw Error('Simulated engine failure');};
      el('play').click();await wait(()=>el('playback-engine-status').textContent.includes('Simulated'));
      check(testAudio.paused&&testAudio.native.paused&&!el('play').disabled,'Initialization failure offers retry without native fallback');
      window.SignalsmithStretch=factory;el('play').click();await wait(()=>!testAudio.paused);
      check(!!testAudio.node,'Retry uses Signalsmith');
      testAudio.node.dispatchEvent(new Event('processorerror'));
      check(testAudio.paused&&el('playback-engine-status').textContent.includes('retry'),'Processor failure pauses with feedback');
      el('play').click();await wait(()=>!testAudio.paused);testAudio.pause();
      await loadTestFile('slow-prepare.wav');
      const decode=AudioContext.prototype.decodeAudioData;AudioContext.prototype.decodeAudioData=async function(data){const result=await decode.call(this,data);await new Promise(r=>setTimeout(r,300));return result;};
      const previous=testAudio;el('play').click();await loadTestFile('replacement-during-stretch.wav');await new Promise(r=>setTimeout(r,600));
      check(previous.disposed&&!previous.context&&testAudio.paused&&!testAudio.node,'Replacing song cancels stale preparation');AudioContext.prototype.decodeAudioData=decode;
      return 'PASS: default Signalsmith WASM sound and pitch, original-time seek/cues/rate, volume, mode isolation, end, retry and stale-load cancellation';
    })()'''),flush=True)
    assert not cdp.errors,cdp.errors
    cdp.call('Browser.close')
    server.shutdown()

finally:
    try: browser.wait(timeout=5)
    except subprocess.TimeoutExpired: browser.terminate()
