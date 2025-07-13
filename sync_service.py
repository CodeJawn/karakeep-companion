#!/usr/bin/env python3
"""
Background synchronization service for KaraKeep HomeDash
Handles periodic syncing of bookmarks and lists from KaraKeep API to local SQLite cache
"""

import sys
import os

# Add current directory to Python path for imports
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import json
import time
import logging
from datetime import datetime, timedelta
import requests
import urllib3
from apscheduler.schedulers.blocking import BlockingScheduler
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.sql import func

# Import models from database module
from database import Base, List, Bookmark, SyncStatus

# Disable SSL warnings for self-signed certificates
urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

# Setup logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

class KaraKeepSync:
    def __init__(self, config_path='config/config.json'):
        self.config_path = config_path
        self.config = self.load_config()
        self.setup_database()
        self.session = None
        self.scheduler = BlockingScheduler()
        
    def load_config(self):
        """Load configuration from file"""
        if not os.path.exists(self.config_path):
            logger.error(f"Config file not found at {self.config_path}")
            logger.error("Please ensure config.json exists and contains your API key")
            raise Exception(f"Config file not found at {self.config_path}")
            
        try:
            with open(self.config_path, 'r') as f:
                config = json.load(f)
        except PermissionError:
            logger.error(f"Permission denied: Cannot read {self.config_path}")
            raise
        except json.JSONDecodeError as e:
            logger.error(f"Invalid JSON in config file: {e}")
            raise
            
        # Validate required fields
        if not config.get('karakeepUrl'):
            raise Exception('Missing karakeepUrl in config')
        if not config.get('apiKey') or config['apiKey'] == 'YOUR_KARAKEEP_API_KEY_HERE':
            raise Exception('Invalid API key in config')
            
        # Set defaults for sync config
        if 'sync' not in config:
            config['sync'] = {}
        
        sync_defaults = {
            'enabled': True,
            'intervalMinutes': 5,
            'retryDelaySeconds': 30,
            'maxRetries': 3,
            'batchSize': 100
        }
        
        for key, value in sync_defaults.items():
            if key not in config['sync']:
                config['sync'][key] = value
                
        # Set database path
        if 'database' not in config:
            config['database'] = {}
        if 'path' not in config['database']:
            config['database']['path'] = '/app/data/karakeep.db'
            
        return config
    
    def setup_database(self):
        """Initialize database connection and create tables"""
        db_path = self.config['database']['path']
        db_dir = os.path.dirname(db_path)
        
        # Create directory if it doesn't exist
        if db_dir and not os.path.exists(db_dir):
            try:
                os.makedirs(db_dir, exist_ok=True)
                logger.info(f"Created database directory: {db_dir}")
            except PermissionError:
                logger.error(f"Permission denied: Cannot create database directory {db_dir}")
                logger.error("Please ensure the data directory is writable or mounted correctly")
                raise
            except Exception as e:
                logger.error(f"Error creating database directory: {e}")
                raise
            
        # Create engine with optimizations
        self.engine = create_engine(
            f'sqlite:///{db_path}',
            connect_args={
                'check_same_thread': False,
                'timeout': 30
            },
            pool_size=5,
            echo=False
        )
        
        # Enable WAL mode for better concurrency
        with self.engine.connect() as conn:
            conn.execute("PRAGMA journal_mode=WAL")
            conn.execute("PRAGMA synchronous=NORMAL")
            
        # Create tables
        Base.metadata.create_all(self.engine)
        
        # Create session factory
        self.Session = sessionmaker(bind=self.engine)
        
    def make_api_request(self, endpoint, retry_count=0):
        """Make authenticated request to KaraKeep API with retry logic"""
        url = f"{self.config['karakeepUrl']}/api/v1{endpoint}"
        headers = {
            'Authorization': f"Bearer {self.config['apiKey']}",
            'Content-Type': 'application/json',
            'Accept': 'application/json'
        }
        
        try:
            response = requests.get(url, headers=headers, verify=False, timeout=30)
            response.raise_for_status()
            return response.json()
        except requests.exceptions.RequestException as e:
            logger.error(f"API request failed for {endpoint}: {str(e)}")
            
            if retry_count < self.config['sync']['maxRetries']:
                delay = self.config['sync']['retryDelaySeconds'] * (2 ** retry_count)
                logger.info(f"Retrying in {delay} seconds...")
                time.sleep(delay)
                return self.make_api_request(endpoint, retry_count + 1)
            else:
                raise
    
    def sync_lists(self, session):
        """Sync all lists from KaraKeep API"""
        logger.info("Syncing lists...")
        
        try:
            # Fetch all lists
            response = self.make_api_request('/lists')
            api_lists = response.get('lists', response) if isinstance(response, dict) else response
            
            # Get existing lists
            existing_lists = {list.id: list for list in session.query(List).all()}
            
            # Update or create lists
            for api_list in api_lists:
                list_id = api_list['id']
                
                if list_id in existing_lists:
                    # Update existing list
                    db_list = existing_lists[list_id]
                    db_list.name = api_list.get('name', '')
                    db_list.description = api_list.get('description', '')
                    db_list.icon = api_list.get('icon', '📁')
                    db_list.parent_id = api_list.get('parentId')
                    db_list.position = api_list.get('position', 0)
                    db_list.last_synced = datetime.utcnow()
                    existing_lists.pop(list_id)
                else:
                    # Create new list
                    db_list = List(
                        id=list_id,
                        name=api_list.get('name', ''),
                        description=api_list.get('description', ''),
                        icon=api_list.get('icon', '📁'),
                        parent_id=api_list.get('parentId'),
                        position=api_list.get('position', 0)
                    )
                    session.add(db_list)
            
            # Delete lists that no longer exist
            for list_id, db_list in existing_lists.items():
                logger.info(f"Deleting list {list_id} - no longer exists in API")
                session.delete(db_list)
                
            session.commit()
            logger.info(f"Synced {len(api_lists)} lists")
            
        except Exception as e:
            logger.error(f"Failed to sync lists: {str(e)}")
            session.rollback()
            raise
    
    def sync_bookmarks_for_list(self, session, list_id, modified_since=None):
        """Sync bookmarks for a specific list"""
        try:
            # Fetch bookmarks for this list
            response = self.make_api_request(f'/lists/{list_id}/bookmarks')
            
            # Handle different response formats
            if isinstance(response, list):
                api_bookmarks = response
            elif isinstance(response, dict):
                api_bookmarks = response.get('bookmarks', response.get('data', []))
            else:
                api_bookmarks = []
            
            # Filter for link bookmarks only
            link_bookmarks = [
                b for b in api_bookmarks 
                if not b.get('content') or b.get('content', {}).get('type') == 'link'
            ]
            
            # Get existing bookmarks for this list
            existing_bookmarks = {
                b.id: b for b in session.query(Bookmark).filter_by(list_id=list_id).all()
            }
            
            updated_count = 0
            
            for api_bookmark in link_bookmarks:
                bookmark_id = api_bookmark['id']
                
                # Parse modified date
                modified_str = api_bookmark.get('modifiedAt', api_bookmark.get('updatedAt'))
                if modified_str:
                    modified_at = datetime.fromisoformat(modified_str.replace('Z', '+00:00'))
                else:
                    modified_at = datetime.utcnow()
                
                # Skip if not modified since last sync
                if modified_since and modified_at <= modified_since:
                    if bookmark_id in existing_bookmarks:
                        existing_bookmarks.pop(bookmark_id)
                    continue
                
                # Extract bookmark data
                content = api_bookmark.get('content', {})
                metadata = api_bookmark.get('metadata', {})
                
                bookmark_data = {
                    'title': api_bookmark.get('title') or api_bookmark.get('name'),
                    'url': content.get('url') or api_bookmark.get('url') or api_bookmark.get('sourceUrl', '#'),
                    'description': content.get('description') or api_bookmark.get('description') or metadata.get('description', ''),
                    'favicon': content.get('favicon') or api_bookmark.get('favicon') or metadata.get('favicon', ''),
                    'bookmark_metadata': {
                        'link_title': content.get('title') or metadata.get('title', ''),
                        'original_data': api_bookmark
                    },
                    'modified_at': modified_at,
                    'last_synced': datetime.utcnow()
                }
                
                if bookmark_id in existing_bookmarks:
                    # Update existing bookmark
                    db_bookmark = existing_bookmarks[bookmark_id]
                    for key, value in bookmark_data.items():
                        setattr(db_bookmark, key, value)
                    existing_bookmarks.pop(bookmark_id)
                    updated_count += 1
                else:
                    # Create new bookmark
                    db_bookmark = Bookmark(id=bookmark_id, list_id=list_id, **bookmark_data)
                    session.add(db_bookmark)
                    updated_count += 1
            
            # Delete bookmarks that no longer exist in this list
            for bookmark_id, db_bookmark in existing_bookmarks.items():
                logger.info(f"Deleting bookmark {bookmark_id} - no longer in list {list_id}")
                session.delete(db_bookmark)
            
            session.commit()
            return updated_count
            
        except Exception as e:
            logger.error(f"Failed to sync bookmarks for list {list_id}: {str(e)}")
            session.rollback()
            raise
    
    def perform_sync(self, full_sync=False):
        """Perform synchronization"""
        session = self.Session()
        start_time = datetime.utcnow()
        
        try:
            # Update sync status to running
            sync_status = session.query(SyncStatus).first()
            if not sync_status:
                sync_status = SyncStatus()
                session.add(sync_status)
            
            sync_status.status = 'running'
            sync_status.error_message = None
            session.commit()
            
            # Always sync lists first
            self.sync_lists(session)
            
            # Get last successful sync time
            last_sync = None if full_sync else sync_status.last_incremental_sync
            
            # Sync bookmarks for each list
            lists = session.query(List).all()
            total_updated = 0
            
            for list_obj in lists:
                logger.info(f"Syncing bookmarks for list: {list_obj.name}")
                updated = self.sync_bookmarks_for_list(session, list_obj.id, last_sync)
                total_updated += updated
            
            # Update sync status
            if full_sync:
                sync_status.last_full_sync = start_time
            sync_status.last_incremental_sync = start_time
            sync_status.status = 'success'
            session.commit()
            
            duration = (datetime.utcnow() - start_time).total_seconds()
            logger.info(f"Sync completed in {duration:.2f}s - Updated {total_updated} bookmarks")
            
        except Exception as e:
            logger.error(f"Sync failed: {str(e)}")
            
            # Update sync status with error
            sync_status = session.query(SyncStatus).first()
            if sync_status:
                sync_status.status = 'error'
                sync_status.error_message = str(e)
                session.commit()
            
            raise
        finally:
            session.close()
    
    def run(self):
        """Start the sync service"""
        if not self.config['sync']['enabled']:
            logger.info("Sync is disabled in configuration")
            return
        
        logger.info("Starting KaraKeep sync service...")
        
        # Perform initial full sync
        logger.info("Performing initial full sync...")
        try:
            self.perform_sync(full_sync=True)
        except Exception as e:
            logger.error(f"Initial sync failed: {str(e)}")
            logger.info("Will retry according to schedule...")
        
        # Schedule periodic syncs
        interval_minutes = self.config['sync']['intervalMinutes']
        self.scheduler.add_job(
            self.perform_sync,
            'interval',
            minutes=interval_minutes,
            id='sync_job',
            max_instances=1
        )
        
        logger.info(f"Scheduled sync every {interval_minutes} minutes")
        
        try:
            self.scheduler.start()
        except KeyboardInterrupt:
            logger.info("Shutting down sync service...")
            self.scheduler.shutdown()

if __name__ == '__main__':
    sync_service = KaraKeepSync()
    sync_service.run()