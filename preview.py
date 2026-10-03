"""Local preview without PWA caching: python preview.py [--port 8766]."""
import argparse
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parent
PREFIX = '/__preview__/'


class PreviewHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, max-age=0')
        super().end_headers()

    def translate_path(self, path):
        # A distinct path keeps old root-scope app-shell caches from matching.
        if path.startswith(PREFIX):
            path = '/' + path[len(PREFIX):]
        return super().translate_path(path)

    def do_GET(self):
        path = urlsplit(self.path).path
        if path in ('/', '/index.html'):
            self.send_response(302)
            self.send_header('Location', PREFIX)
            self.end_headers()
        elif path.endswith('/sw.js'):
            self.send_error(404, 'Service workers are disabled in local preview')
        else:
            super().do_GET()


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--port', type=int, default=8766)
    args = parser.parse_args()
    try:
        server = ThreadingHTTPServer(('127.0.0.1', args.port), PreviewHandler)
    except OSError as error:
        raise SystemExit(f'Cannot open port {args.port}. Stop the old server with Ctrl+C or use --port 8767.\n{error}')
    print(f'Open http://localhost:{server.server_port}{PREFIX}', flush=True)
    print('Refresh the browser after edits. Stop this server with Ctrl+C.', flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
