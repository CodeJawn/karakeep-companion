#!/usr/bin/env python3
"""
Flask server for KaraKeep HomeDash with SQLite cache
Serves cached bookmark data for fast page loads
"""

from flask import Flask, request, jsonify, send_from_directory, Response
import json
import os
import logging
from database import DatabaseHelper

app = Flask(__name__, static_folder='.')

# Setup logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

DEFAULT_CONFIG = {
    "karakeepUrl": "http://localhost:3000",
    "apiKey": "YOUR_KARAKEEP_API_KEY_HERE",
    "bookmarkTarget": "_self",
    "sync": {
        "enabled": True,
        "intervalMinutes": 5,
        "retryDelaySeconds": 30,
        "maxRetries": 3,
        "batchSize": 100
    },
    "database": {
        "path": "/app/data/karakeep.db"
    },
    "preferences": {
        "columnOrder": [],
        "columnLayout": {}
    }
}

# Global database helper
db_helper = None

def ensure_config_exists():
    """Create default config.json if it doesn't exist"""
    config_path = 'config/config.json'
    
    # Create config directory if it doesn't exist
    os.makedirs('config', exist_ok=True)
    
    if not os.path.exists(config_path):
        with open(config_path, 'w') as f:
            json.dump(DEFAULT_CONFIG, f, indent=2)
        logger.info(f"Created default config at {config_path}")
        logger.warning("⚠️  Please edit config/config.json and add your KaraKeep API key!")

def load_config():
    """Load configuration from file"""
    config_path = 'config/config.json'
    if os.path.exists(config_path):
        with open(config_path, 'r') as f:
            config = json.load(f)
            
        # Merge with defaults
        for key, value in DEFAULT_CONFIG.items():
            if key not in config:
                config[key] = value
            elif isinstance(value, dict) and isinstance(config.get(key), dict):
                # Merge nested dictionaries
                for sub_key, sub_value in value.items():
                    if sub_key not in config[key]:
                        config[key][sub_key] = sub_value
        
        return config
    return DEFAULT_CONFIG.copy()

# Initialize database helper on startup
def init_app():
    global db_helper
    ensure_config_exists()
    config = load_config()
    db_helper = DatabaseHelper(config)
    logger.info("Database helper initialized")

# Serve the main page
@app.route('/')
def index():
    return send_from_directory('.', 'index.html')

# Cache API endpoints - now serve from SQLite cache
@app.route('/api/cache/lists')
def get_cached_lists():
    """Get all lists from cache"""
    try:
        lists = db_helper.get_all_lists()
        return jsonify({"lists": lists})
    except Exception as e:
        logger.error(f"Error fetching lists: {str(e)}")
        return jsonify({"error": str(e)}), 500

@app.route('/api/cache/lists/<list_id>/bookmarks')
def get_cached_bookmarks_for_list(list_id):
    """Get bookmarks for a specific list from cache"""
    try:
        bookmarks = db_helper.get_bookmarks_for_list(list_id)
        return jsonify({"bookmarks": bookmarks})
    except Exception as e:
        logger.error(f"Error fetching bookmarks for list {list_id}: {str(e)}")
        return jsonify({"error": str(e)}), 500

@app.route('/api/cache/bookmarks')
def get_all_cached_bookmarks():
    """Get all bookmarks from cache"""
    try:
        bookmarks = db_helper.get_all_bookmarks()
        return jsonify({"bookmarks": bookmarks})
    except Exception as e:
        logger.error(f"Error fetching all bookmarks: {str(e)}")
        return jsonify({"error": str(e)}), 500

@app.route('/api/cache/search')
def search_bookmarks():
    """Search bookmarks in cache"""
    query = request.args.get('q', '').strip()
    if not query:
        return jsonify({"bookmarks": []})
    
    try:
        bookmarks = db_helper.search_bookmarks(query)
        return jsonify({"bookmarks": bookmarks})
    except Exception as e:
        logger.error(f"Error searching bookmarks: {str(e)}")
        return jsonify({"error": str(e)}), 500

@app.route('/api/sync/status')
def get_sync_status():
    """Get current sync status"""
    try:
        status = db_helper.get_sync_status()
        return jsonify(status)
    except Exception as e:
        logger.error(f"Error fetching sync status: {str(e)}")
        return jsonify({"error": str(e)}), 500

@app.route('/api/stats')
def get_stats():
    """Get database statistics"""
    try:
        stats = db_helper.get_stats()
        return jsonify(stats)
    except Exception as e:
        logger.error(f"Error fetching stats: {str(e)}")
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

# Special route for config.json
@app.route('/config.json')
def serve_config():
    return send_from_directory('config', 'config.json')

# Serve static files
@app.route('/<path:path>')
def serve_static(path):
    return send_from_directory('.', path)

# Error handlers
@app.errorhandler(404)
def not_found(error):
    return jsonify({"error": "Not found"}), 404

@app.errorhandler(500)
def internal_error(error):
    return jsonify({"error": "Internal server error"}), 500

if __name__ == '__main__':
    init_app()
    logger.info("KaraKeep HomeDash Server starting...")
    logger.info("Serving bookmarks from SQLite cache for fast performance")
    app.run(host='0.0.0.0', port=8595, debug=False)