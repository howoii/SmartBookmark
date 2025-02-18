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
            dropZone: document.getElementById('drop-zone')
        };

        this.lastQuery = '';
        this.isSearching = false;
        this.selectedIndex = -1;
        this.resultItems = [];
        this.draggedElement = null;
        this.draggedElementIndex = -1;
        this.sitesDisplayType = 'pinned';
        this.sitesDisplayCount = 10;

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

            // 根据设置显示网站
            await this.renderSites();
            
            // 设置事件监听
            this.setupEventListeners();
            
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
                        const pinIcon = document.querySelector(`.search-result-item[data-url="${url}"] .pin-icon`);
                        if (pinIcon) {
                            pinIcon.classList.remove('pinned');
                            pinIcon.title = '固定到常用网站';
                        }
                    }, 300);
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
        const data = await getDisplayedBookmarks();

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
                }
            } catch (error) {
                logger.error('添加当前页面失败:', error);
                this.showStatus('添加失败: ' + error.message, 'error');
            }
        });
    }

    // 切换网站固定状态
    async togglePinSite(site, pinIcon) {
        try {
            const isPinned = await ConfigManager.isPinnedSite(site.url);
            let newSites = [];
            if (!isPinned) {
                // 添加到常用网站
                newSites = await ConfigManager.addPinnedSite(site);
                // 更新图标状态为已固定
                pinIcon.classList.add('pinned');
                pinIcon.title = '取消固定';
            } else {
                // 从常用网站中移除
                newSites = await ConfigManager.removePinnedSite(site.url);
                // 更新图标状态为未固定
                pinIcon.classList.remove('pinned');
                pinIcon.title = '固定到常用网站';
            }

            // 重新渲染常用网站列表
            await this.renderSites(newSites);
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
        const { searchInput, clearSearchBtn, searchResults } = this.elements;

        // 搜索输入事件
        searchInput.addEventListener('input', (e) => {
            const query = e.target.value.trim();
            clearSearchBtn.style.display = query ? 'flex' : 'none';
            
            // 清除选中状态
            this.clearSelected();
        });

        searchInput.addEventListener('blur', () => {
            this.clearSelected();
        });

        // 清除搜索按钮点击事件
        clearSearchBtn.addEventListener('click', () => {
            searchInput.value = '';
            clearSearchBtn.style.display = 'none';
            this.clearResults();
            searchInput.focus();
        });

        // 搜索结果点击事件
        searchResults.addEventListener('click', async (e) => {
            const resultItem = e.target.closest('.search-result-item');
            const pinIcon = e.target.closest('.pin-icon');
            
            if (pinIcon && this.sitesDisplayType === 'pinned') {
                // 点击了固定图标，且当前是固定网站模式
                e.preventDefault();
                e.stopPropagation();
                const url = resultItem.dataset.url;
                const title = resultItem.querySelector('.title-text').textContent;
                await this.togglePinSite({ url, title }, pinIcon);
            } else if (resultItem) {
                // 点击了结果项
                const url = resultItem.dataset.url;
                if (url) {
                    await this.openResult(url);
                }
            }
        });

        // 按键事件处理
        searchInput.addEventListener('keydown', async (e) => {
            const query = searchInput.value.trim();
            
            switch (e.key) {
                case 'Enter':
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
                        this.performSearch(query);
                    }
                    break;

                case 'ArrowDown':
                    e.preventDefault();
                    this.moveSelection(1);
                    break;

                case 'ArrowUp':
                    e.preventDefault();
                    this.moveSelection(-1);
                    break;

                case 'Escape':
                    e.preventDefault();
                    if (query) {
                        // 如果有搜索词，先清空搜索
                        searchInput.value = '';
                        clearSearchBtn.style.display = 'none';
                        this.clearResults();
                    } else {
                        // 如果已经是空的，关闭窗口
                        window.close();
                    }
                    break;
            }
        });

        document.addEventListener('dragend', this.handleGlobalDragEnd.bind(this));
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
            this.resultItems[this.selectedIndex].classList.remove('selected');
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
        // 重置选中状态
        this.selectedIndex = -1;
        this.resultItems = [];
    }

    async performSearch(query) {
        if (this.isSearching) return;
        
        this.lastQuery = query;
        if (!query) {
            this.clearResults();
            return;
        }

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

            // 更新统计信息
            resultsCount.textContent = `${results.length} 个结果`;
            searchTime.textContent = `${timeSpent}ms`;

            // 渲染结果
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

            // 添加获取相关度显示的函数
            const getRelevanceStars = (score, similarity) => {
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
            };

            searchResults.innerHTML = await Promise.all(resultsWithFavicon.map(async result => `
                <div class="search-result-item ${result.score >= 85 ? 'high-relevance' : ''}" data-url="${result.url}">
                    <div class="result-title">
                        <img src="${result.favicon}" 
                             class="favicon-img"
                             alt="favicon">
                        <span class="title-text" title="${result.title}">${result.title}</span>
                        ${this.sitesDisplayType === 'pinned' ? `
                            <div class="pin-icon ${await this.isPinned(result.url) ? 'pinned' : ''}" title="${await this.isPinned(result.url) ? '取消固定' : '固定到常用网站'}">
                                <div class="bookmark-ribbon"></div>
                            </div>
                        ` : ''}
                        ${getRelevanceStars(result.score, result.similarity)}
                    </div>
                    <div class="result-url" title="${result.url}">${result.url}</div>
                    ${result.excerpt ? `<div class="result-excerpt" title="${result.excerpt}">${result.excerpt}</div>` : ''}
                    ${result.tags && result.tags.length > 0 ? `
                        <div class="result-tags">
                            ${result.tags.map(tag => `<span class="result-tag">${tag}</span>`).join('')}
                        </div>
                    ` : ''}
                </div>
            `)).then(results => results.join(''));

            // 为所有favicon图片添加错误处理
            document.querySelectorAll('.favicon-img').forEach(img => {
                img.addEventListener('error', function() {
                    this.src = 'icons/default_favicon.png';
                });
            });

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

    // 更新所有固定图标的状态
    updatePinIcons() {
        document.querySelectorAll('.search-result-item').forEach(item => {
            const url = item.dataset.url;
            const pinIcon = item.querySelector('.pin-icon');
            if (pinIcon) {
                if (this.isPinned(url)) {
                    pinIcon.classList.add('pinned');
                    pinIcon.title = '取消固定';
                } else {
                    pinIcon.classList.remove('pinned');
                    pinIcon.title = '固定到常用网站';
                }
            }
        });
    }

    // 移动选择
    moveSelection(direction) {
        this.resultItems = Array.from(this.elements.searchResults.querySelectorAll('.search-result-item'));
        if (this.resultItems.length === 0) return;

        // 移除当前选中项的样式
        if (this.selectedIndex >= 0) {
            this.resultItems[this.selectedIndex]?.classList.remove('selected');
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
        selectedItem.classList.add('selected');
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
}

// 初始化
document.addEventListener('DOMContentLoaded', () => {
    new QuickSearchManager();
}); 