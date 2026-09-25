#!/usr/bin/env python3
"""NEON RUSH — tiny static file server (stdlib only, Cache-Control: no-store).

Usage:
    python3 tools/server.py [port] [--host HOST] [root]

    port   defaults to 3050 (N30N RU5H — leet digits 305, padded to an
           unprivileged port)
    root   defaults to the project directory (parent of tools/)

Examples:
    python3 tools/server.py                  # http://127.0.0.1:3050 serving project root
    python3 tools/server.py 3050
    python3 tools/server.py 8199 /tmp/nr_stub
"""
import argparse
import os
import sys
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

MIME_OVERRIDES = {
    '.js': 'text/javascript',
    '.mjs': 'text/javascript',
    '.woff2': 'font/woff2',
    '.woff': 'font/woff',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.wasm': 'application/wasm',
    '.map': 'application/json',
    '.ico': 'image/x-icon',
    '.mp3': 'audio/mpeg',
    '.ogg': 'audio/ogg',
    '.wav': 'audio/wav',
}


class Handler(SimpleHTTPRequestHandler):
    protocol_version = 'HTTP/1.1'
    extensions_map = {**SimpleHTTPRequestHandler.extensions_map, **MIME_OVERRIDES}

    def end_headers(self):
        # no-store on EVERYTHING, including 404/error responses
        self.send_header('Cache-Control', 'no-store')
        SimpleHTTPRequestHandler.end_headers(self)

    def log_message(self, fmt, *args):
        sys.stderr.write('[server] %s\n' % (fmt % args))


class Server(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = True

    def handle_error(self, request, client_address):
        # Aborted connections / 404s must never take the server down.
        exc = sys.exc_info()[1]
        if isinstance(exc, (ConnectionResetError, ConnectionAbortedError,
                            BrokenPipeError, TimeoutError)):
            return
        super().handle_error(request, client_address)


def main():
    ap = argparse.ArgumentParser(description='NEON RUSH static dev server (no-cache).')
    ap.add_argument('port', nargs='?', type=int, default=3050)
    ap.add_argument('root', nargs='?', default=None,
                    help='directory to serve (default: project root)')
    ap.add_argument('--host', default='127.0.0.1')
    args = ap.parse_args()

    root = os.path.abspath(args.root or
                           os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    if not os.path.isdir(root):
        print(f'error: root is not a directory: {root}', file=sys.stderr)
        return 2
    if not 0 < args.port < 65536:
        print(f'error: invalid port {args.port}', file=sys.stderr)
        return 2

    try:
        srv = Server((args.host, args.port), partial(Handler, directory=root))
    except OSError as e:
        print(f'error: cannot bind {args.host}:{args.port} — {e}', file=sys.stderr)
        return 2

    print(f'NEON RUSH dev server: http://{args.host}:{args.port}/ serving {root} '
          f'(Cache-Control: no-store)')
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        srv.server_close()
    return 0


if __name__ == '__main__':
    sys.exit(main())
