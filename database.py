#!/usr/bin/env python3
"""
Database helper module for KaraKeep HomeDash
Provides functions to query cached bookmark data from SQLite
"""

import json
import os
from datetime import datetime
from sqlalchemy import create_engine, and_, or_
from sqlalchemy.orm import sessionmaker, joinedload
from sqlalchemy.sql import func
from sync_service import Base, List, Bookmark, SyncStatus

class DatabaseHelper:
    def __init__(self, config):
        self.config = config
        self.setup_database()
        
    def setup_database(self):
        """Initialize database connection"""
        db_path = self.config.get('database', {}).get('path', '/app/data/karakeep.db')
        
        # Create engine
        self.engine = create_engine(
            f'sqlite:///{db_path}',
            connect_args={
                'check_same_thread': False,
                'timeout': 30
            },
            pool_size=5,
            echo=False
        )
        
        # Create session factory
        self.Session = sessionmaker(bind=self.engine)
    
    def get_all_lists(self):
        """Get all lists from cache"""
        session = self.Session()
        try:
            lists = session.query(List).all()
            
            # Convert to dict format
            result = []
            for list_obj in lists:
                result.append({
                    'id': list_obj.id,
                    'name': list_obj.name,
                    'description': list_obj.description,
                    'icon': list_obj.icon,
                    'parentId': list_obj.parent_id,
                    'position': list_obj.position
                })
            
            return result
        finally:
            session.close()
    
    def get_bookmarks_for_list(self, list_id):
        """Get all bookmarks for a specific list"""
        session = self.Session()
        try:
            bookmarks = session.query(Bookmark).filter_by(list_id=list_id).all()
            
            result = []
            for bookmark in bookmarks:
                # Extract metadata
                metadata = bookmark.metadata or {}
                
                result.append({
                    'id': bookmark.id,
                    'listId': bookmark.list_id,
                    'title': bookmark.title,
                    'name': bookmark.title,  # For compatibility
                    'url': bookmark.url,
                    'sourceUrl': bookmark.url,  # For compatibility
                    'description': bookmark.description,
                    'favicon': bookmark.favicon,
                    'content': {
                        'type': 'link',
                        'url': bookmark.url,
                        'title': metadata.get('link_title', ''),
                        'description': bookmark.description,
                        'favicon': bookmark.favicon
                    },
                    'metadata': {
                        'title': metadata.get('link_title', ''),
                        'description': bookmark.description,
                        'favicon': bookmark.favicon
                    },
                    'modifiedAt': bookmark.modified_at.isoformat() + 'Z' if bookmark.modified_at else None
                })
            
            return result
        finally:
            session.close()
    
    def get_all_bookmarks(self):
        """Get all bookmarks from cache"""
        session = self.Session()
        try:
            bookmarks = session.query(Bookmark).options(joinedload(Bookmark.list)).all()
            
            result = []
            for bookmark in bookmarks:
                metadata = bookmark.metadata or {}
                
                result.append({
                    'id': bookmark.id,
                    'listId': bookmark.list_id,
                    'listName': bookmark.list.name if bookmark.list else '',
                    'title': bookmark.title,
                    'name': bookmark.title,
                    'url': bookmark.url,
                    'sourceUrl': bookmark.url,
                    'description': bookmark.description,
                    'favicon': bookmark.favicon,
                    'content': {
                        'type': 'link',
                        'url': bookmark.url,
                        'title': metadata.get('link_title', ''),
                        'description': bookmark.description,
                        'favicon': bookmark.favicon
                    },
                    'metadata': {
                        'title': metadata.get('link_title', ''),
                        'description': bookmark.description,
                        'favicon': bookmark.favicon
                    },
                    'modifiedAt': bookmark.modified_at.isoformat() + 'Z' if bookmark.modified_at else None
                })
            
            return result
        finally:
            session.close()
    
    def search_bookmarks(self, query):
        """Search bookmarks by title, URL, or description"""
        session = self.Session()
        try:
            # Case-insensitive search
            search_pattern = f'%{query}%'
            
            bookmarks = session.query(Bookmark).options(joinedload(Bookmark.list)).filter(
                or_(
                    Bookmark.title.ilike(search_pattern),
                    Bookmark.url.ilike(search_pattern),
                    Bookmark.description.ilike(search_pattern)
                )
            ).all()
            
            result = []
            for bookmark in bookmarks:
                metadata = bookmark.metadata or {}
                
                result.append({
                    'id': bookmark.id,
                    'listId': bookmark.list_id,
                    'listName': bookmark.list.name if bookmark.list else '',
                    'title': bookmark.title,
                    'url': bookmark.url,
                    'description': bookmark.description,
                    'favicon': bookmark.favicon,
                    'content': {
                        'type': 'link',
                        'url': bookmark.url,
                        'title': metadata.get('link_title', ''),
                        'description': bookmark.description,
                        'favicon': bookmark.favicon
                    }
                })
            
            return result
        finally:
            session.close()
    
    def get_sync_status(self):
        """Get current sync status"""
        session = self.Session()
        try:
            status = session.query(SyncStatus).first()
            
            if not status:
                return {
                    'status': 'never_synced',
                    'lastFullSync': None,
                    'lastIncrementalSync': None,
                    'error': None
                }
            
            return {
                'status': status.status,
                'lastFullSync': status.last_full_sync.isoformat() + 'Z' if status.last_full_sync else None,
                'lastIncrementalSync': status.last_incremental_sync.isoformat() + 'Z' if status.last_incremental_sync else None,
                'error': status.error_message
            }
        finally:
            session.close()
    
    def get_stats(self):
        """Get database statistics"""
        session = self.Session()
        try:
            list_count = session.query(func.count(List.id)).scalar()
            bookmark_count = session.query(func.count(Bookmark.id)).scalar()
            
            # Get sync status
            sync_status = self.get_sync_status()
            
            return {
                'lists': list_count,
                'bookmarks': bookmark_count,
                'syncStatus': sync_status
            }
        finally:
            session.close()