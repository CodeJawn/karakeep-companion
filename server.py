#!/usr/bin/env python3
"""
Simple server for KaraKeep Homedash with preference persistence
This is optional - you can use any static file server if you don't need
cross-device preference syncing.
"""

from http.server import HTTPServer, SimpleHTTPRequestHandler
import json
import os
from urllib.parse import urlparse

DEFAULT_CONFIG = {
    "karakeepUrl": "http://localhost:3000",
    "bookmarkTarget": "_self",
    "preferences": {
        "columnOrder": []
    }
}

def ensure_config_exists():
    """Create default config.json if it doesn't exist"""
    config_path = 'config/config.json'
    
    # Create config directory if it doesn't exist
    os.makedirs('config', exist_ok=True)
    
    if not os.path.exists(config_path):
        with open(config_path, 'w') as f:
            json.dump(DEFAULT_CONFIG, f, indent=2)
        print(f"Created default config at {config_path}")

class KaraKeepHandler(SimpleHTTPRequestHandler):
    def do_GET(self):
        """Handle GET requests"""
        # Redirect config.json requests to config/config.json
        if self.path == '/config.json':
            self.path = '/config/config.json'
        
        # Serve files normally
        return super().do_GET()
    
    def do_POST(self):
        """Handle POST requests for saving preferences"""
        if self.path == '/api/preferences':
            content_length = int(self.headers['Content-Length'])
            post_data = self.rfile.read(content_length)
            
            try:
                # Parse the JSON data
                preferences = json.loads(post_data.decode('utf-8'))
                
                # Load existing config
                config_path = 'config/config.json'
                if os.path.exists(config_path):
                    with open(config_path, 'r') as f:
                        config = json.load(f)
                else:
                    config = DEFAULT_CONFIG.copy()
                
                # Update preferences
                config['preferences'] = preferences
                
                # Save back to config.json
                with open(config_path, 'w') as f:
                    json.dump(config, f, indent=2)
                
                # Send success response
                self.send_response(200)
                self.send_header('Content-type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({"status": "success"}).encode())
                
            except Exception as e:
                # Send error response
                self.send_response(500)
                self.send_header('Content-type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({"status": "error", "message": str(e)}).encode())
        else:
            self.send_response(404)
            self.end_headers()
    
    def end_headers(self):
        """Add CORS headers"""
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        super().end_headers()
    
    def do_OPTIONS(self):
        """Handle OPTIONS requests for CORS"""
        self.send_response(200)
        self.end_headers()

if __name__ == '__main__':
    # Ensure config exists before starting server
    ensure_config_exists()
    
    port = 8595
    server_address = ('', port)
    httpd = HTTPServer(server_address, KaraKeepHandler)
    
    print(f"KaraKeep HomeDash Server running on http://localhost:{port}")
    print("Press Ctrl+C to stop")
    
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nServer stopped")
        httpd.shutdown()