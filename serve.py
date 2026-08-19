#!/usr/bin/env python3
"""Minimal static file server for local preview.

Runs from the project directory explicitly (via os.chdir with an absolute
path) so it never depends on the launch process's cwd, which can be a
TCC-restricted folder (e.g. ~/Desktop) that raises PermissionError on getcwd.
"""
import http.server
import os
import socketserver

PROJECT_DIR = os.path.dirname(os.path.abspath(__file__))
PORT = 8777

os.chdir(PROJECT_DIR)


class Handler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        # Disable caching so edits show up on refresh during development.
        self.send_header("Cache-Control", "no-store, must-revalidate")
        super().end_headers()


with socketserver.TCPServer(("127.0.0.1", PORT), Handler) as httpd:
    print(f"Serving {PROJECT_DIR} at http://127.0.0.1:{PORT}")
    httpd.serve_forever()
