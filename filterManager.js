// 筛选器基类
class BookmarkFilter {
    constructor() {
        this.activeFilters = new Set();
        this.tempFilters = new Set();
        this.filterCounts = new Map(); // 存储每个筛选条件对应的书签数量
    }

    // 获取筛选选项的显示名称
    getName() {
        throw new Error('Must implement getName');
    }

    // 获取筛选选项的图标
    getIcon() {
        throw new Error('Must implement getIcon');
    }

    // 渲染筛选菜单内容
    renderFilterContent(container) {
        throw new Error('Must implement renderFilterContent');
    }

    // 刷新筛选菜单内容
    refreshFilterContent(container) {
        throw new Error('Must implement refreshFilterContent');
    }

    // 应用筛选条件
    applyFilter() {
        throw new Error('Must implement applyFilter');
    }

    filterBookmarks(bookmarks) {
        throw new Error('Must implement filterBookmarks');
    }

    // 清除筛选条件
    clearFilter() {
        throw new Error('Must implement clearFilter');
    }

    // 获取当前激活的筛选条件
    getActiveFilters() {
        return Array.from(this.activeFilters);
    }

    // 更新筛选条件的书签数量
    async updateFilterCounts(bookmarks) {
        throw new Error('Must implement updateFilterCounts');
    }

    // 渲染筛选菜单标题栏
    renderFilterHeader(headerElement) {
        const titleElement = headerElement.querySelector('.filter-menu-title');
        titleElement.textContent = this.getName();
    }
}

// 标签筛选器
class TagFilter extends BookmarkFilter {
    constructor() {
        super();
        this.availableTags = new Set();
        /** @type {'count'|'name'|'selected'} 标签排序模式：按数量、按名称、选中优先 */
        this.sortMode = 'count';
    }

    async init(bookmarksList) {
        this.updateAvailableTags(bookmarksList);
        await this.updateFilterCounts(bookmarksList);
    }

    getName() {
        return i18n.getMessage('filter_tag_name');
    }

    getIcon() {
        return `<svg viewBox="0 0 24 24" width="16" height="16">
            <path fill="none" stroke="currentColor" stroke-width="1.5" 
                  d="M21.4 11.6l-9-9C12.1 2.2 11.6 2 11 2H4c-1.1 0-2 .9-2 2v7c0 .6.2 1.1.6 1.4l9 9c.4.4.9.6 1.4.6s1-.2 1.4-.6l7-7c.4-.4.6-.9.6-1.4 0-.6-.2-1.1-.6-1.4z"/>
            <circle fill="currentColor" opacity="0.3" cx="5.5" cy="5.5" r="1.5"/>
            <path fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" 
                  d="M6 9.6l7.4 7.4M9.5 6.1l7.4 7.4"/>
        </svg>`;
    }

    updateAvailableTags(bookmarks) {
        this.availableTags.clear();
        bookmarks.forEach(bookmark => {
            bookmark.tags.forEach(tag => this.availableTags.add(tag));
        });
        logger.debug('updateAvailableTags 完成，数量:', this.availableTags.size);
    }

    async updateFilterCounts(bookmarks) {
        this.filterCounts.clear();
        bookmarks.forEach(bookmark => {
            bookmark.tags.forEach(tag => {
                this.filterCounts.set(tag, (this.filterCounts.get(tag) || 0) + 1);
            });
        });
    }

    /**
     * 根据当前 sortMode 返回标签排序比较函数
     */
    _getTagSortComparator() {
        const mode = this.sortMode;
        if (mode === 'name') {
            return (a, b) => a.localeCompare(b);
        }
        if (mode === 'selected') {
            return (a, b) => {
                const aSel = this.tempFilters.has(a) ? 1 : 0;
                const bSel = this.tempFilters.has(b) ? 1 : 0;
                if (bSel !== aSel) return bSel - aSel; // 选中的在前
                const countDiff = (this.filterCounts.get(b) || 0) - (this.filterCounts.get(a) || 0);
                return countDiff !== 0 ? countDiff : a.localeCompare(b);
            };
        }
        // 默认 count：按书签数量降序
        return (a, b) => {
            const countDiff = (this.filterCounts.get(b) || 0) - (this.filterCounts.get(a) || 0);
            return countDiff !== 0 ? countDiff : a.localeCompare(b);
        };
    }

