// KaraKeep HomeDash App
// Main application logic with drag-and-drop support

// Global state
let db = null;
let bookmarksData = [];
let config = null;
let rootLists = [];
const NUM_COLUMNS = 4; // Define the number of columns

// SQLite WASM CDN URL
const SQLITE_WASM_URL = 'https://cdn.jsdelivr.net/npm/@sqlite.org/sqlite-wasm@3.45.1-build1/sqlite-wasm/jswasm/sqlite3.mjs';

// Initialize the application
async function init() {
    try {
        await loadConfig();
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
            const karakeepLink = document.getElementById('karakeepLink');
            if (karakeepLink && config.karakeepUrl) {
                karakeepLink.href = config.karakeepUrl;
            }
            
            // Initialize preferences if not present
            if (!config.preferences) {
                config.preferences = { columnOrder: [], columnLayout: {} };
            }
            
            // Don't load from localStorage if we have server config
            console.log('Loaded config from server');
        } else {
            config = { 
                karakeepUrl: 'http://localhost:3000', 
                bookmarkTarget: '_self', 
                preferences: { columnOrder: [], columnLayout: {} } 
            };
            // Only load from localStorage if server config is not available
            loadSavedPreferences();
        }
    } catch (error) {
        console.warn('Could not load config.json, using defaults:', error);
        config = { 
            karakeepUrl: 'http://localhost:3000', 
            bookmarkTarget: '_self', 
            preferences: { columnOrder: [], columnLayout: {} } 
        };
        // Only load from localStorage if server config is not available
        loadSavedPreferences();
    }
}

// Initialize SQLite WASM and load database
async function initSQLite() {
    updateLoadingMessage('Loading SQLite WASM...');
    const { default: sqlite3InitModule } = await import(SQLITE_WASM_URL);
    const sqlite3 = await sqlite3InitModule({ print: console.log, printErr: console.error });

    updateLoadingMessage('Loading database...');
    const response = await fetch('./db.db');
    if (!response.ok) throw new Error('Could not find db.db in the current directory');
    
    const arrayBuffer = await response.arrayBuffer();
    const uint8Array = new Uint8Array(arrayBuffer);
    
    db = new sqlite3.oo1.DB();
    const p = sqlite3.wasm.allocFromTypedArray(uint8Array);
    const rc = sqlite3.capi.sqlite3_deserialize(db.pointer, 'main', p, uint8Array.length, uint8Array.length, sqlite3.capi.SQLITE_DESERIALIZE_FREEONCLOSE);
    if (rc !== sqlite3.capi.SQLITE_OK) throw new Error('Failed to load database file');
    
    console.log('Successfully loaded db.db');
    await loadBookmarks();
}

