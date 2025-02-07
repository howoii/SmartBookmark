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
    }

    async init(bookmarksList) {
        this.updateAvailableTags(bookmarksList);
        await this.updateFilterCounts(bookmarksList);
    }

    getName() {
        return '标签';
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
        logger.debug('updateAvailableTags', {
            availableTags: Array.from(this.availableTags)
        });
    }

    async updateFilterCounts(bookmarks) {
        this.filterCounts.clear();
        bookmarks.forEach(bookmark => {
            bookmark.tags.forEach(tag => {
                this.filterCounts.set(tag, (this.filterCounts.get(tag) || 0) + 1);
            });
        });
    }

    renderFilterContent(container) {
        this.tempFilters = new Set(this.activeFilters);
        const tagList = document.createElement('div');
        tagList.className = 'filter-list';
        
        Array.from(this.availableTags)
            .sort((a, b) => {
                const countDiff = (this.filterCounts.get(b) || 0) - (this.filterCounts.get(a) || 0);
                if (countDiff === 0) {
                    return a.localeCompare(b, 'zh-CN');
                }
                return countDiff;
            })
            .forEach(tag => {
            const tagItem = document.createElement('div');
            tagItem.className = 'filter-item';
            if (this.tempFilters.has(tag)) {
                tagItem.classList.add('selected');
            }
            tagItem.innerHTML = `
                <span class="filter-name">${tag}</span>
                <span class="filter-count">${this.filterCounts.get(tag) || 0}</span>
            `;
            
            tagItem.addEventListener('click', () => {
                tagItem.classList.toggle('selected');
                if (tagItem.classList.contains('selected')) {
                    this.tempFilters.add(tag);
                } else {
                    this.tempFilters.delete(tag);
                }
            });
            
            tagList.appendChild(tagItem);
        });
        
        container.appendChild(tagList);
    }

    refreshFilterContent(container) {
        const tagList = container?.querySelector('.filter-list');
        if (!tagList) return;
        
        // 更新每个标签的选中状态
        tagList.querySelectorAll('.filter-item').forEach(tagItem => {
            const tag = tagItem.textContent;
            tagItem.classList.toggle('selected', this.tempFilters.has(tag));
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
        return '自定义标签';
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

    renderFilterContent(container) {
        this.tempFilters = new Set(this.activeFilters);
        const rulesList = document.createElement('div');
        rulesList.className = 'filter-list';
        
        this.rules.forEach(rule => {
            const ruleItem = document.createElement('div');
            ruleItem.className = 'filter-item';
            if (this.tempFilters.has(rule.id)) {
                ruleItem.classList.add('selected');
            }
            
            const ruleName = document.createElement('span');
            ruleName.className = 'filter-name';
            ruleName.textContent = rule.name;
            
            // 添加数量显示
            const count = document.createElement('span');
            count.className = 'filter-count';
            count.textContent = this.filterCounts.get(rule.id) || 0;
            
            ruleItem.appendChild(ruleName);
            ruleItem.appendChild(count);
            
            // 点击选择事件
            ruleItem.addEventListener('click', () => {
                ruleItem.classList.toggle('selected');
                if (ruleItem.classList.contains('selected')) {
                    this.tempFilters.add(rule.id);
                } else {
                    this.tempFilters.delete(rule.id);
                }
            });
            
            rulesList.appendChild(ruleItem);
        });
        
        container.appendChild(rulesList);
    }

    refreshFilterContent(container) {
        const rulesList = container?.querySelector('.filter-list');
        if (!rulesList) return;
        
        rulesList.querySelectorAll('.filter-item').forEach(ruleItem => {
            const ruleName = ruleItem.querySelector('.filter-name').textContent;
            const rule = this.rules.find(r => r.name === ruleName);
            if (rule) {
                ruleItem.classList.toggle('selected', this.tempFilters.has(rule.id));
            }
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
        editButton.title = '编辑自定义标签';
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
        this.activeFilter = null;
        this.activeFilterId = null;  // 添加当前激活的筛选器ID
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
        const filterDropdown = document.getElementById('filter-dropdown');
        
        // 点击筛选按钮显示下拉菜单
        filterButton.addEventListener('click', () => {
            this.toggleFilterDropdown();
        });

        // 渲染筛选选项
        this.renderFilterOptions();

        // 点击其他地方关闭下拉菜单
        document.addEventListener('click', (e) => {
            if (!filterButton.contains(e.target) && !filterDropdown.contains(e.target)) {
                filterDropdown.classList.remove('show');
                // 同时关闭筛选菜单
                const existingMenu = filterDropdown.querySelector('.filter-menu');
                if (existingMenu) {
                    filterDropdown.removeChild(existingMenu);
                }
            }
        });
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
                if (changes[SettingsManager.SETTINGS_KEY]) {
                    const settings = changes[SettingsManager.SETTINGS_KEY];
                    const oldValue = settings.oldValue?.display?.showChromeBookmarks;
                    const newValue = settings.newValue?.display?.showChromeBookmarks;
                    if (oldValue !== newValue) {
                        await this.onBookmarksChange();
                    }
                }
                if (changes[customFilter.STORAGE_KEY] || changes[customFilter.STORAGE_KEY_ORDER]) {
                    await this.onCustomFilterChange();
                }
            }
        });
    }

    renderFilterOptions() {
        const dropdown = document.getElementById('filter-dropdown');
        dropdown.innerHTML = '';
        
        for (const [id, filter] of this.filters) {
            const option = document.createElement('div');
            option.className = 'filter-option';
            // 添加激活状态的类
            if (id === this.activeFilterId && filter.getActiveFilters().length > 0) {
                option.classList.add('active');
            }
            
            option.innerHTML = `
                ${filter.getIcon()}
                <span>${filter.getName()}</span>
                ${filter.getActiveFilters().length > 0 ? 
                    `<span class="filter-badge">${filter.getActiveFilters().length}</span>` : 
                    ''}
            `;
            
            // 使用 mouseenter 事件替代 click 事件
            option.addEventListener('mouseenter', () => {
                this.showFilterMenu(id);
            });
            
            dropdown.appendChild(option);
        }
    }

    toggleFilterDropdown() {
        const dropdown = document.getElementById('filter-dropdown');
        dropdown.classList.toggle('show');
        this.updateFilterCounts();
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

    async showFilterMenu(filterId) {
        const filter = this.filters.get(filterId);
        if (!filter) return;

        const dropdown = document.getElementById('filter-dropdown');
        
        // 先移除所有已存在的筛选菜单
        const existingMenu = dropdown.querySelector('.filter-menu');
        if (existingMenu) {
            if (existingMenu.dataset.filterId === filterId) {
                return;
            }
            dropdown.removeChild(existingMenu);
        }

        const template = document.getElementById('filter-menu-template');
        const menu = template.content.cloneNode(true).querySelector('.filter-menu');
        menu.dataset.filterId = filterId;
        
        // 渲染标题栏
        const header = menu.querySelector('.filter-menu-header');
        filter.renderFilterHeader(header);
        
        // 渲染筛选内容
        const content = menu.querySelector('.filter-menu-content');
        filter.renderFilterContent(content);

        const doClose = () => {
            if (dropdown.contains(menu)) {
                dropdown.removeChild(menu);
            }
        };
        
        // 设置按钮事件
        menu.querySelector('#apply-filter').addEventListener('click', () => {
            this.applyFilter(filterId);
            doClose();
            dropdown.classList.remove('show'); // 应用后关闭整个下拉菜单
        });
        
        menu.querySelector('#clear-filter').addEventListener('click', () => {
            filter.clearFilter();
            filter.refreshFilterContent(content);
        });
        
        // 将菜单添加到下拉菜单中
        dropdown.appendChild(menu);
        menu.classList.add('show');
    }

    async applyFilter(filterId) {
        const filter = this.filters.get(filterId);
        if (!filter) return;
        
        // 清除其他筛选器的选择
        for (const [id, otherFilter] of this.filters) {
            if (id !== filterId) {
                otherFilter.clearFilter();
                otherFilter.applyFilter();
            }
        }
        
        filter.applyFilter();
        this.activeFilter = filter;
        this.activeFilterId = filterId;
        
        await renderBookmarksList();
        
        // 更新筛选按钮状态
        const filterButton = document.getElementById('filter-button');
        if (filter.getActiveFilters().length > 0) {
            filterButton.classList.add('active');
        } else {
            filterButton.classList.remove('active');
            this.activeFilterId = null;
        }
        
        // 更新下拉菜单选项的显示状态
        this.renderFilterOptions();
    }

    async getFilteredBookmarks() {
        // 获取所有书签
        const bookmarks = await getDisplayedBookmarks();
        // 应用筛选
        let filteredBookmarks = Object.values(bookmarks);
        if (this.activeFilter) {
            filteredBookmarks = this.activeFilter.filterBookmarks(filteredBookmarks);
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