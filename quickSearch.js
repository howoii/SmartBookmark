// quickSearch.js
EnvIdentifier = 'quickSearch';

class QuickSearchManager {
    constructor() {
        // DOM 元素
        this.elements = {
            searchInput: document.getElementById('search-input'),
            searchResults: document.getElementById('search-results'),
            clearSearchBtn: document.getElementById('clear-search-btn'),
            resultsCount: document.getElementById('results-count'),
            searchTime: document.getElementById('search-time'),
            status: document.getElementById('status'),
            dialogContent: document.querySelector('.dialog-content'),
            pinnedSites: document.getElementById('pinned-sites'),
            dropZone: document.getElementById('drop-zone'),
            recentSearches: document.getElementById('recent-searches'),
            settingsBtn: document.getElementById('settings-btn'),
            // 重命名对话框相关元素
            renameDialog: document.getElementById('rename-dialog'),
            newBookmarkTitle: document.getElementById('new-bookmark-title'),
            renameCancelBtn: document.getElementById('rename-cancel-btn'),
            renameSaveBtn: document.getElementById('rename-save-btn'),
            // 编辑标签对话框相关元素
            editTagsDialog: document.getElementById('edit-tags-dialog'),
            bookmarkTags: document.getElementById('bookmark-tags'),
            tagsPreview: document.querySelector('.tags-preview'),
            tagsCancelBtn: document.getElementById('tags-cancel-btn'),
            tagsSaveBtn: document.getElementById('tags-save-btn'),
            // 确认对话框相关元素
            confirmDialog: document.getElementById('confirm-dialog'),
            confirmTitle: document.getElementById('confirm-title'),
            confirmMessage: document.getElementById('confirm-message'),
            confirmPrimaryBtn: document.getElementById('confirm-primary-btn'),
            confirmSecondaryBtn: document.getElementById('confirm-secondary-btn')
        };

        this.lastQuery = '';
        this.lastQueryResult = [];
        this.isSearching = false;
        this.selectedIndex = -1;
        this.resultItems = [];
        this.draggedElement = null;
        this.draggedElementIndex = -1;
        this.sitesDisplayType = 'pinned';
        this.sitesDisplayCount = 10;
        this.showSearchHistory = true;
        this.isMouseInSearchHistory = false;
        
        // 重命名相关状态
        this.renamingBookmark = null;
        this.renamingResultItem = null;
        
        // 编辑标签相关状态
        this.editingTagsBookmark = null;
        this.editingTagsResultItem = null;
        this.currentTags = [];

        // confirmDialog 相关状态
        this.showConfirmDialog = this.showConfirmDialog.bind(this);
        this.confirmCancelCallback = null;
        this.confirmConfirmCallback = null;

        // showStatus 相关状态
        this.showStatus = this.showStatus.bind(this);

        // 初始化编辑管理器
        const editElements = {
            container: this.elements.dialogContent,
            bookmarkList: this.elements.searchResults,
            selectAllCheckbox: document.getElementById('select-all-checkbox'),
            selectedCountElement: document.getElementById('selected-count'),
            batchDeleteButton: document.getElementById('batch-delete-btn'),
            batchOpenButton: document.getElementById('batch-open-btn'),
            exitEditModeButton: document.getElementById('exit-edit-mode-btn')
        }
        const callbacks = {
            showStatus: (message, isError = false) => {
                this.showStatus(message, isError ? 'error' : 'success');
            },
            showDialog: (params) => {
                this.showConfirmDialog(params);
            },
            afterDelete: this.refreshSearchResults.bind(this)
        }
        this.editManager = new BookmarkEditManager(editElements, callbacks, 'search-result-item');

        this.init();
    }

    async init() {
        try {
            // 设置删除区域事件
            this.setupDragEventListeners();
            
            // 获取设置
            const settings = await SettingsManager.getAll();
            this.sitesDisplayType = settings.search?.sitesDisplay || 'pinned';
            this.sitesDisplayCount = settings.search?.sitesDisplayCount || 10;
            this.showSearchHistory = settings.search?.showSearchHistory;

            // 根据设置显示网站
            await this.renderSites();
            
            // 设置事件监听
            this.setupEventListeners();

            // 异步初始化本地存储
            LocalStorageMgr.init();
            
            // 如果URL中有搜索参数，自动执行搜索
            const params = new URLSearchParams(window.location.search);
            const query = params.get('q');
            if (query) {
                this.elements.searchInput.value = query;
                this.performSearch(query);
            }
        } catch (error) {
            logger.error('初始化失败:', error);
            this.showStatus('初始化失败: ' + error.message, 'error', true);
        }
    }

    // 设置删除区域事件
    setupDragEventListeners() {
        const { dropZone, pinnedSites } = this.elements;
        
        dropZone.addEventListener('dragenter', (e) => {
            e.preventDefault();
            dropZone.classList.add('drag-over');
            if (this.placeholder) {
                this.placeholder.classList.remove('show');
            }
            // 添加删除样式到拖拽元素
            if (this.draggedElement) {
                this.draggedElement.classList.add('delete-mode');
            }
        });

        dropZone.addEventListener('dragover', (e) => {
            e.preventDefault();
        });

        dropZone.addEventListener('dragleave', (e) => {
            e.preventDefault();
            // 检查是否真的离开了drop-zone区域
            // 如果relatedTarget是drop-zone的子元素，则不触发离开效果
            if (!dropZone.contains(e.relatedTarget)) {
                dropZone.classList.remove('drag-over');
                // 移除删除样式
                if (this.draggedElement) {
                    this.draggedElement.classList.remove('delete-mode');
                }
            }
        });

        dropZone.addEventListener('drop', async (e) => {
            e.preventDefault();
            dropZone.classList.remove('drag-over');
            dropZone.classList.remove('show');
            
            if (this.draggedElement) {
                const url = this.draggedElement.dataset.url;
                this.draggedElement.classList.add('deleting');
                
                try {
                    await ConfigManager.removePinnedSite(url);
                    // 等待删除动画完成后重新渲染
                    setTimeout(() => {
                        this.renderSites();
                        // 更新搜索结果中的书签图标状态
                        const pinBtn = document.querySelector(`.search-result-item[data-url="${url}"] .pin-btn`);
                        if (pinBtn) {
                            pinBtn.setAttribute('data-pinned', 'false');
                            pinBtn.title = '固定到常用网站';
                        }
                    }, 300);

                    sendMessageSafely({
                        type: MessageType.SCHEDULE_SYNC,
                        data: {
                            reason: ScheduleSyncReason.SETTINGS
                        }
                    });
                } catch (error) {
                    logger.error('删除失败:', error);
                    this.showStatus('删除失败: ' + error.message, 'error');
                }
            }
        });

        pinnedSites.addEventListener('dragover', (e) => {
            e.preventDefault();
        });

        pinnedSites.addEventListener('drop', async (e) => {
            e.preventDefault();

            if (!this.draggedElement) return;
            
            if (this.placeholder && this.placeholder.classList.contains('show')) {
                // 将拖拽的元素移动到 placeholder 的位置
                pinnedSites.insertBefore(this.draggedElement, this.placeholder);
                // 删除 placeholder
                this.placeholder.remove();
                this.placeholder = null;
                
                // 保存新的顺序
                await this.savePinnedSitesOrder();
            }
        });

        document.addEventListener('dragend', this.handleGlobalDragEnd.bind(this));
    }

