// KaraKeep HomeDash App
// Main application logic with drag-and-drop support - Cache Version

// Global state
let bookmarksData = [];
let config = null;
let rootLists = [];
const NUM_COLUMNS = 4; // Define the number of columns

// Initialize the application
async function init() {
    try {
        await loadConfig();
        await loadBookmarksFromCache();
        setupSyncStatusMonitor();
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
            
            // Validate required config fields
            if (!config.karakeepUrl) {
                throw new Error('Missing karakeepUrl in config');
            }
            
            const karakeepLink = document.getElementById('karakeepLink');
            if (karakeepLink && config.karakeepUrl) {
                karakeepLink.href = config.karakeepUrl;
            }
            
            // Initialize preferences if not present
            if (!config.preferences) {
                config.preferences = { columnOrder: [], columnLayout: {} };
            }
            
            console.log('Loaded config from server');
        } else {
            throw new Error('Could not load config.json');
        }
    } catch (error) {
        console.error('Could not load config.json:', error);
        throw error;
    }
}

// Load bookmarks from cache
async function loadBookmarksFromCache() {
    updateLoadingMessage('Loading bookmarks from cache...');
    
    try {
        // Fetch all lists from cache
        const listsResponse = await fetch('/api/cache/lists');
        if (!listsResponse.ok) {
            throw new Error(`Failed to load lists: ${listsResponse.status} ${listsResponse.statusText}`);
        }
        
        const listsData = await listsResponse.json();
        const lists = listsData.lists || [];
        
        console.log(`Loaded ${lists.length} lists from cache`);
        
        // Fetch all bookmarks at once from cache
        const bookmarksResponse = await fetch('/api/cache/bookmarks');
        if (!bookmarksResponse.ok) {
            throw new Error(`Failed to load bookmarks: ${bookmarksResponse.status} ${bookmarksResponse.statusText}`);
        }
        
        const bookmarksDataResponse = await bookmarksResponse.json();
        const allBookmarks = bookmarksDataResponse.bookmarks || [];
        
        console.log(`Loaded ${allBookmarks.length} bookmarks from cache`);
        
        updateLoadingMessage('Processing bookmarks...');
        
        // Create a map of lists by ID
        const listsById = {};
        lists.forEach(list => {
            listsById[list.id] = {
                id: list.id,
                name: list.name,
                description: list.description || '',
                icon: list.icon || '📁',
                parentId: list.parentId || null,
                children: [],
                bookmarks: []
            };
        });
        
        // Build parent-child relationships
        lists.forEach(list => {
            if (list.parentId && listsById[list.parentId]) {
                listsById[list.parentId].children.push(listsById[list.id]);
            }
        });
        
        // Map bookmarks to their lists
        allBookmarks.forEach(bookmark => {
            // Transform bookmark data to match the expected format
            const transformedBookmark = {
                id: bookmark.id,
                bookmark_title: bookmark.title || bookmark.name,
                link_title: bookmark.content?.title || bookmark.metadata?.title || '',
                url: bookmark.content?.url || bookmark.url || bookmark.sourceUrl || '#',
                favicon: bookmark.content?.favicon || bookmark.favicon || bookmark.metadata?.favicon || '',
                description: bookmark.content?.description || bookmark.description || bookmark.metadata?.description || '',
                listId: bookmark.listId
            };
            
            if (bookmark.listId && listsById[bookmark.listId]) {
                listsById[bookmark.listId].bookmarks.push(transformedBookmark);
            }
        });
        
        // Sort bookmarks within each list
        Object.values(listsById).forEach(list => {
            list.bookmarks.sort((a, b) => {
                const titleA = (a.bookmark_title || a.link_title || 'Untitled').toLowerCase();
                const titleB = (b.bookmark_title || b.link_title || 'Untitled').toLowerCase();
                return titleA.localeCompare(titleB);
            });
        });
        
        // Store all bookmarks for search functionality
        bookmarksData = allBookmarks.map(bookmark => ({
            id: bookmark.id,
            bookmark_title: bookmark.title || bookmark.name,
            link_title: bookmark.content?.title || bookmark.metadata?.title || '',
            url: bookmark.content?.url || bookmark.url || bookmark.sourceUrl || '#',
            favicon: bookmark.content?.favicon || bookmark.favicon || bookmark.metadata?.favicon || '',
            description: bookmark.content?.description || bookmark.description || bookmark.metadata?.description || '',
            listId: bookmark.listId
        }));
        
        // Get root lists (no parent)
        rootLists = lists
            .filter(list => !list.parentId)
            .map(list => listsById[list.id])
            .filter(list => list.bookmarks.length > 0 || hasBookmarksInChildren(list))
            .sort((a, b) => a.name.localeCompare(b.name));
        
        // Apply saved column order if available
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
        
        // Show sync status
        updateSyncStatus();
        
    } catch (error) {
        console.error('Error loading bookmarks:', error);
        
        // Check if database is empty (never synced)
        if (error.message.includes('404')) {
            showError(
                'No bookmarks found', 
                'The sync service is still fetching your bookmarks. This page will refresh automatically when ready.'
            );
            // Auto-refresh after 5 seconds
            setTimeout(() => location.reload(), 5000);
        } else {
            throw new Error(error.message || 'Failed to load bookmarks from cache');
        }
    }
}

