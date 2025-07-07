#!/usr/bin/env python3
"""
Flask server for KaraKeep HomeDash with preference persistence and API proxy
"""

from flask import Flask, request, jsonify, send_from_directory, Response
import json
import os
import requests
import urllib3

# Disable SSL warnings for self-signed certificates
urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

app = Flask(__name__, static_folder='.')

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

def load_config():
    """Load configuration from file"""
    config_path = 'config/config.json'
    if os.path.exists(config_path):
        with open(config_path, 'r') as f:
            return json.load(f)
    return DEFAULT_CONFIG.copy()

# Serve the main page
@app.route('/')
def index():
    return send_from_directory('.', 'index.html')

# Proxy API requests to KaraKeep - MUST come before catch-all route
@app.route('/api/karakeep/<path:path>')
def proxy_karakeep(path):
    print(f"API proxy route hit for path: {path}")  # Debug line
    config = load_config()
    karakeep_url = config.get('karakeepUrl', 'http://localhost:3000')
    api_key = config.get('apiKey', '')
    
    if not api_key or api_key == 'YOUR_KARAKEEP_API_KEY_HERE':
        return jsonify({"error": "API key not configured"}), 500
    
    # Construct the full URL - KaraKeep uses /api/v1/
    full_url = f"{karakeep_url}/api/v1/{path}"
    
    # Add query parameters if any
    if request.query_string:
        full_url += f"?{request.query_string.decode()}"
    
    print(f"Proxying request to: {full_url}")
    
    try:
        # Make the request to KaraKeep
        headers = {
            'Authorization': f'Bearer {api_key}',
            'Content-Type': 'application/json',
            'Accept': 'application/json'
        }
        
        # Use verify=False for self-signed certificates
        response = requests.get(full_url, headers=headers, verify=False)
        
        # Return the response
        return Response(
            response.content,
            status=response.status_code,
            content_type=response.headers.get('content-type', 'application/json')
        )
        
    except requests.exceptions.RequestException as e:
        print(f"Error proxying request: {str(e)}")
        return jsonify({"error": str(e)}), 500

# Save preferences
@app.route('/api/preferences', methods=['POST'])
def save_preferences():
    try:
        preferences = request.json
        config = load_config()
        config['preferences'] = preferences
        
        # Save back to config.json
        config_path = 'config/config.json'
        with open(config_path, 'w') as f:
            json.dump(config, f, indent=2)
        
        return jsonify({"status": "success"})
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500

# Handle OPTIONS for CORS
@app.route('/api/karakeep/<path:path>', methods=['OPTIONS'])
def handle_options(path):
    return '', 200

# Special route for config.json
@app.route('/config.json')
def serve_config():
    return send_from_directory('config', 'config.json')

# Serve static files - MUST come last as it's a catch-all
@app.route('/<path:path>')
def serve_static(path):
    return send_from_directory('.', path)

if __name__ == '__main__':
    ensure_config_exists()
    print("KaraKeep HomeDash Server (Flask) starting...")
    print("API requests will be proxied to avoid CORS issues")
    app.run(host='0.0.0.0', port=8595, debug=True)  # Enable debug for better error messages