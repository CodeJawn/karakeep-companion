// KaraKeep Companion App
// Main application logic with drag-and-drop support

// Global state
let db = null;
let bookmarksData = [];
let config = null;
let rootLists = [];

// SQLite WASM CDN URL
const SQLITE_WASM_URL = 'https://cdn.jsdelivr.net/npm/@sqlite.org/sqlite-wasm@3.45.1-build1/sqlite-wasm/jswasm/sqlite3.mjs';

// Initialize the application
async function init() {
    try {
        // Load configuration
        await loadConfig();
        
        // Initialize SQLite and load bookmarks
        await initSQLite();
        
    } catch (error) {
        console.error('Failed to initialize application:', error);
        showError('Failed to initialize application', error.message);
    }
}

// Load configuration file
async function loadConfig() {
    try {
        const response = await fetch('./config.json');
        if (response.ok) {
            config = await response.json();
            
            // Set KaraKeep link
            const karakeepLink = document.getElementById('karakeepLink');
            if (karakeepLink && config.karakeepUrl) {
                karakeepLink.href = config.karakeepUrl;
            }
        } else {
            // Use defaults if config not found
            config = {
                karakeepUrl: 'http://localhost:3000',
                bookmarkTarget: '_self',
                preferences: {
                    columnOrder: []
                }
            };
        }
        
        // Load saved preferences from localStorage
        loadSavedPreferences();
        
    } catch (error) {
        console.warn('Could not load config.json, using defaults:', error);
        config = {
            karakeepUrl: 'http://localhost:3000',
            bookmarkTarget: '_self',
            preferences: {
                columnOrder: []
            }
        };
        
        // Load saved preferences from localStorage
        loadSavedPreferences();
    }
}

// Initialize SQLite WASM and load database
async function initSQLite() {
    updateLoadingMessage('Loading SQLite WASM...');
    
    const { default: sqlite3InitModule } = await import(SQLITE_WASM_URL);
    
    const sqlite3 = await sqlite3InitModule({
        print: console.log,
        printErr: console.error,
    });

    updateLoadingMessage('Loading database...');
    
    // Try to load db.db from the same directory
    const response = await fetch('./db.db');
    
    if (!response.ok) {
        throw new Error('Could not find db.db in the current directory');
    }
    
    const arrayBuffer = await response.arrayBuffer();
    const uint8Array = new Uint8Array(arrayBuffer);
    
    // Create database from the file
    db = new sqlite3.oo1.DB();
    const p = sqlite3.wasm.allocFromTypedArray(uint8Array);
    const rc = sqlite3.capi.sqlite3_deserialize(
        db.pointer, 'main', p, uint8Array.length, uint8Array.length,
        sqlite3.capi.SQLITE_DESERIALIZE_FREEONCLOSE
    );
    
    if (rc !== sqlite3.capi.SQLITE_OK) {
        throw new Error('Failed to load database file');
    }
    
    console.log('Successfully loaded db.db');
    
    // Load and display bookmarks
    await loadBookmarks();
}

// Load bookmarks from database
async function loadBookmarks() {
    updateLoadingMessage('Loading bookmarks...');
    
    try {
        // Query all lists
        const lists = db.exec({
            sql: `SELECT id, name, description, icon, parentId 
                  FROM bookmarkLists 
                  ORDER BY name`,
            returnValue: "resultRows",
            rowMode: "object"
        });

        // Query all bookmarks with their list associations
        const bookmarksInLists = db.exec({
            sql: `
                SELECT 
                    b.id,
                    b.title,
                    bl.url,
                    bl.favicon,
                    bl.description,
                    bil.listId
                FROM bookmarks b
                JOIN bookmarkLinks bl ON b.id = bl.id
                JOIN bookmarksInLists bil ON b.id = bil.bookmarkId
                WHERE b.type = 'link'
                ORDER BY b.title
            `,
            returnValue: "resultRows",
            rowMode: "object"
        });

        // Store for search functionality
        bookmarksData = bookmarksInLists;

        // Build the lists hierarchy
        const listsById = {};
        lists.forEach(list => {
            listsById[list.id] = { 
                ...list, 
                children: [], 
                bookmarks: [] 
            };
        });

        // Assign children to parents
        lists.forEach(list => {
            if (list.parentId && listsById[list.parentId]) {
                listsById[list.parentId].children.push(listsById[list.id]);
            }
        });

        // Assign bookmarks to lists
        bookmarksInLists.forEach(bookmark => {
            if (listsById[bookmark.listId]) {
                listsById[bookmark.listId].bookmarks.push(bookmark);
            }
        });

        // Get root lists (no parent)
        rootLists = lists
            .filter(list => !list.parentId)
            .map(list => listsById[list.id])
            .filter(list => list.bookmarks.length > 0 || hasBookmarksInChildren(list));

        // Apply saved column order
        if (config.preferences.columnOrder && config.preferences.columnOrder.length > 0) {
            const orderedLists = [];
            const listMap = new Map(rootLists.map(list => [list.id, list]));
            
            // Add lists in saved order
            config.preferences.columnOrder.forEach(id => {
                if (listMap.has(id)) {
                    orderedLists.push(listMap.get(id));
                    listMap.delete(id);
                }
            });
            
            // Add any remaining lists not in saved order
            listMap.forEach(list => orderedLists.push(list));
            
            rootLists = orderedLists;
        }

        // Render the interface
        renderLists(rootLists);
        
    } catch (error) {
        console.error('Error loading bookmarks:', error);
        throw new Error('Failed to load bookmarks from database');
    }
}