    // 处理全局拖拽结束事件
    async handleGlobalDragEnd(e) {
        if (!this.draggedElement) return;

        const { dropZone } = this.elements;
        logger.debug('全局拖拽结束', {
            e: e,
            draggedElement: this.draggedElement,
        });

        this.draggedElement.classList.remove('dragging');
        dropZone.classList.remove('show');
        dropZone.classList.remove('drag-over');

        this.draggedElement = null;
        if (this.placeholder) {
            this.placeholder.remove();
            this.placeholder = null;
        }
    }

    // 设置单个网站的拖拽事件
    setupDragEvents(siteElement) {
        const { pinnedSites } = this.elements;

        siteElement.addEventListener('dragstart', (e) => {
            logger.debug('拖拽开始', {
                e: e,
                siteElement: siteElement,
            });
            this.draggedElement = siteElement;
            this.placeholder = document.createElement('div');
            this.placeholder.className = 'pinned-site-placeholder';
            // 把placeholder插入到dragElement的前面，并默认隐藏
            pinnedSites.insertBefore(this.placeholder, siteElement);

            siteElement.classList.add('dragging');
            this.elements.dropZone.classList.add('show');
        });

        siteElement.addEventListener('dragenter', (e) => {
            e.preventDefault();
            e.stopPropagation();
            if (siteElement.classList.contains('dragging')) {
                this.placeholder.classList.remove('show');
                return;
            }
            this.placeholder.classList.add('show');

            const container = this.elements.pinnedSites;
            const draggedIndex = Array.from(container.children).indexOf(this.draggedElement);
            const currentIndex = Array.from(container.children).indexOf(siteElement);

            if (draggedIndex > currentIndex) {
                container.insertBefore(this.placeholder, siteElement);
            } else if (draggedIndex < currentIndex) {
                container.insertBefore(this.placeholder, siteElement.nextSibling);
            }
        });
    }

    // 保存常用网站的新顺序
    async savePinnedSitesOrder() {
        try {
            const sites = Array.from(this.elements.pinnedSites.children)
                .filter(child => child.classList.contains('pinned-site'))
                .map(site => ({
                    url: site.dataset.url,
                    title: site.title
                }));
            
            logger.debug('保存常用网站顺序', {
                sites: sites,
            });
            await ConfigManager.savePinnedSites(sites);

            sendMessageSafely({
                type: MessageType.SCHEDULE_SYNC,
                data: {
                    reason: ScheduleSyncReason.SETTINGS
                }
            });
        } catch (error) {
            logger.error('保存常用网站顺序失败:', error);
            this.showStatus('保存顺序失败: ' + error.message, 'error');
        }
    }

    // 渲染常用网站
    async renderSites(renderSites) {
        const { pinnedSites, dropZone } = this.elements;
        pinnedSites.innerHTML = '';

        // 如果设置为不显示，则隐藏整个容器
        if (this.sitesDisplayType === 'none') {
            pinnedSites.parentElement.style.display = 'none';
            return;
        }

        // 如果不是固定网站模式，则先隐藏整个容器，等有数据时再显示
        if (this.sitesDisplayType !== 'pinned') {
            pinnedSites.parentElement.style.display = 'none';
        }

        dropZone.style.display = this.sitesDisplayType === 'pinned' ? 'flex' : 'none';

        try {
            let sites = [];
            if (renderSites) {
                sites = renderSites;
            } else {
                switch (this.sitesDisplayType) {
                    case 'pinned':
                        sites = await ConfigManager.getPinnedSites();
                    break;
                case 'recent':
                    sites = await this.getRecentSites();
                    break;
                case 'most':
                    sites = await this.getMostUsedSites();
                    break;
                case 'recent-saved':
                    sites = await this.getRecentSavedSites();
                    break;
                }
            }

            // 添加网站
            for (const site of sites) {
                const siteElement = document.createElement('div');
                siteElement.className = 'pinned-site';
                siteElement.title = site.title;
                siteElement.dataset.url = site.url;
                siteElement.draggable = this.sitesDisplayType === 'pinned';

                const img = document.createElement('img');
                img.src = await getFaviconUrl(site.url);
                img.alt = site.title;
                img.draggable = false;
                img.addEventListener('error', function() {
                    this.src = 'icons/default_favicon.png';
                });

                siteElement.appendChild(img);
                siteElement.addEventListener('click', () => this.openResult(site.url));
                pinnedSites.appendChild(siteElement);

                // 只为固定网站设置拖拽事件
                if (this.sitesDisplayType === 'pinned') {
                    this.setupDragEvents(siteElement);
                }
            }

            // 只在固定网站模式下显示添加按钮
            if (this.sitesDisplayType === 'pinned') {
                const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
                const shouldShowAddButton = sites.length < 10 && 
                                         tab && 
                                         !sites.some(site => site.url === tab.url);

                if (shouldShowAddButton) {
                    this.addAddButton();
                }
            }

            // 如果显示的网站数量大于0，则显示容器
            pinnedSites.parentElement.style.display = pinnedSites.children.length > 0 ? 'flex' : 'none';
        } catch (error) {
            logger.error('渲染网站失败:', error);
            this.showStatus('渲染网站失败: ' + error.message, 'error');
        }
    }

    async getRecentSites() {
        try {
            const bookmarks = await this.getSortedBookmarks('lastUsed');
            return bookmarks.slice(0, this.sitesDisplayCount);
        } catch (error) {
            logger.error('获取最近使用网站失败:', error);
            throw error;
        }
    }

    async getRecentSavedSites() {
        try {
            const bookmarks = await this.getSortedBookmarks('savedAt');
            return bookmarks.slice(0, this.sitesDisplayCount);
        } catch (error) {
            logger.error('获取最近保存网站失败:', error);
            throw error;
        }
    }

    async getMostUsedSites() {
        try {
            const bookmarks = await this.getSortedBookmarks('useCount');
            return bookmarks.slice(0, this.sitesDisplayCount);
        } catch (error) {
            logger.error('获取最常用网站失败:', error);
            throw error;
        }
    }

    async getSortedBookmarks(sortBy='useCount') {
        const data = await getDisplayedBookmarks(true);

        let bookmarks = Object.values(data).map((item) => ({
                ...item,
                // 统一使用时间戳进行比较
                savedAt: item.savedAt ? new Date(item.savedAt).getTime() : 0,
                useCount: calculateWeightedScore(item.useCount, item.lastUsed),
                lastUsed: item.lastUsed ? new Date(item.lastUsed).getTime() : 0
            }));
        
        bookmarks.sort((a, b) => {
            let comparison = 0;
            
            switch (sortBy) {
                case 'savedAt':
                    comparison = (b.savedAt || 0) - (a.savedAt || 0);
                    break;
                    
                case 'useCount':
                    comparison = (b.useCount || 0) - (a.useCount || 0);
                    if (comparison === 0) {
                        // 使用次数相同时，按保存时间排序
                        comparison = (b.savedAt || 0) - (a.savedAt || 0);
                    }
                    break;
                    
                case 'lastUsed':
                    comparison = (b.lastUsed || 0) - (a.lastUsed || 0);
                    if (comparison === 0) {
                        // 最后使用时间相同时，按保存时间排序
                        comparison = (b.savedAt || 0) - (a.savedAt || 0);
                    }
                    break;
            }
            
            return comparison;
        });

        return bookmarks;
    }