    renderFilterContent(container, onApplyCallback) {
        this.tempFilters = new Set(this.activeFilters);
        const grid = document.createElement('div');
        grid.className = 'filter-pills-grid';
        const comparator = this._getTagSortComparator();

        Array.from(this.availableTags)
            .sort(comparator)
            .forEach(tag => {
                const pill = document.createElement('button');
                pill.type = 'button';
                pill.className = 'filter-pill';
                pill.dataset.tag = tag;
                if (this.tempFilters.has(tag)) pill.classList.add('selected');
                const count = this.filterCounts.get(tag) || 0;
                const nameSpan = document.createElement('span');
                nameSpan.className = 'filter-pill-name';
                nameSpan.textContent = tag;
                nameSpan.title = tag;
                const countSpan = document.createElement('span');
                countSpan.className = 'filter-pill-count';
                countSpan.textContent = count;
                pill.appendChild(nameSpan);
                pill.appendChild(countSpan);
                pill.addEventListener('click', () => {
                    pill.classList.toggle('selected');
                    if (pill.classList.contains('selected')) this.tempFilters.add(tag);
                    else this.tempFilters.delete(tag);
                    this.applyFilter();
                    onApplyCallback?.();
                });
                grid.appendChild(pill);
            });

        container.appendChild(grid);
    }

    refreshFilterContent(container) {
        const grid = container?.querySelector('.filter-pills-grid');
        if (!grid) return;
        grid.querySelectorAll('.filter-pill').forEach(pill => {
            const tag = pill.dataset.tag;
            pill.classList.toggle('selected', this.tempFilters.has(tag));
        });
    }

    clearFilter() {
        this.tempFilters.clear();
    }

    applyFilter() {
        this.activeFilters = new Set(this.tempFilters);
    }

    filterBookmarks(bookmarks) {
        if (this.activeFilters.size === 0) return bookmarks;

        return bookmarks.filter(bookmark => {
            return bookmark.tags.some(tag => this.activeFilters.has(tag));
        });
    }
}

// 自定义标签筛选器
class CustomTagFilter extends BookmarkFilter {
    constructor() {
        super();
        this.rules = [];
    }

    async init(bookmarksList) {
        await customFilter.init();
        this.rules = customFilter.getRules();
        await this.updateFilterCounts(bookmarksList);
    }

    getName() {
        return i18n.getMessage('filter_custom_tag_name');
    }

    getIcon() {
        return `<svg viewBox="0 0 24 24" width="16" height="16">
            <path fill="currentColor" opacity="0.1" 
                  d="M3 6v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2h-4.2c-.4-1.2-1.5-2-2.8-2s-2.4.8-2.8 2H5c-1.1 0-2 .9-2 2z"/>
            <path fill="none" stroke="currentColor" stroke-width="1.5" 
                  d="M3 6v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2h-4.2c-.4-1.2-1.5-2-2.8-2s-2.4.8-2.8 2H5c-1.1 0-2 .9-2 2z"/>
            <circle fill="currentColor" opacity="0.3" cx="11" cy="5" r="1"/>
            <path fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" 
                  d="M9 9h6M9 13h6M9 17h6"/>
        </svg>`;
    }

    async updateRules() {
        await customFilter.reloadRules();
        this.rules = customFilter.getRules();
    }

    async updateFilterCounts(bookmarks) {
        this.filterCounts.clear();
        for (const rule of this.rules) {
            const count = (await this.filterBookmarks(bookmarks, [rule.id])).length;
            this.filterCounts.set(rule.id, count);
        }
    }

    renderFilterContent(container, onApplyCallback) {
        this.tempFilters = new Set(this.activeFilters);
        const grid = document.createElement('div');
        grid.className = 'filter-pills-grid';

        this.rules.forEach(rule => {
            const pill = document.createElement('button');
            pill.type = 'button';
            pill.className = 'filter-pill';
            pill.dataset.ruleId = rule.id;
            if (this.tempFilters.has(rule.id)) pill.classList.add('selected');
            const count = this.filterCounts.get(rule.id) || 0;
            const nameSpan = document.createElement('span');
            nameSpan.className = 'filter-pill-name';
            nameSpan.textContent = rule.name;
            nameSpan.title = rule.name;
            const countSpan = document.createElement('span');
            countSpan.className = 'filter-pill-count';
            countSpan.textContent = count;
            pill.appendChild(nameSpan);
            pill.appendChild(countSpan);
            pill.addEventListener('click', () => {
                pill.classList.toggle('selected');
                if (pill.classList.contains('selected')) this.tempFilters.add(rule.id);
                else this.tempFilters.delete(rule.id);
                this.applyFilter();
                onApplyCallback?.();
            });
            grid.appendChild(pill);
        });

        container.appendChild(grid);
    }