// Check if a list or its children have bookmarks
function hasBookmarksInChildren(list) {
    if (list.bookmarks.length > 0) return true;
    return list.children.some(child => hasBookmarksInChildren(child));
}

// Render lists to the DOM
function renderLists(lists) {
    const content = document.getElementById('content');
    content.innerHTML = `
        <div class="lists-grid" id="listsContainer">
            ${lists.map((list, index) => renderList(list, 0, index)).join('')}
        </div>
    `;

    // Setup event listeners
    setupSearch();
    setupFaviconErrorHandling();
    setupDragAndDrop();
}

// Render a single list with its children
function renderList(list, level = 0, index = 0) {
    // Skip empty lists
    if (list.bookmarks.length === 0 && !hasBookmarksInChildren(list)) {
        return '';
    }
    
    const listClass = level === 0 ? 'list-section' : `nested-list-${level}`;
    const headingLevel = Math.min(level + 2, 6); // h2 to h6
    const draggableAttr = level === 0 ? 'draggable="true"' : '';
    const dataIndex = level === 0 ? `data-index="${index}"` : '';
    
    return `
        <div class="${listClass}" data-list-id="${escapeHtml(list.id)}" ${draggableAttr} ${dataIndex}>
            <div class="list-header">
                <span class="list-icon">${escapeHtml(list.icon)}</span>
                <h${headingLevel} class="list-title">${escapeHtml(list.name)}</h${headingLevel}>
            </div>
            ${list.bookmarks.length > 0 ? `
                <div class="bookmark-grid">
                    ${list.bookmarks.map(bookmark => renderBookmark(bookmark)).join('')}
                </div>
            ` : ''}
            ${list.children
                .filter(child => hasBookmarksInChildren(child))
                .map(child => renderList(child, Math.min(level + 1, 2)))
                .join('')}
        </div>
    `;
}

// Render a single bookmark
function renderBookmark(bookmark) {
    const faviconUrl = bookmark.favicon || `https://www.google.com/s2/favicons?domain=${new URL(bookmark.url).hostname}`;
    const target = config.bookmarkTarget === '_blank' ? 'target="_blank" rel="noopener noreferrer"' : '';
    
    return `
        <a href="${escapeHtml(bookmark.url)}" 
           class="bookmark-item" 
           title="${escapeHtml(bookmark.title || bookmark.url)}"
           ${target}>
            <img src="${escapeHtml(faviconUrl)}" 
                 alt="" 
                 class="bookmark-favicon" 
                 loading="lazy">
            <span class="bookmark-title">${escapeHtml(bookmark.title || 'Untitled')}</span>
        </a>
    `;
}