    addAddButton() {
        const addButton = document.createElement('div');
        addButton.className = 'add-current-site';
        addButton.title = '添加当前页面到常用网站';
        addButton.innerHTML = `
            <svg viewBox="0 0 24 24">
                <path fill="currentColor" d="M19,13H13V19H11V13H5V11H11V5H13V11H19V13Z" />
            </svg>
        `;
        this.elements.pinnedSites.appendChild(addButton);
        addButton.addEventListener('click', async () => {
            try {
                const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
                if (tab) {
                    await ConfigManager.addPinnedSite({
                        url: tab.url,
                        title: tab.title || '未命名网站'
                    });
                    await this.renderSites();

                    sendMessageSafely({
                        type: MessageType.SCHEDULE_SYNC,
                        data: {
                            reason: ScheduleSyncReason.SETTINGS
                        }
                    });
                }
            } catch (error) {
                logger.error('添加当前页面失败:', error);
                this.showStatus('添加失败: ' + error.message, 'error');
            }
        });
    }

    // 切换网站固定状态
    async togglePinSite(site, pinBtn) {
        try {
            const isPinned = await ConfigManager.isPinnedSite(site.url);
            let newSites = [];
            if (!isPinned) {
                // 添加到常用网站
                newSites = await ConfigManager.addPinnedSite(site);
                // 更新按钮状态为取消固定
                if (pinBtn) {
                    pinBtn.title = '取消固定';
                    pinBtn.setAttribute('data-pinned', 'true');
                }
            } else {
                // 从常用网站中移除
                newSites = await ConfigManager.removePinnedSite(site.url);
                // 更新按钮状态为固定到常用网站
                if (pinBtn) {
                    pinBtn.title = '固定到常用网站';
                    pinBtn.setAttribute('data-pinned', 'false');
                }
            }

            // 重新渲染常用网站列表
            await this.renderSites(newSites);

            sendMessageSafely({
                type: MessageType.SCHEDULE_SYNC,
                data: {
                    reason: ScheduleSyncReason.SETTINGS
                }
            });
        } catch (error) {
            logger.error('切换常用网站状态失败:', error);
            this.showStatus(error.message, 'error');
        }
    }

    // 检查网站是否已固定
    async isPinned(url) {
        return await ConfigManager.isPinnedSite(url);
    }