// Load bookmarks from database
async function loadBookmarks() {
    updateLoadingMessage('Loading bookmarks...');
    try {
        const lists = db.exec({ 
            sql: `SELECT id, name, description, icon, parentId FROM bookmarkLists ORDER BY name`, 
            returnValue: "resultRows", 
            rowMode: "object" 
        });
        
        // FIXED: Now selecting both b.title and bl.title
        const bookmarksInLists = db.exec({ 
            sql: `SELECT 
                    b.id, 
                    b.title as bookmark_title, 
                    bl.title as link_title,  -- Added this line to get the crawled title
                    bl.url, 
                    bl.favicon, 
                    bl.description, 
                    bil.listId 
                FROM bookmarks b 
                JOIN bookmarkLinks bl ON b.id = bl.id 
                JOIN bookmarksInLists bil ON b.id = bil.bookmarkId 
                WHERE b.type = 'link' 
                ORDER BY COALESCE(b.title, bl.title)`,
            returnValue: "resultRows", 
            rowMode: "object" 
        });
        
        bookmarksData = bookmarksInLists;

        const listsById = {};
        lists.forEach(list => { listsById[list.id] = { ...list, children: [], bookmarks: [] }; });
        lists.forEach(list => { if (list.parentId && listsById[list.parentId]) listsById[list.parentId].children.push(listsById[list.id]); });
        bookmarksInLists.forEach(bookmark => { if (listsById[bookmark.listId]) listsById[bookmark.listId].bookmarks.push(bookmark); });

        rootLists = lists
            .filter(list => !list.parentId)
            .map(list => listsById[list.id])
            .filter(list => list.bookmarks.length > 0 || hasBookmarksInChildren(list));

        if (config.preferences.columnOrder && config.preferences.columnOrder.length > 0) {
            const orderedLists = [];
            const listMap = new Map(rootLists.map(list => [list.id, list]));
            config.preferences.columnOrder.forEach(id => {
                if (listMap.has(id)) {
                    orderedLists.push(listMap.get(id));
                    listMap.delete(id);
                }
            });
            listMap.forEach(list => orderedLists.push(list));
            rootLists = orderedLists;
        }

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

// MODIFIED: Renders a structured grid of columns instead of a single container
function renderLists(lists) {
    const content = document.getElementById('content');
    
    // Create an array of arrays to hold the cards for each column
    const columns = Array.from({ length: NUM_COLUMNS }, () => []);
    
    // Check if we have saved column layout
    if (config.preferences.columnLayout) {
        // Use saved column layout
        const listMap = new Map(lists.map(list => [list.id, list]));
        
        for (let colIndex = 0; colIndex < NUM_COLUMNS; colIndex++) {
            const columnIds = config.preferences.columnLayout[colIndex] || [];
            columnIds.forEach(id => {
                const list = listMap.get(id);
                if (list) {
                    columns[colIndex].push(list);
                    listMap.delete(id);
                }
            });
        }
        
        // Add any remaining lists (new ones not in saved layout) to first available column
        let colIndex = 0;
        listMap.forEach(list => {
            columns[colIndex % NUM_COLUMNS].push(list);
            colIndex++;
        });
    } else {
        // Fallback to legacy columnOrder or default distribution
        if (config.preferences.columnOrder && config.preferences.columnOrder.length > 0) {
            // Use old columnOrder format - distribute evenly
            const orderedLists = [];
            const listMap = new Map(lists.map(list => [list.id, list]));
            config.preferences.columnOrder.forEach(id => {
                if (listMap.has(id)) {
                    orderedLists.push(listMap.get(id));
                    listMap.delete(id);
                }
            });
            listMap.forEach(list => orderedLists.push(list));
            
            // Distribute ordered lists across columns
            orderedLists.forEach((list, index) => {
                columns[index % NUM_COLUMNS].push(list);
            });
        } else {
            // Default distribution
            lists.forEach((list, index) => {
                columns[index % NUM_COLUMNS].push(list);
            });
        }
    }

    // Generate the HTML for the columns and their cards
    const gridHtml = `
        <div class="grid-container">
            ${columns.map((col, index) => `
                <div class="grid-column" data-column-index="${index}">
                    ${col.map(list => renderList(list)).join('')}
                </div>
            `).join('')}
        </div>
    `;
    
    content.innerHTML = gridHtml;

    setupSearch();
    setupFaviconErrorHandling();
    setupSorting();
}

// Render a single list card
function renderList(list, level = 0) {
    if (list.bookmarks.length === 0 && !hasBookmarksInChildren(list)) return '';
    const listClass = level === 0 ? 'list-section' : `nested-list-${level}`;
    const headingLevel = Math.min(level + 2, 6);
    
    return `
        <div class="${listClass}" data-list-id="${escapeHtml(list.id)}">
            <div class="list-header">
                <span class="list-icon">${escapeHtml(list.icon)}</span>
                <h${headingLevel} class="list-title">${escapeHtml(list.name)}</h${headingLevel}>
            </div>
            ${list.bookmarks.length > 0 ? `<div class="bookmark-grid">${list.bookmarks.map(renderBookmark).join('')}</div>` : ''}
            ${list.children.filter(hasBookmarksInChildren).map(child => renderList(child, Math.min(level + 1, 2))).join('')}
        </div>
    `;
}

// Render a single bookmark item
function renderBookmark(bookmark) {
    // Now we have bookmark_title and link_title from the query
    // Priority: bookmark_title (user-set) > link_title (crawled) > 'Untitled'
    let title = bookmark.bookmark_title || bookmark.link_title || 'Untitled';
    
    const url = bookmark.url || bookmark.asset?.sourceUrl || '#';
    
    // Get favicon URL
    let faviconUrl = bookmark.favicon || '';
    if (!faviconUrl && bookmark.url) {
        try {
            // Fallback to Google's favicon service
            const domain = new URL(bookmark.url).hostname;
            faviconUrl = `https://www.google.com/s2/favicons?domain=${domain}&sz=32`;
        } catch (e) {
            // Invalid URL, skip favicon
        }
    }
    
    // Determine target attribute
    const target = (config && config.bookmarkTarget) || '_self';
    
    return `
        <a href="${url}" 
           class="bookmark-item" 
           title="${title}"
           target="${target}"
           rel="${target === '_blank' ? 'noopener noreferrer' : ''}"
           draggable="false">
            <div class="bookmark-content">
                ${faviconUrl ? `
                    <img src="${faviconUrl}" 
                         alt="" 
                         class="bookmark-favicon"
                         onerror="this.style.display='none'">
                ` : ''}
                <span class="bookmark-title">${title}</span>
            </div>
        </a>
    `;
}

// MODIFIED: Initializes SortableJS on each column and groups them
function setupSorting() {
    const columns = document.querySelectorAll('.grid-column');
    columns.forEach(column => {
        new Sortable(column, {
            group: 'shared-lists',
            animation: 150,
            ghostClass: 'sortable-ghost',
            dragClass: 'sortable-drag',
            onEnd: () => {
                // Save immediately when drag ends
                saveColumnOrder();
            },
            onAdd: (evt) => {
                evt.to.classList.add('drag-over-column');
            },
            onRemove: (evt) => {
                evt.from.classList.remove('drag-over-column');
            },
        });
    });
}

// Save column order to localStorage
async function saveColumnOrder() {
    // Get current column layout
    const columnLayout = {};
    const columns = document.querySelectorAll('.grid-column');
    
    columns.forEach((column, index) => {
        const cards = column.querySelectorAll('.list-section');
        columnLayout[index] = Array.from(cards).map(card => card.dataset.listId);
    });
    
    // Also maintain the flat order for backward compatibility
    const order = [];
    for (let i = 0; i < NUM_COLUMNS; i++) {
        if (columnLayout[i]) {
            order.push(...columnLayout[i]);
        }
    }
    
    // Update the config object
    if (config && config.preferences) {
        config.preferences.columnLayout = columnLayout;
        config.preferences.columnOrder = order; // Keep for backward compatibility
    }

    // Save to localStorage first as immediate backup
    localStorage.setItem('karakeep-column-layout', JSON.stringify(columnLayout));
    localStorage.setItem('karakeep-column-order', JSON.stringify(order));

    // Try to save to server
    try {
        const response = await fetch('/api/preferences', { 
            method: 'POST', 
            headers: { 'Content-Type': 'application/json' }, 
            body: JSON.stringify(config.preferences) 
        });
        
        if (response.ok) {
            console.log('Preferences saved to server');
        } else {
            console.log('Server save failed, but localStorage backup exists');
        }
    } catch (error) {
        console.log('No server available, using localStorage only');
    }
    console.log('Column layout saved:', columnLayout);
}

// Setup search functionality
function setupSearch() {
    const searchInput = document.getElementById('searchInput');
    searchInput.addEventListener('input', debounce(e => filterBookmarks(e.target.value.toLowerCase().trim()), 300));
}

// Filter bookmarks based on search term
function filterBookmarks(searchTerm) {
    const allLists = document.querySelectorAll('.list-section');
    const columns = document.querySelectorAll('.grid-column');
    
    if (!searchTerm) {
        // Reset everything if search is empty
        allLists.forEach(list => {
            list.style.display = '';
            // Reset all bookmarks in this list section
            const allBookmarks = list.querySelectorAll('.bookmark-item');
            allBookmarks.forEach(bookmark => bookmark.style.display = '');
            // Reset all nested lists
            const nestedLists = list.querySelectorAll('.nested-list-1, .nested-list-2');
            nestedLists.forEach(nestedList => nestedList.style.display = '');
        });
        columns.forEach(column => column.style.display = '');
        return;
    }
    
    // Track which columns have visible content
    const columnsWithContent = new Set();
    
    allLists.forEach(list => {
        const bookmarks = list.querySelectorAll('.bookmark-item');
        let hasVisibleBookmarks = false;
        
        // Check each bookmark individually
        bookmarks.forEach(bookmark => {
            const bookmarkText = bookmark.textContent.toLowerCase();
            const bookmarkTitle = bookmark.getAttribute('title')?.toLowerCase() || '';
            const bookmarkUrl = bookmark.getAttribute('href')?.toLowerCase() || '';
            
            // Check if bookmark matches search term in title, text content, or URL
            const matches = bookmarkText.includes(searchTerm) || 
                          bookmarkTitle.includes(searchTerm) || 
                          bookmarkUrl.includes(searchTerm);
            
            bookmark.style.display = matches ? '' : 'none';
            if (matches) hasVisibleBookmarks = true;
        });
        
        // Also check nested lists recursively
        const nestedLists = list.querySelectorAll('.nested-list-1, .nested-list-2');
        nestedLists.forEach(nestedList => {
            const nestedBookmarks = nestedList.querySelectorAll('.bookmark-item');
            let hasVisibleNestedBookmarks = false;
            
            nestedBookmarks.forEach(bookmark => {
                const bookmarkText = bookmark.textContent.toLowerCase();
                const bookmarkTitle = bookmark.getAttribute('title')?.toLowerCase() || '';
                const bookmarkUrl = bookmark.getAttribute('href')?.toLowerCase() || '';
                
                const matches = bookmarkText.includes(searchTerm) || 
                              bookmarkTitle.includes(searchTerm) || 
                              bookmarkUrl.includes(searchTerm);
                
                bookmark.style.display = matches ? '' : 'none';
                if (matches) {
                    hasVisibleNestedBookmarks = true;
                    hasVisibleBookmarks = true;
                }
            });
            
            // Hide nested list if it has no visible bookmarks
            nestedList.style.display = hasVisibleNestedBookmarks ? '' : 'none';
        });
        
        // Show/hide the entire list section based on whether it has visible bookmarks
        list.style.display = hasVisibleBookmarks ? '' : 'none';
        
        // Track which column this list belongs to
        if (hasVisibleBookmarks) {
            const parentColumn = list.closest('.grid-column');
            if (parentColumn) {
                columnsWithContent.add(parentColumn);
            }
        }
    });
    
    // Hide columns that have no visible content
    columns.forEach(column => {
        column.style.display = columnsWithContent.has(column) ? '' : 'none';
    });
}

// Handle favicon loading errors
function setupFaviconErrorHandling() {
    document.querySelectorAll('.bookmark-favicon').forEach(favicon => {
        favicon.addEventListener('error', function() { this.style.display = 'none'; });
    });
}

// Load saved preferences from localStorage on startup
function loadSavedPreferences() {
    // Try to load column layout first (new format)
    const savedLayout = localStorage.getItem('karakeep-column-layout');
    if (savedLayout) {
        try {
            const layout = JSON.parse(savedLayout);
            if (typeof layout === 'object' && !Array.isArray(layout)) {
                config.preferences.columnLayout = layout;
                console.log('Loaded column layout from localStorage');
                return; // Don't need to load old format
            }
        } catch (error) {
            console.error('Error loading saved column layout:', error);
        }
    }
    
    // Fallback to old column order format
    const savedOrder = localStorage.getItem('karakeep-column-order');
    if (savedOrder) {
        try {
            const order = JSON.parse(savedOrder);
            if (Array.isArray(order)) {
                config.preferences.columnOrder = order;
                console.log('Loaded column order from localStorage (legacy format)');
            }
        } catch (error) {
            console.error('Error loading saved preferences:', error);
        }
    }
}

// Utility functions
function escapeHtml(unsafe) {
    return unsafe.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}
function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => { clearTimeout(timeout); func(...args); };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}
function updateLoadingMessage(message) {
    const loadingElement = document.querySelector('.loading p');
    if (loadingElement) loadingElement.textContent = message;
}
function showError(title, message) {
    const content = document.getElementById('content');
    content.innerHTML = `<div class="error"><h2>${escapeHtml(title)}</h2><p>${escapeHtml(message)}</p><small>Please ensure db.db is in the same directory as this HTML file.</small></div>`;
}

// Start the application when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}