// Setup drag and drop functionality
function setupDragAndDrop() {
    const listSections = document.querySelectorAll('.list-section[draggable="true"]');
    let draggedElement = null;
    let draggedIndex = null;

    listSections.forEach(section => {
        section.addEventListener('dragstart', handleDragStart);
        section.addEventListener('dragover', handleDragOver);
        section.addEventListener('drop', handleDrop);
        section.addEventListener('dragend', handleDragEnd);
        section.addEventListener('dragenter', handleDragEnter);
        section.addEventListener('dragleave', handleDragLeave);
    });

    function handleDragStart(e) {
        draggedElement = this;
        draggedIndex = parseInt(this.dataset.index);
        this.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/html', this.innerHTML);
    }

    function handleDragOver(e) {
        if (e.preventDefault) {
            e.preventDefault();
        }
        e.dataTransfer.dropEffect = 'move';
        return false;
    }

    function handleDragEnter(e) {
        if (this !== draggedElement && this.classList.contains('list-section')) {
            this.classList.add('drag-over');
        }
    }

    function handleDragLeave(e) {
        if (this !== draggedElement && this.classList.contains('list-section')) {
            this.classList.remove('drag-over');
        }
    }

    function handleDrop(e) {
        if (e.stopPropagation) {
            e.stopPropagation();
        }

        if (draggedElement !== this && this.classList.contains('list-section')) {
            const targetIndex = parseInt(this.dataset.index);
            
            // Reorder the rootLists array
            const draggedList = rootLists[draggedIndex];
            rootLists.splice(draggedIndex, 1);
            
            // Adjust target index if needed
            const adjustedIndex = draggedIndex < targetIndex ? targetIndex - 1 : targetIndex;
            rootLists.splice(adjustedIndex, 0, draggedList);
            
            // Re-render the lists
            renderLists(rootLists);
            
            // Save the new order
            saveColumnOrder();
        }

        return false;
    }

    function handleDragEnd(e) {
        const listSections = document.querySelectorAll('.list-section');
        listSections.forEach(section => {
            section.classList.remove('dragging', 'drag-over');
        });
    }
}

// Save column order to localStorage (as we can't write to files from browser)
async function saveColumnOrder() {
    const order = rootLists.map(list => list.id);
    
    // Save to localStorage as fallback
    localStorage.setItem('karakeep-column-order', JSON.stringify(order));
    
    // Update config object
    config.preferences.columnOrder = order;
    
    // Try to save to server if available
    try {
        const response = await fetch('/api/preferences', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(config.preferences)
        });
        
        if (response.ok) {
            console.log('Preferences saved to server');
        } else {
            console.log('Server save failed, using localStorage only');
        }
    } catch (error) {
        console.log('No server available, using localStorage only');
    }
    
    console.log('Column order saved:', order);
}

// Setup search functionality
function setupSearch() {
    const searchInput = document.getElementById('searchInput');
    
    searchInput.addEventListener('input', debounce(function(e) {
        const searchTerm = e.target.value.toLowerCase().trim();
        filterBookmarks(searchTerm);
    }, 300));
}

// Filter bookmarks based on search term
function filterBookmarks(searchTerm) {
    const allBookmarks = document.querySelectorAll('.bookmark-item');
    const allLists = document.querySelectorAll('.list-section, [class^="nested-list-"]');

    if (searchTerm === '') {
        // Show all
        allBookmarks.forEach(bookmark => bookmark.style.display = '');
        allLists.forEach(list => list.style.display = '');
        return;
    }

    // Hide all lists first
    allLists.forEach(list => list.style.display = 'none');

    // Show matching bookmarks and their parent lists
    allBookmarks.forEach(bookmark => {
        const title = bookmark.querySelector('.bookmark-title').textContent.toLowerCase();
        const fullTitle = bookmark.getAttribute('title').toLowerCase();
        const url = bookmark.getAttribute('href').toLowerCase();
        
        if (title.includes(searchTerm) || fullTitle.includes(searchTerm) || url.includes(searchTerm)) {
            bookmark.style.display = '';
            
            // Show all parent lists
            let parentElement = bookmark.closest('.list-section, [class^="nested-list-"]');
            while (parentElement) {
                parentElement.style.display = '';
                parentElement = parentElement.parentElement?.closest('.list-section, [class^="nested-list-"]');
            }
        } else {
            bookmark.style.display = 'none';
        }
    });
}

// Handle favicon loading errors
function setupFaviconErrorHandling() {
    document.querySelectorAll('.bookmark-favicon').forEach(favicon => {
        favicon.addEventListener('error', function() {
            // Hide broken favicon
            this.style.display = 'none';
        });
    });
}

// Load saved preferences from localStorage on startup
function loadSavedPreferences() {
    const savedOrder = localStorage.getItem('karakeep-column-order');
    if (savedOrder) {
        try {
            const order = JSON.parse(savedOrder);
            if (Array.isArray(order)) {
                config.preferences.columnOrder = order;
            }
        } catch (error) {
            console.error('Error loading saved preferences:', error);
        }
    }
}

// Utility functions
function escapeHtml(unsafe) {
    return unsafe
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

function updateLoadingMessage(message) {
    const loadingElement = document.querySelector('.loading p');
    if (loadingElement) {
        loadingElement.textContent = message;
    }
}

function showError(title, message) {
    const content = document.getElementById('content');
    content.innerHTML = `
        <div class="error">
            <h2>${escapeHtml(title)}</h2>
            <p>${escapeHtml(message)}</p>
            <small>Please ensure db.db is in the same directory as this HTML file.</small>
        </div>
    `;
}

// Start the application when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}