    setupEventListeners() {
        const { 
            searchInput, 
            clearSearchBtn, 
            searchResults, 
            recentSearches, 
            settingsBtn,
            renameDialog,
            newBookmarkTitle, 
            renameCancelBtn, 
            renameSaveBtn,
            editTagsDialog,
            bookmarkTags,
            tagsPreview,
            tagsCancelBtn,
            tagsSaveBtn,
            confirmDialog,
            confirmPrimaryBtn,
            confirmSecondaryBtn
        } = this.elements;

        // 设置按钮点击事件
        settingsBtn.addEventListener('click', async () => {
            await openOptionsPage('overview');
        });

        // 添加全局点击事件处理，用于关闭打开的菜单
        document.addEventListener('click', (e) => {
            // 如果点击的是菜单按钮或菜单本身，不执行关闭操作
            if (e.target.closest('.more-actions-btn') || e.target.closest('.actions-menu')) {
                return;
            }
            
            // 关闭所有打开的菜单
            document.querySelectorAll('.actions-menu.visible').forEach(menu => {
                menu.classList.remove('visible');
            });
        });

        // 搜索输入事件
        searchInput.addEventListener('input', (e) => {
            const query = e.target.value.trim();
            clearSearchBtn.style.display = query ? 'flex' : 'none';
            
            // 清除选中状态
            this.clearSelected();
            // 显示并过滤搜索历史
            this.renderSearchHistory(query.toLowerCase());
        });

        // 搜索框失去焦点事件
        searchInput.addEventListener('blur', () => {
            // 清除选中状态
            this.clearSelected();
            // 只有当鼠标不在搜索历史区域内时才隐藏
            if (!this.isMouseInSearchHistory) {
                this.hideSearchHistory();
            }
        });

        // 跟踪鼠标是否在搜索历史区域内
        recentSearches.addEventListener('mouseenter', () => {
            this.isMouseInSearchHistory = true;
        });

        recentSearches.addEventListener('mouseleave', () => {
            this.isMouseInSearchHistory = false;
        });

        // 搜索历史点击事件
        recentSearches.addEventListener('click', async (e) => {
            const item = e.target.closest('.recent-search-item');
            if (item) {
                const query = item.dataset.query;
                searchInput.value = query;
                this.hideSearchHistory();
                await this.performSearch(query);
            }
        });

        // 清除搜索按钮点击事件
        clearSearchBtn.addEventListener('click', () => {
            searchInput.value = '';
            clearSearchBtn.style.display = 'none';
            this.clearResults();
            searchInput.focus();
        });

        // 按键事件处理
        searchInput.addEventListener('keydown', async (e) => {
            const query = searchInput.value.trim();
            
            switch (e.key) {
                case 'ArrowDown':
                    e.preventDefault();
                    this.moveSelection(1);
                    this.hideSearchHistory();
                    break;

                case 'ArrowUp':
                    e.preventDefault();
                    this.moveSelection(-1);
                    this.hideSearchHistory();
                    break;

                case 'Escape':
                    e.preventDefault();
                    if (query || this.isSearchHistoryVisible()) {
                        // 如果有搜索词，先清空搜索
                        searchInput.value = '';
                        clearSearchBtn.style.display = 'none';
                        this.clearResults();
                        this.hideSearchHistory();
                    } else {
                        window.close();
                    }
                    break;
            }
        });

        // 输入事件处理
        searchInput.addEventListener('keypress', async (e) => {
            const query = searchInput.value.trim();
            if (e.key === 'Enter') {
                e.preventDefault();
                logger.debug('检测到回车键', {
                    query: query,
                });
                if (this.selectedIndex >= 0 && this.resultItems[this.selectedIndex]) {
                    // 如果有选中的结果，打开该结果
                    const url = this.resultItems[this.selectedIndex].dataset.url;
                    await this.openResult(url);
                } else if (query) {
                    // 否则执行搜索
                    this.hideSearchHistory();
                    this.performSearch(query);
                }
            }
        });

        // 重命名对话框事件
        renameCancelBtn.addEventListener('click', () => this.hideRenameDialog());
        renameSaveBtn.addEventListener('click', () => this.saveNewBookmarkTitle());
        
        // 按下Enter键保存新标题
        newBookmarkTitle.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                this.saveNewBookmarkTitle();
            }
        });

        // 点击重命名对话框外部区域关闭对话框
        renameDialog.addEventListener('click', (e) => {
            if (e.target === renameDialog) {
                this.hideRenameDialog();
            }
        });
        
        // 编辑标签对话框事件
        tagsCancelBtn.addEventListener('click', () => this.hideEditTagsDialog());
        tagsSaveBtn.addEventListener('click', () => this.saveNewBookmarkTags());
        
        // 标签输入框按下Enter键添加标签
        bookmarkTags.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                // 添加当前输入的标签
                this.addTagToPreview();
            }
        });
        
        // 点击编辑标签对话框外部区域关闭对话框
        editTagsDialog.addEventListener('click', (e) => {
            if (e.target === editTagsDialog) {
                this.hideEditTagsDialog();
            }
        });

        // confirmDialog 相关事件
        confirmSecondaryBtn.addEventListener('click', () => {
            const callback = this.confirmCancelCallback;
            this.hideConfirmDialog();
            if (callback) {
                callback();
            }
        });

        confirmPrimaryBtn.addEventListener('click', () => {
            const callback = this.confirmConfirmCallback;
            this.hideConfirmDialog();
            if (callback) {
                callback();
            }
        });

        confirmDialog.addEventListener('click', (e) => {
            if (e.target === confirmDialog) {
                this.hideConfirmDialog();
            }
        });

        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                if (confirmDialog.classList.contains('show')) {
                    e.preventDefault();
                    e.stopPropagation();
                    this.hideConfirmDialog();
                }
                if (editTagsDialog.classList.contains('show')) {
                    e.preventDefault();
                    e.stopPropagation();
                    this.hideEditTagsDialog();
                }
                if (renameDialog.classList.contains('show')) {
                    e.preventDefault();
                    e.stopPropagation();
                    this.hideRenameDialog();
                }
            }
        });
        
    }

    isSearchHistoryVisible() {
        const { recentSearches } = this.elements;
        return recentSearches.classList.contains('show');
    }

    hideSearchHistory() {
        const { recentSearches } = this.elements;
        recentSearches.classList.remove('show');
    }

    // 渲染搜索历史
    async renderSearchHistory(query) {
        const { recentSearches } = this.elements;
        if (!this.showSearchHistory) {
            recentSearches.classList.remove('show');
            return;
        }

        const wrapper = recentSearches.querySelector('.recent-searches-wrapper');
        let history = await searchManager.searchHistoryManager.getHistory();

        // 如果有搜索内容，则过滤历史记录
        if (query) {
            history = history.filter(item => item.query.toLowerCase().includes(query));
        }
        
        // 如果历史记录为空，则不显示
        if (history.length === 0) {
            recentSearches.classList.remove('show');
            return;
        }

        // 如果历史记录超过最大显示数量，则截断
        if (history.length > searchManager.searchHistoryManager.MAX_HISTORY_SHOW_QUICK) {
            history = history.slice(0, searchManager.searchHistoryManager.MAX_HISTORY_SHOW_QUICK);
        }

        // 清空容器并添加新的历史记录
        wrapper.innerHTML = history.map(item => `
            <div class="recent-search-item" data-query="${item.query}" title="${item.query}">
                <svg class="search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <circle cx="11" cy="11" r="8"></circle>
                    <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
                </svg>
                <span>${item.query}</span>
                <svg class="delete-history-btn" viewBox="0 0 24 24" title="删除此搜索记录">
                    <path fill="currentColor" d="M19,6.41L17.59,5L12,10.59L6.41,5L5,6.41L10.59,12L5,17.59L6.41,19L12,13.41L17.59,19L19,17.59L13.41,12L19,6.41Z" />
                </svg>
            </div>
        `).join('');
        
        // 添加删除按钮点击事件
        wrapper.querySelectorAll('.delete-history-btn').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                e.stopPropagation(); // 阻止冒泡，防止触发搜索项点击事件
                const item = e.target.closest('.recent-search-item');
                const itemQuery = item.dataset.query;
                
                // 删除此搜索历史
                await searchManager.searchHistoryManager.removeSearch(itemQuery);
                
                // 重新渲染搜索历史
                this.renderSearchHistory(query);
            });
        });
        
        recentSearches.classList.add('show');
    }

    showStatus(message, type = 'error', showClose = false) {
        const { status } = this.elements;
        
        // 清除之前的超时
        if (this.statusTimeout) {
            clearTimeout(this.statusTimeout);
            this.statusTimeout = null;
        }

        // 移除所有状态类
        status.classList.remove('error', 'warning', 'success');
        
        // 设置新状态
        status.classList.add('show', type);
        
        // 构建状态消息HTML
        let html = message;
        if (showClose) {
            html += `
                <button class="close-status" title="关闭">
                    <svg viewBox="0 0 24 24" width="16" height="16">
                        <path fill="currentColor" d="M19,6.41L17.59,5L12,10.59L6.41,5L5,6.41L10.59,12L5,17.59L6.41,19L12,13.41L17.59,19L19,17.59L13.41,12L19,6.41Z" />
                    </svg>
                </button>
            `;
        }
        status.innerHTML = html;

        // 如果不显示关闭按钮，3秒后自动隐藏
        if (!showClose) {
            this.statusTimeout = setTimeout(() => {
                this.hideStatus();
            }, 3000);
        }

        // 添加关闭按钮事件
        const closeBtn = status.querySelector('.close-status');
        if (closeBtn) {
            closeBtn.addEventListener('click', () => {
                this.hideStatus();
            });
        }
    }

    hideStatus() {
        const { status } = this.elements;
        status.classList.remove('show', 'error', 'warning', 'success');
        status.innerHTML = '';
    }

    showLoading() {
        const { searchResults } = this.elements;
        searchResults.innerHTML = `
            <div class="loading">
                <div class="loading-spinner"></div>
                <span>正在搜索...</span>
            </div>
        `;
    }

    clearSelected() {
        if (this.selectedIndex >= 0 && this.resultItems[this.selectedIndex]) {
            this.resultItems[this.selectedIndex].classList.remove('focused');
            this.selectedIndex = -1;
        }
    }

    clearResults() {
        const { searchResults, resultsCount, searchTime } = this.elements;
        searchResults.innerHTML = '';
        searchResults.classList.remove('has-results');
        resultsCount.textContent = '0 个结果';
        searchTime.textContent = '0ms';
        this.lastQuery = '';
        this.lastQueryResult = [];
        // 重置选中状态
        this.selectedIndex = -1;
        this.resultItems = [];
        this.editManager.exitEditMode();
    }

    async refreshSearchResults() {
        // 如果有查询，重新搜索
        if (this.lastQuery) {
            await this.performSearch(this.lastQuery);
        } else {
            this.clearResults();
        }
    }

    async performSearch(query) {
        if (this.isSearching) return;
        
        this.lastQuery = query;
        if (!query) {
            this.clearResults();
            return;
        }

        this.editManager.exitEditMode();

        const { searchResults, resultsCount, searchTime } = this.elements;
        
        try {
            this.isSearching = true;
            searchResults.classList.add('has-results');  // 添加类名以显示加载状态
            this.showLoading();

            const startTime = performance.now();
            
            // 获取用户设置
            const settings = await SettingsManager.getAll();
            const includeChromeBookmarks = settings.display?.showChromeBookmarks || false;

            // 执行搜索
            const results = await searchManager.search(query, {
                debounce: false,
                includeUrl: true,
                includeChromeBookmarks: includeChromeBookmarks
            });

            const endTime = performance.now();
            const timeSpent = Math.round(endTime - startTime);

            if (query !== this.lastQuery) {
                return; // 如果查询已更改，放弃这个结果
            }
            this.lastQueryResult = results;

            // 更新统计信息
            resultsCount.textContent = `${results.length} 个结果`;
            searchTime.textContent = `${timeSpent}ms`;

            // 渲染结果
            await this.renderSearchResults(results);
            
            // 初始化编辑管理器
            this.editManager.initialize(this.lastQueryResult);
        } catch (error) {
            logger.error('搜索失败:', error);
            this.showStatus('搜索失败: ' + error.message, 'error');
            searchResults.innerHTML = `
                <div style="text-align: center; padding: 24px; color: #666;">
                    搜索出错，请重试
                </div>
            `;
        } finally {
            this.isSearching = false;
        }
    }
    
    /**
     * 渲染搜索结果
     * @param {Array} results 搜索结果
     */
    async renderSearchResults(results) {
        const { searchResults } = this.elements;
        
        // 如果没有结果，显示无结果消息
        if (results.length === 0) {
            searchResults.innerHTML = `
                <div style="text-align: center; padding: 24px; color: #666;">
                    未找到相关书签
                </div>
            `;
            return;
        }
        
        // 获取所有结果的favicon
        const faviconPromises = results.map(result => getFaviconUrl(result.url));
        const favicons = await Promise.all(faviconPromises);

        // 将favicon添加到结果中
        const resultsWithFavicon = results.map((result, index) => ({
            ...result,
            favicon: favicons[index]
        }));
        
        // 清空结果容器
        searchResults.innerHTML = '';
        
        // 获取固定网站信息
        const pinnedSites = await ConfigManager.getPinnedSites();
        
        // 逐个创建并添加结果项
        for (const result of resultsWithFavicon) {
            const resultElement = this.createSearchResultItem(result, pinnedSites);
            searchResults.appendChild(resultElement);
        }
        
        // 保存结果项引用，用于键盘导航
        this.resultItems = Array.from(searchResults.querySelectorAll('.search-result-item'));
    }
    
    /**
     * 创建单个搜索结果项
     * @param {Object} result 搜索结果项
     * @param {Array} pinnedSites 已固定的网站列表
     * @returns {HTMLElement} 创建的DOM元素
     */
    createSearchResultItem(result, pinnedSites) {
        // 创建结果项容器
        const resultItem = document.createElement('div');
        resultItem.className = 'search-result-item';
        if (result.score >= 85) {
            resultItem.classList.add('high-relevance');
        }
        resultItem.dataset.url = result.url;
        
        // 判断是否已固定
        const isPinned = pinnedSites.some(site => site.url === result.url);
        
        // 生成相关度星级
        const relevanceStarsHtml = this.getRelevanceStarsHtml(result.score, result.similarity);

        const tags = result.tags.map(tag => `<span class="result-tag">${tag}</span>`).join('');
        
        // 处理保存时间格式化
        const formattedDate = result.savedAt ? new Date(result.savedAt).toLocaleDateString(navigator.language, {year: 'numeric', month: 'long', day: 'numeric'}) : '未知时间';

        // 设置HTML内容
        resultItem.innerHTML = `
            <div class="bookmark-checkbox">
                <input type="checkbox" title="选择此书签">
            </div>
            <a href="${result.url}" class="result-link" target="_blank">
                <div class="result-title">
                    <img src="${result.favicon}" 
                        class="favicon-img"
                        alt="favicon">
                    <span class="title-text" title="${result.title}">${result.title}</span>
                    ${relevanceStarsHtml}
                </div>
                <div class="result-url" title="${result.url}">${result.url}</div>
                <div class="result-excerpt" title="${result.excerpt}">${result.excerpt}</div>
                <div class="result-tags">${tags}</div>
                <!-- 书签底部信息栏 -->
                <div class="result-metadata">
                    <div class="result-saved-time" title="收藏于 ${formattedDate}">
                        <svg viewBox="0 0 24 24" width="14" height="14">
                            <path fill="currentColor" d="M12,20A8,8 0 0,0 20,12A8,8 0 0,0 12,4A8,8 0 0,0 4,12A8,8 0 0,0 12,20M12,2A10,10 0 0,1 22,12A10,10 0 0,1 12,22C6.47,22 2,17.5 2,12A10,10 0 0,1 12,2M12.5,7V12.25L17,14.92L16.25,16.15L11,13V7H12.5Z" />
                        </svg>
                        <span>${formattedDate}</span>
                    </div>
                </div>
            </a>

            <!-- 三点菜单按钮 -->
            <div class="more-actions-btn" title="更多操作">
                <svg viewBox="0 0 24 24" width="16" height="16">
                    <circle cx="12" cy="5" r="2.2" fill="currentColor" />
                    <circle cx="12" cy="12" r="2.2" fill="currentColor" />
                    <circle cx="12" cy="19" r="2.2" fill="currentColor" />
                </svg>
            </div>
            
            <!-- 操作菜单（默认隐藏） -->
            <div class="actions-menu">
                <div class="actions-menu-content">
                    <button class="action-btn share-btn" title="复制链接">
                        <svg viewBox="0 0 24 24" width="20" height="20">
                            <path fill="currentColor" d="M18,16.08C17.24,16.08 16.56,16.38 16.04,16.85L8.91,12.7C8.96,12.47 9,12.24 9,12C9,11.76 8.96,11.53 8.91,11.3L15.96,7.19C16.5,7.69 17.21,8 18,8A3,3 0 0,0 21,5A3,3 0 0,0 18,2A3,3 0 0,0 15,5C15,5.24 15.04,5.47 15.09,5.7L8.04,9.81C7.5,9.31 6.79,9 6,9A3,3 0 0,0 3,12A3,3 0 0,0 6,15C6.79,15 7.5,14.69 8.04,14.19L15.16,18.34C15.11,18.55 15.08,18.77 15.08,19C15.08,20.61 16.39,21.91 18,21.91C19.61,21.91 20.92,20.61 20.92,19A2.92,2.92 0 0,0 18,16.08Z" />
                        </svg>
                    </button>
                    <button class="action-btn rename-btn" title="修改名称">
                        <svg viewBox="0 0 24 24" width="20" height="20">
                            <path fill="currentColor" d="M20.71,7.04C21.1,6.65 21.1,6 20.71,5.63L18.37,3.29C18,2.9 17.35,2.9 16.96,3.29L15.12,5.12L18.87,8.87M3,17.25V21H6.75L17.81,9.93L14.06,6.18L3,17.25Z" />
                        </svg>
                    </button>
                    ${result.source === BookmarkSource.EXTENSION ? `
                    <button class="action-btn edit-tags-btn" title="编辑标签">
                        <svg viewBox="0 0 24 24" width="20" height="20">
                            <path fill="currentColor" d="M21.41,11.58L12.41,2.58C12.04,2.21 11.53,2 11,2H4C2.9,2 2,2.9 2,4V11C2,11.53 2.21,12.04 2.59,12.41L11.58,21.4C11.95,21.78 12.47,22 13,22C13.53,22 14.04,21.79 14.41,21.41L21.41,14.41C21.79,14.04 22,13.53 22,13C22,12.47 21.79,11.96 21.41,11.58M5.5,7C4.67,7 4,6.33 4,5.5C4,4.67 4.67,4 5.5,4C6.33,4 7,4.67 7,5.5C7,6.33 6.33,7 5.5,7Z" />
                        </svg>
                    </button>
                    ` : ''}
                    ${this.sitesDisplayType === 'pinned' ? `
                    <button class="action-btn pin-btn" title="${isPinned ? '取消固定' : '固定到常用网站'}" data-pinned="${isPinned}">
                        <svg viewBox="0 0 24 24" width="20" height="20">
                            <path fill="currentColor" d="M16,12V4H17V2H7V4H8V12L6,14V16H11.2V22H12.8V16H18V14L16,12Z" />
                        </svg>
                    </button>
                    ` : ''}
                    <button class="action-btn delete-btn" title="删除">
                        <svg viewBox="0 0 24 24" width="20" height="20">
                            <path fill="currentColor" d="M19,4H15.5L14.5,3H9.5L8.5,4H5V6H19M6,19A2,2 0 0,0 8,21H16A2,2 0 0,0 18,19V7H6V19Z" />
                        </svg>
                    </button>
                </div>
                <div class="actions-menu-header">
                    <button class="close-menu-btn" title="关闭">
                        <svg viewBox="0 0 24 24" width="20" height="20">
                            <path fill="currentColor" d="M19,6.41L17.59,5L12,10.59L6.41,5L5,6.41L10.59,12L5,17.59L6.41,19L12,13.41L17.59,19L19,17.59L13.41,12L19,6.41Z"></path>
                        </svg>
                    </button>
                </div>
            </div>
        `;
        
        // 设置各种事件监听
        this.setupResultItemEvents(resultItem, result);
        
        return resultItem;
    }
    
    /**
     * 获取相关度星级HTML
     * @param {number} score 相关度得分
     * @param {number} similarity 相似度
     * @returns {string} 星级HTML
     */
    getRelevanceStarsHtml(score, similarity) {
        if (similarity < 0.01) {
            return '';
        }
        
        let stars;
        if (score >= 85) {
            // 高相关：三颗绿星
            stars = `
                <span class="relevance-star high">★</span>
                <span class="relevance-star high">★</span>
                <span class="relevance-star high">★</span>
            `;
        } else if (score >= 65) {
            // 中等相关：根据分数显示1-2颗橙星
            stars = `
                <span class="relevance-star medium">★</span>
                ${score >= 75 ? '<span class="relevance-star medium">★</span>' : '<span class="relevance-star low">★</span>'}
                <span class="relevance-star low">★</span>
            `;
        } else {
            // 低相关：三颗灰星
            stars = `
                <span class="relevance-star low">★</span>
                <span class="relevance-star low">★</span>
                <span class="relevance-star low">★</span>
            `;
        }

        return `<div class="result-score">
            <div class="relevance-stars">${stars}</div>
        </div>`;
    }
    
    /**
     * 为结果项设置事件监听
     * @param {HTMLElement} resultItem 结果项元素
     * @param {Object} result 结果数据
     */
    setupResultItemEvents(resultItem, result) {
        const url = result.url;
        
        // 设置结果项点击事件
        resultItem.addEventListener('click', async (e) => {
            if (e.target.closest('.more-actions-btn') || 
                    e.target.closest('.actions-menu') || 
                    e.target.closest('.bookmark-checkbox')) {
                return;
            }

            // 处理多选模式的点击事件
            if (this.editManager.isEditMode) {
                // 如果点击的不是交互元素（如按钮或复选框）
                e.preventDefault();
                e.stopPropagation();
                
                // 获取结果项的复选框
                const checkbox = resultItem.querySelector('.bookmark-checkbox input');
                if (checkbox) {
                    // 触发复选框的change事件
                    checkbox.checked = !checkbox.checked;
                    const isShiftKey = e.shiftKey;
                    const changeEvent = new Event('change', { bubbles: true });
                    changeEvent.shiftKey = isShiftKey;
                    checkbox.dispatchEvent(changeEvent);
                }
                return;
            }
        });

        // 修改点击事件处理
        const link = resultItem.querySelector('.result-link');
        link.addEventListener('click', async (e) => {
            // 非编辑模式下的正常处理
            if (isNonMarkableUrl(result.url)) {
                e.preventDefault();
                // 显示提示并提供复制链接选项
                const copyConfirm = confirm('此页面无法直接打开。是否复制链接到剪贴板？');
                if (copyConfirm) {
                    await navigator.clipboard.writeText(result.url);
                    updateStatus('链接已复制到剪贴板');
                }
            } else {
                // 更新使用频率
                if (result.source === BookmarkSource.EXTENSION) {
                    await updateBookmarkUsage(result.url);
                }
            }
        });
        
        // 为favicon图片添加错误处理
        const faviconImg = resultItem.querySelector('.favicon-img');
        if (faviconImg) {
            faviconImg.addEventListener('error', function() {
                this.src = 'icons/default_favicon.png';
            });
        }
        
        // 设置复选框事件
        const checkbox = resultItem.querySelector('.bookmark-checkbox input');
        if (checkbox) {
            checkbox.addEventListener('change', (e) => {
                logger.debug('checkbox change', e);
                // 如果没有处于编辑模式，则进入编辑模式
                if (!this.editManager.isEditMode) {
                    this.editManager.initialize(this.lastQueryResult);
                    this.editManager.enterEditMode(resultItem);
                } else {
                    // 已经处于编辑模式，就切换选中状态
                    this.editManager.toggleBookmarkSelection(
                        resultItem, 
                        e.target.checked, 
                        e.shiftKey
                    );
                }
            });
        }
        
        // 处理三点菜单按钮点击
        const moreActionsBtn = resultItem.querySelector('.more-actions-btn');
        if (moreActionsBtn) {
            moreActionsBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                
                // 获取当前菜单
                const menu = moreActionsBtn.nextElementSibling;
                
                // 关闭所有其他打开的菜单
                document.querySelectorAll('.actions-menu.visible').forEach(openMenu => {
                    if (openMenu !== menu) {
                        openMenu.classList.remove('visible');
                    }
                });
                
                // 切换当前菜单
                menu.classList.toggle('visible');
            });
        }
        
        // 处理关闭菜单按钮点击
        const closeMenuBtn = resultItem.querySelector('.close-menu-btn');
        if (closeMenuBtn) {
            closeMenuBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                closeMenuBtn.closest('.actions-menu').classList.remove('visible');
            });
        }
        
        // 设置各种操作按钮的点击事件
        this.setupActionButtonEvents(resultItem, result);
    }
    
    /**
     * 为操作按钮设置事件监听
     * @param {HTMLElement} resultItem 结果项元素
     * @param {Object} result 结果数据
     */
    setupActionButtonEvents(resultItem, result) {
        const url = result.url;
        
        // 共享按钮
        const shareBtn = resultItem.querySelector('.action-btn.share-btn');
        if (shareBtn) {
            shareBtn.addEventListener('click', async (e) => {
                e.preventDefault();
                e.stopPropagation();
                
                try {
                    await navigator.clipboard.writeText(url);
                    this.showStatus('链接已复制到剪贴板', 'success');
                } catch (error) {
                    this.showStatus('复制链接失败', 'error');
                }
                
                // 关闭菜单
                shareBtn.closest('.actions-menu').classList.remove('visible');
            });
        }
        
        // 重命名按钮
        const renameBtn = resultItem.querySelector('.action-btn.rename-btn');
        if (renameBtn) {
            renameBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                
                const bookmark = this.lastQueryResult.find(item => item.url === url);
                if (bookmark) {
                    this.showRenameDialog(bookmark, resultItem);
                } else {
                    this.showStatus('未找到要修改的书签', 'error');
                }
                
                // 关闭菜单
                renameBtn.closest('.actions-menu').classList.remove('visible');
            });
        }
        
        // 编辑标签按钮
        const editTagsBtn = resultItem.querySelector('.action-btn.edit-tags-btn');
        if (editTagsBtn) {
            editTagsBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                
                const bookmark = this.lastQueryResult.find(item => item.url === url);
                if (bookmark) {
                    // 确保只对扩展自身的书签显示标签编辑功能
                    if (bookmark.source === BookmarkSource.EXTENSION) {
                        this.showEditTagsDialog(bookmark, resultItem);
                    } else {
                        this.showStatus('原生书签不支持标签功能', 'warning');
                    }
                } else {
                    this.showStatus('未找到要编辑的书签', 'error');
                }
                
                // 关闭菜单
                editTagsBtn.closest('.actions-menu').classList.remove('visible');
            });
        }
        
        // 固定/取消固定按钮
        const pinBtn = resultItem.querySelector('.action-btn.pin-btn');
        if (pinBtn) {
            pinBtn.addEventListener('click', async (e) => {
                e.preventDefault();
                e.stopPropagation();
                
                const title = resultItem.querySelector('.title-text').textContent;
                await this.togglePinSite({ url, title }, pinBtn);
                
                // 关闭菜单
                pinBtn.closest('.actions-menu').classList.remove('visible');
            });
        }
        
        // 删除按钮
        const deleteBtn = resultItem.querySelector('.action-btn.delete-btn');
        if (deleteBtn) {
            deleteBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                
                this.showConfirmDialog({
                    title: '删除书签',
                    message: '确定要删除此书签吗？',
                    primaryText: '删除',
                    secondaryText: '取消',
                    messageAlign: 'center',
                    onPrimary: () => {
                        this.deleteBookmark(url, resultItem);
                    },
                });
                
                // 关闭菜单
                deleteBtn.closest('.actions-menu').classList.remove('visible');
            });
        }
    }

    // 移动选择
    moveSelection(direction) {
        this.resultItems = Array.from(this.elements.searchResults.querySelectorAll('.search-result-item'));
        if (this.resultItems.length === 0) return;

        // 移除当前选中项的样式
        if (this.selectedIndex >= 0) {
            this.resultItems[this.selectedIndex]?.classList.remove('focused');
        }

        // 计算新的索引
        this.selectedIndex += direction;
        if (this.selectedIndex >= this.resultItems.length) {
            this.selectedIndex = 0;
        } else if (this.selectedIndex < 0) {
            this.selectedIndex = this.resultItems.length - 1;
        }

        // 添加新选中项的样式
        const selectedItem = this.resultItems[this.selectedIndex];
        selectedItem.classList.add('focused');
        selectedItem.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }

    // 打开结果
    async openResult(url) {
        if (!url) return;
        
        try {
            // 更新使用频率
            await updateBookmarkUsage(url);
            // 在新标签页中打开URL
            await chrome.tabs.create({ url: url });
            window.close();
        } catch (error) {
            logger.error('打开链接失败:', error);
            this.showStatus('打开链接失败: ' + error.message, 'error');
        }
    }

    // 删除书签
    async deleteBookmark(url, resultItem) {
        try {
            // 添加删除中的样式
            resultItem.classList.add('deleting');

            const bookmark = this.lastQueryResult.find(item => item.url === url);
            if (!bookmark) {
                this.showStatus('未找到要删除的书签', 'warning');
                resultItem.classList.remove('deleting');
                return;
            }

            if (bookmark.source === BookmarkSource.EXTENSION) {
                await LocalStorageMgr.removeBookmark(bookmark.url);
                await recordBookmarkChange(bookmark, true, true);
            } else {
                await chrome.bookmarks.remove(bookmark.chromeId);
            }
            
            // 显示成功提示
            this.showStatus('书签已删除', 'success');

            // 从结果列表中移除这个项目
            this.lastQueryResult = this.lastQueryResult.filter(item => item.url !== url);
            
            // 等待动画完成后从DOM中移除元素
            setTimeout(() => {
                // 移除DOM元素
                resultItem.remove();
                
                // 更新结果数量
                this.resultItems = Array.from(this.elements.searchResults.querySelectorAll('.search-result-item'));
                this.elements.resultsCount.textContent = `${this.resultItems.length} 个结果`;
                
                // 如果删除后没有结果了，显示无结果提示
                if (this.resultItems.length === 0) {
                    this.elements.searchResults.innerHTML = `
                        <div style="text-align: center; padding: 24px; color: #666;">
                            未找到相关书签
                        </div>
                    `;
                }
            }, 300);
        } catch (error) {
            // 移除删除中的样式
            resultItem.classList.remove('deleting');
            logger.error('删除书签失败:', error);
            this.showStatus('删除书签失败: ' + error.message, 'error');
        }
    }

    // 显示重命名对话框
    showRenameDialog(bookmark, resultItem) {
        const { renameDialog, newBookmarkTitle } = this.elements;
        
        this.renamingBookmark = bookmark;
        this.renamingResultItem = resultItem;
        
        // 设置当前标题
        newBookmarkTitle.value = bookmark.title;
        
        // 显示对话框
        renameDialog.classList.add('show');
        
        // 聚焦输入框并选中全部文字
        setTimeout(() => {
            newBookmarkTitle.focus();
            newBookmarkTitle.select();
        }, 100);
    }
    
    // 隐藏重命名对话框
    hideRenameDialog() {
        const { renameDialog } = this.elements;
        renameDialog.classList.remove('show');
        this.renamingBookmark = null;
        this.renamingResultItem = null;
    }
    
    // 保存新的书签标题
    async saveNewBookmarkTitle() {
        const { newBookmarkTitle } = this.elements;
        const newTitle = newBookmarkTitle.value.trim();
        
        if (!newTitle) {
            this.showStatus('书签名称不能为空', 'warning');
            return;
        }
        
        if (!this.renamingBookmark) {
            this.hideRenameDialog();
            return;
        }

        // 检查名称是否发生变化
        if (newTitle === this.renamingBookmark.title) {
            this.showStatus('书签名称未发生变化', 'success');
            this.hideRenameDialog();
            return;
        }
        
        try {
            // 获取书签数据
            const bookmark = this.renamingBookmark;
            const url = bookmark.url;
            
            // 根据书签来源执行不同的更新操作
            if (bookmark.source === BookmarkSource.EXTENSION) {
                const data = await LocalStorageMgr.getBookmark(url, true);
                if (data) {
                    // 更新标题
                    data.title = newTitle;
                    await LocalStorageMgr.setBookmark(url, data);
                    
                    // 发送同步消息
                    await recordBookmarkChange(data, false, true);
                }
            } else if (bookmark.source === BookmarkSource.CHROME) {
                // 更新Chrome书签
                await chrome.bookmarks.update(bookmark.chromeId, {
                    title: newTitle
                });
            }

            // 更新SearchResult
            const index = this.lastQueryResult.findIndex(item => item.url === url);
            if (index !== -1) {
                this.lastQueryResult[index].title = newTitle;
            }
            
            // 更新UI
            if (this.renamingResultItem) {
                const titleElement = this.renamingResultItem.querySelector('.title-text');
                if (titleElement) {
                    titleElement.textContent = newTitle;
                    titleElement.title = newTitle;
                }
            }
            
            this.showStatus('书签名称修改成功', 'success');
        } catch (error) {
            logger.error('修改书签名称失败:', error);
            this.showStatus('修改书签名称失败: ' + error.message, 'error');
        } finally {
            this.hideRenameDialog();
        }
    }

    // 显示编辑标签对话框
    showEditTagsDialog(bookmark, resultItem) {
        const { editTagsDialog, bookmarkTags, tagsPreview } = this.elements;
        
        this.editingTagsBookmark = bookmark;
        this.editingTagsResultItem = resultItem;
        
        // 获取标签 - 创建一个新的数组副本而不是直接引用
        this.currentTags = bookmark.tags ? [...bookmark.tags] : [];

        // 清空输入框
        bookmarkTags.value = '';
        
        // 更新标签预览
        this.updateTagsPreview();
        
        // 显示对话框
        editTagsDialog.classList.add('show');
        
        // 聚焦输入框
        setTimeout(() => {
            bookmarkTags.focus();
        }, 100);
    }
    
    // 隐藏编辑标签对话框
    hideEditTagsDialog() {
        const { editTagsDialog } = this.elements;
        
        editTagsDialog.classList.remove('show');
        this.editingTagsBookmark = null;
        this.editingTagsResultItem = null;
        this.currentTags = [];
    }
    
    // 添加标签到预览区域
    addTagToPreview() {
        const { bookmarkTags } = this.elements;
        const tag = bookmarkTags.value.trim();
        
        if (!tag) return;
        
        // 检查标签是否已存在
        if (!this.currentTags.includes(tag)) {
            // 添加到标签列表
            this.currentTags.push(tag);
            
            // 更新预览
            this.updateTagsPreview();
        }
        
        // 清空输入框
        bookmarkTags.value = '';
    }
    
    // 更新标签预览
    updateTagsPreview() {
        const { tagsPreview } = this.elements;
        
        if (this.currentTags.length === 0) {
            tagsPreview.innerHTML = '<div class="tags-empty-message">暂无标签，在上方输入框输入标签后按回车添加</div>';
            return;
        }
        
        tagsPreview.innerHTML = this.currentTags.map(tag => `
            <div class="tag-preview-item" data-tag="${tag}">
                <span>${tag}</span>
                <div class="remove-tag" title="删除此标签">×</div>
            </div>
        `).join('');
        
        // 添加删除标签的事件
        tagsPreview.querySelectorAll('.remove-tag').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const tagItem = e.target.closest('.tag-preview-item');
                const tag = tagItem.dataset.tag;
                
                // 从标签列表中移除
                this.currentTags = this.currentTags.filter(t => t !== tag);
                
                // 更新预览
                this.updateTagsPreview();
            });
        });
    }
    
    // 保存新的书签标签
    async saveNewBookmarkTags() {
        // 如果没有正在编辑的书签，直接返回
        if (!this.editingTagsBookmark) {
            this.hideEditTagsDialog();
            return;
        }
        
        try {
            // 获取书签数据
            const bookmark = this.editingTagsBookmark;
            const url = bookmark.url;
            
            // 如果当前标签和原始标签相同，不进行更新
            if (JSON.stringify(this.currentTags) === JSON.stringify(bookmark.tags || [])) {
                this.showStatus('标签未发生更改', 'success');
                this.hideEditTagsDialog();
                return;
            }
            
            // 确保只处理扩展自身的书签
            if (bookmark.source === BookmarkSource.EXTENSION) {
                const data = await LocalStorageMgr.getBookmark(url, true);
                if (data) {
                    // 更新标签
                    data.tags = this.currentTags;
                    await LocalStorageMgr.setBookmark(url, data);
                    
                    // 发送同步消息
                    await recordBookmarkChange(data, false, true);
                    
                    // 更新搜索结果中的标签
                    const index = this.lastQueryResult.findIndex(item => item.url === url);
                    if (index !== -1) {
                        this.lastQueryResult[index].tags = this.currentTags;
                    }
                    
                    // 更新UI
                    this.updateResultItemTags(this.editingTagsResultItem, this.currentTags);
                    
                    this.showStatus('标签修改成功', 'success');
                }
            }
        } catch (error) {
            logger.error('修改书签标签失败:', error);
            this.showStatus('修改标签失败: ' + error.message, 'error');
        } finally {
            this.hideEditTagsDialog();
        }
    }
    
    // 更新结果项的标签显示
    updateResultItemTags(resultItem, tags) {
        if (!resultItem) return;

        let tagsElement = resultItem.querySelector('.result-tags');
        // 更新标签内容
        tagsElement.innerHTML = tags.map(tag => `<span class="result-tag">${tag}</span>`).join('');
    }

    hideConfirmDialog() {
        const { confirmDialog, confirmPrimaryBtn, confirmSecondaryBtn } = this.elements;
        confirmDialog.classList.remove('show');
        confirmPrimaryBtn.disabled = false;
        confirmSecondaryBtn.disabled = false;
        this.confirmCancelCallback = null;  
        this.confirmConfirmCallback = null;
    }

    showConfirmDialog(params) {
        const { confirmDialog, confirmTitle, confirmMessage, confirmPrimaryBtn, confirmSecondaryBtn } = this.elements;
        confirmMessage.classList.remove('align-center');
        
        if (confirmDialog.classList.contains('show')) {
            this.hideConfirmDialog();
        }

        confirmTitle.textContent = params.title || '提示';
        confirmMessage.textContent = params.message;
        confirmPrimaryBtn.textContent = params.primaryText || '确定';
        confirmSecondaryBtn.textContent = params.secondaryText || '取消';

        if (params.messageAlign === 'center') {
            confirmMessage.classList.add('align-center');
        }
        this.confirmCancelCallback = params.onSecondary;
        this.confirmConfirmCallback = params.onPrimary;
        
        confirmDialog.classList.add('show');
    }
}

// 初始化
document.addEventListener('DOMContentLoaded', () => {
    new QuickSearchManager();
}); 