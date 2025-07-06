// KaraKeep Companion App
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
        } else {
            config = { karakeepUrl: 'http://localhost:3000', bookmarkTarget: '_self', preferences: { columnOrder: [] } };
        }
        loadSavedPreferences();
    } catch (error) {
        console.warn('Could not load config.json, using defaults:', error);
        config = { karakeepUrl: 'http://localhost:3000', bookmarkTarget: '_self', preferences: { columnOrder: [] } };
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
        const lists = db.exec({ sql: `SELECT id, name, description, icon, parentId FROM bookmarkLists ORDER BY name`, returnValue: "resultRows", rowMode: "object" });
        const bookmarksInLists = db.exec({ sql: `SELECT b.id, b.title, bl.url, bl.favicon, bl.description, bil.listId FROM bookmarks b JOIN bookmarkLinks bl ON b.id = bl.id JOIN bookmarksInLists bil ON b.id = bil.bookmarkId WHERE b.type = 'link' ORDER BY b.title`, returnValue: "resultRows", rowMode: "object" });
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
    
    // Distribute the lists into the columns
    lists.forEach((list, index) => {
        columns[index % NUM_COLUMNS].push(list);
    });

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
    const faviconUrl = bookmark.favicon || `https://www.google.com/s2/favicons?domain=${new URL(bookmark.url).hostname}`;
    const target = config.bookmarkTarget === '_blank' ? 'target="_blank" rel="noopener noreferrer"' : '';
    return `<a href="${escapeHtml(bookmark.url)}" class="bookmark-item" title="${escapeHtml(bookmark.title || bookmark.url)}" ${target}><img src="${escapeHtml(faviconUrl)}" alt="" class="bookmark-favicon" loading="lazy"><span class="bookmark-title">${escapeHtml(bookmark.title || 'Untitled')}</span></a>`;
}

// MODIFIED: Initializes SortableJS on each column and groups them
function setupSorting() {
    const columns = document.querySelectorAll('.grid-column');
    columns.forEach(column => {
        new Sortable(column, {
            group: 'shared-lists', // Allows dragging between columns with the same group name
            animation: 150,
            ghostClass: 'sortable-ghost',
            dragClass: 'sortable-drag',
            onEnd: () => {
                // When any drag ends, recalculate the entire order and save
                const allCards = document.querySelectorAll('.list-section');
                const newOrderIds = Array.from(allCards).map(card => card.dataset.listId);

                // Reorder the main `rootLists` array to match the new visual order
                const listMap = new Map(rootLists.map(list => [list.id, list]));
                rootLists = newOrderIds.map(id => listMap.get(id));

                saveColumnOrder();
            },
            onAdd: (evt) => {
                // Add highlight to column being dragged over
                evt.to.classList.add('drag-over-column');
            },
            onRemove: (evt) => {
                // Remove highlight when item leaves
                evt.from.classList.remove('drag-over-column');
            },
        });
    });
}

// Save column order to localStorage
async function saveColumnOrder() {
    const order = rootLists.map(list => list.id);
    localStorage.setItem('karakeep-column-order', JSON.stringify(order));
    if (config && config.preferences) config.preferences.columnOrder = order;

    try {
        const response = await fetch('/api/preferences', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(config.preferences) });
        if (response.ok) console.log('Preferences saved to server');
        else console.log('Server save failed, using localStorage only');
    } catch (error) {
        console.log('No server available, using localStorage only');
    }
    console.log('Column order saved:', order);
}

// Setup search functionality
function setupSearch() {
    const searchInput = document.getElementById('searchInput');
    searchInput.addEventListener('input', debounce(e => filterBookmarks(e.target.value.toLowerCase().trim()), 300));
}

// Filter bookmarks based on search term
function filterBookmarks(searchTerm) {
    const allLists = document.querySelectorAll('.list-section');
    allLists.forEach(list => {
        const listContent = list.textContent.toLowerCase();
        const hasTerm = listContent.includes(searchTerm);
        list.style.display = hasTerm ? '' : 'none';
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
    const savedOrder = localStorage.getItem('karakeep-column-order');
    if (savedOrder) {
        try {
            const order = JSON.parse(savedOrder);
            if (Array.isArray(order)) config.preferences.columnOrder = order;
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