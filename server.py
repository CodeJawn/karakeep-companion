#!/usr/bin/env python3
"""
Simple server for KaraKeep Homedash with preference persistence and API proxy
This server also proxies API requests to KaraKeep to avoid CORS issues.
"""

from http.server import HTTPServer, SimpleHTTPRequestHandler
import json
import os
from urllib.parse import urlparse, parse_qs
import urllib.request
import urllib.error

# Try to import ssl, but don't fail if it's not available
try:
    import ssl
    SSL_AVAILABLE = True
except ImportError:
    SSL_AVAILABLE = False
    print("Warning: SSL module not available. HTTPS connections may fail.")

DEFAULT_CONFIG = {
    "karakeepUrl": "http://localhost:3000",
    "apiKey": "YOUR_KARAKEEP_API_KEY_HERE",
    "bookmarkTarget": "_self",
    "preferences": {
        "columnOrder": [],
        "columnLayout": {}
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
        print("⚠️  Please edit config/config.json and add your KaraKeep API key!")

class KaraKeepHandler(SimpleHTTPRequestHandler):
    def do_GET(self):
        """Handle GET requests"""
        # Check for API proxy requests first
        if self.path.startswith('/api/karakeep/'):
            self.proxy_to_karakeep('GET')
            return
        
        # Redirect config.json requests to config/config.json
        if self.path == '/config.json':
            self.path = '/config/config.json'
        
        # Serve files normally
        return super().do_GET()
    
    def proxy_to_karakeep(self, method):
        """Proxy requests to KaraKeep API"""
        try:
            # Load config to get KaraKeep URL and API key
            config_path = 'config/config.json'
            if not os.path.exists(config_path):
                raise Exception("Config file not found")
                
            with open(config_path, 'r') as f:
                config = json.load(f)
            
            karakeep_url = config.get('karakeepUrl', 'http://localhost:3000')
            api_key = config.get('apiKey', '')
            
            if not api_key or api_key == 'YOUR_KARAKEEP_API_KEY_HERE':
                raise Exception("API key not configured")
            
            # Remove /api/karakeep prefix and construct the actual API path
            api_path = self.path.replace('/api/karakeep', '/api', 1)
            full_url = f"{karakeep_url}{api_path}"
            
            print(f"Proxying {method} request to: {full_url}")
            
            # Create request with auth header
            req = urllib.request.Request(full_url, method=method)
            req.add_header('Authorization', f'Bearer {api_key}')
            req.add_header('Content-Type', 'application/json')
            req.add_header('Accept', 'application/json')
            
            # Create SSL context that handles self-signed certificates
            ssl_context = None
            if SSL_AVAILABLE and full_url.startswith('https://'):
                ssl_context = ssl.create_default_context()
                ssl_context.check_hostname = False
                ssl_context.verify_mode = ssl.CERT_NONE
            
            # Make the request
            if ssl_context:
                response = urllib.request.urlopen(req, context=ssl_context)
            else:
                response = urllib.request.urlopen(req)
                
            data = response.read()
            
            # Send response back to client
            self.send_response(response.getcode())
            self.send_header('Content-Type', 'application/json')
            self.send_header('Cache-Control', 'no-cache')
            self.end_headers()
            self.wfile.write(data)
            
        except urllib.error.HTTPError as e:
            print(f"HTTP Error: {e.code} - {e.reason}")
            # Forward HTTP errors
            self.send_response(e.code)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            try:
                error_data = e.read()
                self.wfile.write(error_data if error_data else json.dumps({"error": str(e)}).encode())
            except:
                self.wfile.write(json.dumps({"error": f"HTTP {e.code}: {e.reason}"}).encode())
            
        except Exception as e:
            print(f"Proxy error: {str(e)}")
            # Handle other errors
            self.send_response(500)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps({"error": str(e)}).encode())
    
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
        self.send_header('Access-Control-Allow-Headers', 'Content-Type, Authorization')
        super().end_headers()
    
    def do_OPTIONS(self):
        """Handle OPTIONS requests for CORS"""
        self.send_response(200)
        self.end_headers()
    
    def log_message(self, format, *args):
        """Override to add more detailed logging"""
        print(f"{self.address_string()} - - [{self.log_date_time_string()}] {format % args}")

if __name__ == '__main__':
    # Ensure config exists before starting server
    ensure_config_exists()
    
    port = 8595
    server_address = ('', port)
    httpd = HTTPServer(server_address, KaraKeepHandler)
    
    print(f"KaraKeep HomeDash Server running on http://localhost:{port}")
    print("API requests will be proxied to avoid CORS issues")
    print("Press Ctrl+C to stop")
    
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nServer stopped")
        httpd.shutdown()