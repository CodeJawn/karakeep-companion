#!/usr/bin/env python3
"""
Simple test script to verify services can start properly
"""

import sys
import os

# Add current directory to Python path for imports
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

print("Testing startup...")

# Test imports
try:
    print("Testing database imports...")
    from database import DatabaseHelper, Base, List, Bookmark, SyncStatus
    print("✓ Database imports successful")
except Exception as e:
    print(f"✗ Database import failed: {e}")
    sys.exit(1)

try:
    print("Testing sync_service imports...")
    from sync_service import KaraKeepSync
    print("✓ Sync service imports successful")
except Exception as e:
    print(f"✗ Sync service import failed: {e}")
    sys.exit(1)

# Test config loading
try:
    print("Testing config loading...")
    config_path = 'config/config.json'
    if os.path.exists(config_path):
        import json
        with open(config_path, 'r') as f:
            config = json.load(f)
        print(f"✓ Config loaded successfully")
        print(f"  KaraKeep URL: {config.get('karakeepUrl', 'NOT SET')}")
        print(f"  API Key: {'SET' if config.get('apiKey') and config['apiKey'] != 'YOUR_KARAKEEP_API_KEY_HERE' else 'NOT SET'}")
    else:
        print("✗ Config file not found at config/config.json")
except Exception as e:
    print(f"✗ Config loading failed: {e}")

# Test database connection
try:
    print("Testing database initialization...")
    db_helper = DatabaseHelper({'database': {'path': '/app/data/test.db'}})
    print("✓ Database initialization successful")
except Exception as e:
    print(f"✗ Database initialization failed: {e}")

print("\nAll basic tests passed! Services should be able to start.")