    refreshFilterContent(container) {
        const grid = container?.querySelector('.filter-pills-grid');
        if (!grid) return;
        grid.querySelectorAll('.filter-pill').forEach(pill => {
            const ruleId = pill.dataset.ruleId;
            pill.classList.toggle('selected', this.tempFilters.has(ruleId));
        });
    }

    clearFilter() {
        this.tempFilters.clear();
    }

    applyFilter() {
        this.activeFilters = new Set(this.tempFilters);
    }

    async filterBookmarks(bookmarks, specificRules = null) {
        if (this.activeFilters.size === 0 && !specificRules) return bookmarks;

        const filteredBookmarks = [];
        const rulesToCheck = specificRules || this.activeFilters;
        
        for (const bookmark of bookmarks) {
            for (const ruleId of rulesToCheck) {
                const rule = this.rules.find(r => r.id === ruleId);
                if (!rule) continue;

                const matches = await this.evaluateRule(bookmark, rule);
                if (matches) {
                    filteredBookmarks.push(bookmark);
                    break;
                }
            }
        }
        return filteredBookmarks;
    }

    async evaluateRule(bookmark, rule) {
        // 使用 customFilter 的评估逻辑
        return customFilter.evaluateBookmark(bookmark, rule.conditions);
    }

    renderFilterHeader(headerElement) {
        // 先调用父类方法设置基本标题
        super.renderFilterHeader(headerElement);
        
        // 添加编辑按钮
        const editButton = document.createElement('button');
        editButton.className = 'edit-filter-button';
        editButton.title = i18n.getMessage('filter_edit_custom_tag_title');
        editButton.innerHTML = `
            <svg viewBox="0 0 24 24" width="16" height="16">
                <path fill="currentColor" d="M20.71,7.04C21.1,6.65 21.1,6 20.71,5.63L18.37,3.29C18,2.9 17.35,2.9 16.96,3.29L15.12,5.12L18.87,8.87M3,17.25V21H6.75L17.81,9.93L14.06,6.18L3,17.25Z" />
            </svg>
        `;
        editButton.addEventListener('click', () => {
            openOptionsPage('filters');
        });
        headerElement.appendChild(editButton);
    }
}

// 筛选管理器
class FilterManager {
    constructor() {
        this.filters = new Map();
        this.inited = false;
        this.isDirty = false;
    }

    async init() {
        if (this.inited) return;
        this.inited = true;
        await this.initializeFilters();  // 等待初始化完成
        this.setupEventListeners();
        this.setupStorageListener();
    }

    async initializeFilters() {
        // 注册筛选器
        const tagFilter = new TagFilter();
        
        // 注册自定义标签筛选器
        const customTagFilter = new CustomTagFilter();
        
        // 等待所有筛选器初始化完成
        const bookmarks = await getDisplayedBookmarks();
        const bookmarksList = Object.values(bookmarks);
        await Promise.all([
            tagFilter.init(bookmarksList),
            customTagFilter.init(bookmarksList)
        ]);
        
        // 注册筛选器
        this.registerFilter('tag', tagFilter);
        this.registerFilter('custom-tag', customTagFilter);
    }

    registerFilter(id, filter) {
        this.filters.set(id, filter);
    }

