// KaraKeep Companion App
// Main application logic

// Global state
let db = null;
let bookmarksData = [];

// SQLite WASM CDN URL
const SQLITE_WASM_URL = 'https://cdn.jsdelivr.net/npm/@sqlite.org/sqlite-wasm@3.45.1-build1/sqlite-wasm/jswasm/sqlite3.mjs';

// Initialize the application
async function init() {
    try {
        await initSQLite();
    } catch (error) {
        console.error('Failed to initialize application:', error);
        showError('Failed to initialize application', error.message);
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
        const rootLists = lists
            .filter(list => !list.parentId)
            .map(list => listsById[list.id])
            .filter(list => list.bookmarks.length > 0 || hasBookmarksInChildren(list));

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
            ${lists.map(list => renderList(list)).join('')}
        </div>
    `;

    // Setup event listeners
    setupSearch();
    setupFaviconErrorHandling();
}

// Render a single list with its children
function renderList(list, level = 0) {
    // Skip empty lists
    if (list.bookmarks.length === 0 && !hasBookmarksInChildren(list)) {
        return '';
    }
    
    const listClass = level === 0 ? 'list-section' : `nested-list-${level}`;
    const headingLevel = Math.min(level + 2, 6); // h2 to h6
    
    return `
        <div class="${listClass}" data-list-id="${escapeHtml(list.id)}">
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
    
    return `
        <a href="${escapeHtml(bookmark.url)}" 
           class="bookmark-item" 
           title="${escapeHtml(bookmark.title || bookmark.url)}"
           target="_blank"
           rel="noopener noreferrer">
            <img src="${escapeHtml(faviconUrl)}" 
                 alt="" 
                 class="bookmark-favicon" 
                 loading="lazy">
            <span class="bookmark-title">${escapeHtml(bookmark.title || 'Untitled')}</span>
        </a>
    `;
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