// Setup sync status monitoring
function setupSyncStatusMonitor() {
    // Update sync status immediately
    updateSyncStatus();
    
    // Update every 30 seconds
    setInterval(updateSyncStatus, 30000);
}

// Update sync status display
async function updateSyncStatus() {
    try {
        const response = await fetch('/api/sync/status');
        if (!response.ok) return;
        
        const status = await response.json();
        
        // Add sync status indicator to header if it doesn't exist
        let syncIndicator = document.getElementById('syncStatus');
        if (!syncIndicator) {
            const header = document.querySelector('.header-top');
            if (header) {
                syncIndicator = document.createElement('div');
                syncIndicator.id = 'syncStatus';
                syncIndicator.className = 'sync-status';
                header.appendChild(syncIndicator);
            }
        }
        
        if (syncIndicator) {
            const statusClass = status.status === 'success' ? 'sync-success' : 
                               status.status === 'error' ? 'sync-error' : 
                               status.status === 'running' ? 'sync-running' : 'sync-idle';
            
            const lastSync = status.lastIncrementalSync ? 
                new Date(status.lastIncrementalSync).toLocaleString() : 'Never';
            
            syncIndicator.className = `sync-status ${statusClass}`;
            syncIndicator.innerHTML = `
                <span class="sync-icon">🔄</span>
                <span class="sync-text">Last sync: ${lastSync}</span>
            `;
            
            if (status.error) {
                syncIndicator.title = `Error: ${status.error}`;
            }
        }
    } catch (error) {
        console.error('Failed to fetch sync status:', error);
    }
}

// Check if a list or its children have bookmarks
function hasBookmarksInChildren(list) {
    if (list.bookmarks.length > 0) return true;
    return list.children.some(child => hasBookmarksInChildren(child));
}

// Renders a structured grid of columns instead of a single container
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
    // Priority: bookmark_title (user-set) > link_title (crawled) > 'Untitled'
    let title = bookmark.bookmark_title || bookmark.link_title || 'Untitled';
    
    const url = bookmark.url || '#';
    
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

// Initializes SortableJS on each column and groups them
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

// Save column order
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

    // Save to server
    try {
        const response = await fetch('/api/preferences', { 
            method: 'POST', 
            headers: { 'Content-Type': 'application/json' }, 
            body: JSON.stringify(config.preferences) 
        });
        
        if (response.ok) {
            console.log('Preferences saved');
        } else {
            console.error('Failed to save preferences');
        }
    } catch (error) {
        console.error('Error saving preferences:', error);
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
    content.innerHTML = `<div class="error"><h2>${escapeHtml(title)}</h2><p>${escapeHtml(message)}</p><small>If this is your first time using KaraKeep HomeDash, please wait for the initial sync to complete.</small></div>`;
}

// Start the application when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}