    setupEventListeners() {
        const filterButton = document.getElementById('filter-button');
        const filterPanel = document.getElementById('filter-panel');
        const filterCategoriesNav = document.getElementById('filter-categories-nav');
        const filterOptionsArea = document.getElementById('filter-options-area');
        const filterPanelClear = document.getElementById('filter-panel-clear');
        const backdrop = filterPanel?.querySelector('.filter-panel-backdrop');

        // 点击筛选按钮显示/隐藏筛选面板
        filterButton.addEventListener('click', () => {
            this.toggleFilterPanel();
        });

        // 点击遮罩关闭面板
        backdrop?.addEventListener('click', () => this._closeFilterPanel());

        // 底部清除按钮：清除所有筛选并关闭
        filterPanelClear?.addEventListener('click', () => {
            for (const filter of this.filters.values()) {
                filter.clearFilter();
                filter.applyFilter();
            }
            this.applyFiltersAndRefresh();
            this._closeFilterPanel();
        });

        // 渲染左列分类
        this.renderFilterCategories();

        // 默认选中第一个分类并显示其内容
        const firstId = this.filters.keys().next().value;
        if (firstId) this.showFilterContent(firstId);

        // ESC 键关闭筛选面板
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && filterPanel?.classList.contains('show')) {
                e.preventDefault();
                this._closeFilterPanel();
            }
        });
    }

    _closeFilterPanel() {
        const filterPanel = document.getElementById('filter-panel');
        if (!filterPanel) return;
        filterPanel.classList.remove('show');
    }

    setupStorageListener() {
        chrome.storage.onChanged.addListener(async (changes, areaName) => {
            // 如果是本地存储变化
            if (areaName === 'local') {
                // 检查对象的键是否有以 'bookmark.' 开头的
                if (Object.keys(changes).some(key => key.startsWith('bookmark.'))) {
                    await this.onBookmarksChange();
                }
            } 
            // 如果是同步存储变化
            else if (areaName === 'sync') {
                if (changes[customFilter.STORAGE_KEY] || changes[customFilter.STORAGE_KEY_ORDER] || changes[customFilter.STORAGE_KEY_HIDDEN]) {
                    await this.onCustomFilterChange();
                }
            }
        });
    }

    /**
     * 渲染左列筛选分类
     */
    renderFilterCategories() {
        const nav = document.getElementById('filter-categories-nav');
        if (!nav) return;
        nav.innerHTML = '';

        for (const [id, filter] of this.filters) {
            const item = document.createElement('button');
            item.type = 'button';
            item.className = 'filter-category-item';
            item.dataset.filterId = id;
            item.innerHTML = `
                <span class="filter-category-dot" style="display:none"></span>
                <span class="filter-category-text">${filter.getName()}</span>
            `;
            item.addEventListener('click', () => this.showFilterContent(id));
            nav.appendChild(item);
        }
        this._updateFilterOptionsState();
    }

    /**
     * 轻量级更新筛选选项状态（仅更新 active 和 dot 指示，不重建 DOM）
     */
    _updateFilterOptionsState() {
        const nav = document.getElementById('filter-categories-nav');
        if (!nav) return;

        for (const [id, filter] of this.filters) {
            const item = nav.querySelector(`.filter-category-item[data-filter-id="${id}"]`);
            if (!item) continue;

            const count = filter.getActiveFilters().length;
            item.classList.toggle('active', count > 0);

            const dot = item.querySelector('.filter-category-dot');
            if (dot) dot.style.display = count > 0 ? '' : 'none';
        }
    }

    async toggleFilterPanel() {
        const panel = document.getElementById('filter-panel');
        if (!panel) return;
        panel.classList.toggle('show');
        if (panel.classList.contains('show')) {
            await this.updateFilterCounts();
            // 刷新右列内容，确保显示最新数据
            const current = document.querySelector('.filter-category-item.menu-open');
            const filterId = current?.dataset.filterId || this.filters.keys().next().value;
            if (filterId) this.showFilterContent(filterId);
        }
    }

    async onBookmarksChange() {
        logger.debug('filterManager onBookmarksChange');
        this.isDirty = true;
    }

    async updateFilterCounts() {
        if (!this.isDirty) return;
        this.isDirty = false;

        const bookmarks = await getDisplayedBookmarks();
        const bookmarksList = Object.values(bookmarks);
        
        // 更新所有筛选器的计数
        for (const filter of this.filters.values()) {
            if (filter instanceof TagFilter) {
                filter.updateAvailableTags(bookmarksList);
            }
            await filter.updateFilterCounts(bookmarksList);
        }
    }

    async onCustomFilterChange() {
        logger.debug('filterManager onCustomFilterChange');
        
        for (const filter of this.filters.values()) {
            if (filter instanceof CustomTagFilter) {
                await filter.updateRules();
                const bookmarks = await getDisplayedBookmarks();
                const bookmarksList = Object.values(bookmarks);
                await filter.updateFilterCounts(bookmarksList);

                const viewMode = await SettingsManager.get('display.viewMode');
                if (viewMode === 'group') {
                    await renderBookmarksList();
                }
            }
        }
    }

    /**
     * 切换右列内容为指定筛选分类
     */
    showFilterContent(filterId) {
        const filter = this.filters.get(filterId);
        if (!filter) return;

        const nav = document.getElementById('filter-categories-nav');
        const optionsArea = document.getElementById('filter-options-area');
        if (!nav || !optionsArea) return;

        // 左列：高亮当前分类
        nav.querySelectorAll('.filter-category-item').forEach(item => {
            item.classList.toggle('menu-open', item.dataset.filterId === filterId);
        });

        // 右列：清空并渲染当前分类的筛选项（pill 样式）
        optionsArea.innerHTML = '';
        const content = document.createElement('div');
        content.className = 'filter-options-content';
        const header = document.createElement('div');
        header.className = 'filter-options-header';
        const title = document.createElement('span');
        title.className = 'filter-options-title';
        title.textContent = filter.getName();
        header.appendChild(title);
        const headerRight = document.createElement('div');
        headerRight.className = 'filter-options-header-right';
        if (filter instanceof TagFilter) {
            const sortSelect = document.createElement('select');
            sortSelect.className = 'filter-tag-sort-select';
            sortSelect.title = i18n.getMessage('filter_tag_sort_count');
            ['count', 'name', 'selected'].forEach(mode => {
                const opt = document.createElement('option');
                opt.value = mode;
                opt.textContent = mode === 'count' ? i18n.getMessage('filter_tag_sort_count')
                    : mode === 'name' ? i18n.getMessage('filter_tag_sort_name')
                    : i18n.getMessage('filter_tag_sort_selected');
                sortSelect.appendChild(opt);
            });
            sortSelect.value = filter.sortMode;
            sortSelect.addEventListener('change', () => {
                filter.sortMode = sortSelect.value;
                pillsWrap.innerHTML = '';
                filter.renderFilterContent(pillsWrap, () => this.applyFiltersAndRefresh());
            });
            headerRight.appendChild(sortSelect);
        } else if (filter instanceof CustomTagFilter) {
            const editBtn = document.createElement('button');
            editBtn.type = 'button';
            editBtn.className = 'filter-options-edit';
            editBtn.title = i18n.getMessage('filter_edit_custom_tag_title');
            editBtn.innerHTML = `<svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M20.71,7.04C21.1,6.65 21.1,6 20.71,5.63L18.37,3.29C18,2.9 17.35,2.9 16.96,3.29L15.12,5.12L18.87,8.87M3,17.25V21H6.75L17.81,9.93L14.06,6.18L3,17.25Z"/></svg>`;
            editBtn.addEventListener('click', () => openOptionsPage('filters'));
            headerRight.appendChild(editBtn);
        }
        header.appendChild(headerRight);
        content.appendChild(header);
        const pillsWrap = document.createElement('div');
        pillsWrap.className = 'filter-pills-wrap';
        content.appendChild(pillsWrap);
        optionsArea.appendChild(content);

        const onApplyCallback = () => {
            this.applyFiltersAndRefresh();
            // 选中优先模式下，选择变化后需重新排序
            if (filter instanceof TagFilter && filter.sortMode === 'selected') {
                pillsWrap.innerHTML = '';
                filter.renderFilterContent(pillsWrap, onApplyCallback);
            }
        };
        filter.renderFilterContent(pillsWrap, onApplyCallback);
    }

    /**
     * 应用所有筛选器并刷新列表（按「与」逻辑：多个筛选条件同时生效）
     * 使用防抖避免连续点击时多次全量渲染，并保留滚动位置
     */
    applyFiltersAndRefresh() {
        const DEBOUNCE_MS = 80;
        if (this._filterRefreshTimer) clearTimeout(this._filterRefreshTimer);

        this._filterRefreshTimer = setTimeout(async () => {
            this._filterRefreshTimer = null;
            await renderBookmarksList({ preserveScroll: true });
            this._updateFilterUI();
        }, DEBOUNCE_MS);
    }

    _updateFilterUI() {
        const filterButton = document.getElementById('filter-button');
        const hasActiveFilters = Array.from(this.filters.values()).some(
            filter => filter.getActiveFilters().length > 0
        );
        filterButton.classList.toggle('active', hasActiveFilters);
        // 轻量级更新，复用现有 DOM，不重建筛选菜单
        this._updateFilterOptionsState();
    }

    async getFilteredBookmarks() {
        // 获取所有书签
        const bookmarks = await getDisplayedBookmarks();
        let filteredBookmarks = Object.values(bookmarks);
        
        // 按「与」逻辑依次应用所有有选中项的筛选器
        for (const filter of this.filters.values()) {
            if (filter.getActiveFilters().length > 0) {
                filteredBookmarks = await filter.filterBookmarks(filteredBookmarks);
            }
        }
        
        return filteredBookmarks;
    }

    toggleDisplayFilter(display) {
        const filterContainer = document.querySelector('.filter-container');
        if (filterContainer) {
            filterContainer.style.display = display ? 'block' : 'none';
        }
    }
}

// 导出筛选管理器实例
const filterManager = new FilterManager(); 