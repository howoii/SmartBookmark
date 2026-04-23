EnvIdentifier = 'quickSave';

class QuickSaveManager {
    constructor() {
        // DOM 元素
        this.elements = {
            pageTitle: document.querySelector('.page-title'),
            pageUrl: document.querySelector('.page-url'),
            pageExcerpt: document.getElementById('page-excerpt'),
            pageFavicon: document.querySelector('.page-favicon img'),
            tagsList: document.getElementById('tags-list'),
            newTagInput: document.getElementById('new-tag-input'),
            saveTagsBtn: document.getElementById('save-tags-btn'),
            cancelTagsBtn: document.getElementById('cancel-tags-btn'),
            deleteBookmarkBtn: document.getElementById('delete-bookmark-btn'),
            status: document.getElementById('status'),
            dialogContent: document.querySelector('.dialog-content'),
            charCount: document.getElementById('char-count'),
            charCounter: document.querySelector('.char-counter'),
            generateTagsBtn: document.getElementById('generate-tags-btn'),
            generateExcerptBtn: document.getElementById('generate-excerpt-btn'),
            translateTitleBtn: document.getElementById('translate-title-btn'),
            browserBookmarkSelector: document.getElementById('browser-bookmark-selector')
        };

        this.currentTab = null;
        this.pageContent = null;
        this.isEditMode = false;
        this.editingBookmark = null;
        this.statusTimeout = null;
        this.originalUrl = null;
        this.tagRequest = null;
        this.excerptRequest = null;
        this.translateRequest = null;
        this.originalTitle = null; // 保存原始标题
        this.hasTranslated = false; // 标记是否已翻译
        this.browserBookmarkSavePreference = BrowserBookmarkSelector.normalizePreference({}, { directoryOnly: true });
        this.browserBookmarkSelector = null;

        this.init();
    }

    async init() {
        try {
            // 获取当前标签页信息
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            if (!tab) {
                throw new Error(i18n.M('msg_error_quary_tab'));
            }

            this.currentTab = tab;
            this.originalUrl = tab.url;

            // 检查页面是否加载完成
            if (tab.status !== 'complete') {
                logger.debug('页面正在加载中，不访问页面内容', tab);
                if (!tab.title || !tab.url) {
                    this.showStatus(i18n.M('msg_status_page_loading'), 'warning', true);
                    this.hideMainContent();
                    return;
                }
            }

            // 检查是否是不可标记的URL
            if (isNonMarkableUrl(tab.url)) {
                this.showStatus(i18n.M('msg_status_page_unsupported'), 'error', true);
                this.hideMainContent();
                return;
            }
            
            // 设置基本页面信息
            await this.setupPageInfo();

            await this.setupBrowserBookmarkSelector();

            // 先检查是否已保存，这会设置 isEditMode
            await this.checkSavedState();
            
            // 获取页面内容并处理标签
            await this.setupPageContentAndTags();
            
            // 设置事件监听
            this.setupEventListeners();
            if (!this.isEditMode) {
                void this.browserBookmarkSelector?.autoRecommend();
            }
        } catch (error) {
            logger.error('初始化失败:', error);
            this.showStatus(i18n.M('msg_error_init_failed', [error.message]), 'error', true);
            this.hideMainContent();
        }
    }

    async setupBrowserBookmarkSelector() {
        const savedPreference = await SettingsManager.get('display.browserBookmarkSave');
        const preference = await BrowserBookmarkSelector.resolvePreferenceInCurrentBrowser(savedPreference || {}, {
            directoryOnly: true
        });

        this.browserBookmarkSavePreference = preference;

        this.browserBookmarkSelector = new BrowserBookmarkSelector({
            root: this.elements.browserBookmarkSelector,
            directoryOnly: true,
            recommendationProvider: () => this.getRecommendedFolders(),
            ...this.browserBookmarkSavePreference
        });
    }

    async getRecommendedFolders() {
        if (this.editingBookmark?.chromeId) return [];

        try {
            const url = this.getEditedUrl();
            let embedding = null;
            if (url) {
                const stored = await LocalStorageMgr.getBookmark(url, true);
                embedding = stored?.embedding || null;
            }
            const bookmarkInfo = {
                url,
                title: this.elements.pageTitle.textContent.trim(),
                tags: this.getCurrentTags(),
                excerpt: this.getEditedExcerpt(),
                embedding,
            };
            return await FolderRecommender.recommend(bookmarkInfo);
        } catch (error) {
            logger.error('获取推荐目录失败:', error);
            return [];
        }
    }

    async resolveChromeBookmarkTarget(chromeId) {
        if (!chromeId) return null;

        const [node] = await chrome.bookmarks.get(chromeId);
        if (!node) return null;
        return BrowserBookmarkSelector.buildTargetFromBookmarkNode(node);
    }

    async syncBrowserBookmarkSelectorState() {
        if (!this.browserBookmarkSelector) return;

        if (this.editingBookmark?.chromeId) {
            const lockedTarget = await this.resolveChromeBookmarkTarget(this.editingBookmark.chromeId);
            this.browserBookmarkSelector.setValue({
                mode: BrowserBookmarkSaveMode.BROWSER,
                target: lockedTarget
            });
            this.browserBookmarkSelector.setLockMode(true, '');
            return;
        }

        this.browserBookmarkSelector.setLockMode(false, '');
        this.browserBookmarkSelector.setValue(this.browserBookmarkSavePreference);
    }

    async persistBrowserBookmarkPreference(preferredValue = null) {
        if (!this.browserBookmarkSelector) {
            return;
        }

        const sourceValue = preferredValue ?? this.browserBookmarkSelector.getValue();
        const value = await BrowserBookmarkSelector.resolvePreferenceInCurrentBrowser(
            sourceValue,
            { directoryOnly: true }
        );
        this.browserBookmarkSelector.setValue(value);
        await BrowserBookmarkSelector.savePreference(value);
        this.browserBookmarkSavePreference = BrowserBookmarkSelector.normalizePreference(value, {
            directoryOnly: true
        });
    }

    async resolveBrowserBookmarkSaveForSubmit() {
        if (!this.browserBookmarkSelector) {
            return BrowserBookmarkSelector.buildPreferencePayload(BrowserBookmarkSaveMode.NONE, null);
        }

        const preference = await BrowserBookmarkSelector.resolvePreferenceInCurrentBrowser(
            this.browserBookmarkSelector.getValue(),
            { directoryOnly: true }
        );

        if (
            this.isEditMode &&
            this.editingBookmark?.chromeId &&
            this.browserBookmarkSelector.directoryOnly &&
            this.browserBookmarkSelector.lockMode
        ) {
            const lockedTarget = await this.resolveChromeBookmarkTarget(this.editingBookmark.chromeId);
            if (lockedTarget?.folderId !== preference.target?.folderId) {
                return preference;
            }
            return await BrowserBookmarkSelector.resolvePreferenceInCurrentBrowser({
                mode: BrowserBookmarkSaveMode.BROWSER,
                target: lockedTarget
            });
        }

        return preference;
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
        // 将文字内容包裹在 span 中，以便 CSS 选择器正确匹配
        let html = `<span class="status-text">${message}</span>`;
        if (showClose) {
            html += `
                <button class="close-status" data-i18n-title="ui_button_close">
                    <svg viewBox="0 0 24 24" width="16" height="16">
                        <path fill="currentColor" d="M19,6.41L17.59,5L12,10.59L6.41,5L5,6.41L10.59,12L5,17.59L6.41,19L12,13.41L17.59,19L19,17.59L13.41,12L19,6.41Z" />
                    </svg>
                </button>
            `;
        }
        status.innerHTML = html;
        i18n.updateNodeText(status);

        // 如果不显示关闭按钮，1秒后自动隐藏
        if (!showClose) {
            this.statusTimeout = setTimeout(() => {
                this.hideStatus();
            }, 1000);
        }

        // 添加关闭按钮事件
        const closeBtn = status.querySelector('.close-status');
        if (closeBtn) {
            closeBtn.addEventListener('click', () => {
                this.hideStatus();
                window.close();
            });
        }
    }

    hideStatus() {
        const { status } = this.elements;
        status.classList.remove('show', 'error', 'warning', 'success');
        status.innerHTML = '';
        // 当状态消息隐藏时，恢复主要内容
        this.showMainContent();
    }

    hideMainContent() {
        const { dialogContent } = this.elements;
        dialogContent.classList.add('status-only');
    }

    showMainContent() {
        const { dialogContent } = this.elements;
        dialogContent.classList.remove('status-only');
    }

    async setupPageInfo() {
        const { pageTitle, pageUrl, pageFavicon } = this.elements;
        const { title, url } = this.currentTab;

        // 保存原始标题
        this.originalTitle = title || '';
        this.hasTranslated = false; // 重置翻译标记

        // 设置页面信息
        pageTitle.textContent = title || '';
        pageTitle.title = title || '';
        pageUrl.textContent = url || '';
        pageUrl.title = url || '';

        // 设置网站图标
        const faviconUrl = await getFaviconUrl(url);
        pageFavicon.src = faviconUrl;
        pageFavicon.onerror = () => {
            pageFavicon.src = 'icons/default_favicon.png';
        };
    }

    showTagsLoading() {
        const { tagsList } = this.elements;
        tagsList.innerHTML = `
            <div class="loading-spinner"></div>
            <span data-i18n="ui_label_tags_loading">正在生成标签...</span>
        `;
        tagsList.classList.add('loading');
        i18n.updateNodeText(tagsList);
    }

    hideTagsLoading() {
        const { tagsList } = this.elements;
        tagsList.classList.remove('loading');
        tagsList.innerHTML = '';
    }

    setGenerateTagsButtonLoading(isLoading) {
        const { generateTagsBtn } = this.elements;
        if (!generateTagsBtn) return;

        generateTagsBtn.classList.toggle('loading', isLoading);
        generateTagsBtn.title = i18n.getMessage(isLoading ? 'quicksave_cancel_generate' : 'quicksave_generate_tags_title');
    }

    async generateTagsForCurrentPage({ useCache = false, interactive = false } = {}) {
        if (!this.currentTab) return;

        if (!interactive) {
            const autoGenerate = await SettingsManager.get('ai.autoGenerateTags');
            if (autoGenerate === false) {
                this.renderTags([]);
                return;
            }
        }

        const unclassifiedTag = i18n.M('ui_tag_unclassified');
        const previousTags = this.getCurrentTags();

        if (useCache) {
            const cachedTags = await LocalStorageMgr.getTags(this.currentTab.url);
            if (cachedTags && cachedTags.length > 0) {
                logger.debug('使用缓存的标签:', cachedTags);
                this.renderTags(cachedTags);
                return;
            }
        }

        // 手动生成：未配置时直接提示并返回，不进入标签区 loading
        if (interactive) {
            try {
                await checkAPIKeyValid('chat');
            } catch (error) {
                this.showStatus(`${error.message}`, 'error');
                return;
            }
        } else {
            try {
                await checkAPIKeyValid('chat');
            } catch {
                this.renderTags([unclassifiedTag]);
                return;
            }
        }

        this.showTagsLoading();
        this.setGenerateTagsButtonLoading(true);

        try {
            this.tagRequest = requestManager.create('generate_tags');
            const tags = await generateTags(this.pageContent, this.currentTab, this.tagRequest.signal);
            logger.debug('生成标签:', tags);

            if (tags && tags.length > 0) {
                this.renderTags(tags);
                await LocalStorageMgr.setTags(this.currentTab.url, tags);
                logger.debug('缓存标签:', tags);
            } else {
                this.renderTags([unclassifiedTag]);
            }
        } catch (error) {
            logger.error('生成标签失败:', error);
            if (isUserCanceledError(error)) {
                this.showStatus(i18n.getMessage('quicksave_status_generate_canceled'), 'success');
                this.renderTags(previousTags);
                return;
            }
            if (interactive) {
                this.showStatus(`${error.message}`, 'error');
            }
            this.renderTags([unclassifiedTag]);
        } finally {
            this.setGenerateTagsButtonLoading(false);
            if (this.tagRequest) {
                this.tagRequest.done();
                this.tagRequest = null;
            }
        }
    }

    async setupPageContentAndTags() {
        try {
            if (this.currentTab.status !== 'complete') {
                this.pageContent = {};  
                logger.debug('页面正在加载中，不访问页面内容', this.currentTab);
            } else {
                // 使用 getPageContent 获取页面内容
                this.pageContent = await getPageContent(this.currentTab);
                logger.debug("获取页面内容", {
                    tab: this.currentTab,
                    pageContent: this.pageContent,
                    isEditMode: this.isEditMode
                });
            }

            // 设置页面摘要
            if (this.isEditMode) {
                this.renderPageExcerpt(this.editingBookmark?.excerpt?.trim());
            } else {
                this.renderPageExcerpt(this.pageContent.excerpt?.trim());
            }

            // 如果不是编辑模式，生成并显示标签
            if (this.isEditMode) {
                this.renderTags(this.editingBookmark?.tags);
            } else {
                await this.generateTagsForCurrentPage({ useCache: true });
            }
        } catch (error) {
            logger.error('获取页面内容失败:', error);
            if (!this.isEditMode) {
                this.renderTags([i18n.M('ui_tag_unclassified')]);
            }
        }
    }

    async checkSavedState() {
        const isSaved = await checkIfPageSaved(this.currentTab.url);
        if (isSaved) {
            const bookmarks = await getAllBookmarks(false);
            const bookmark = bookmarks[this.currentTab.url] || Object.values(bookmarks).find(b => b.url === this.currentTab.url);
            if (bookmark) {
                this.isEditMode = true;
                this.editingBookmark = bookmark;
                this.originalTitle = bookmark.title;
                this.hasTranslated = false;
                this.elements.pageTitle.textContent = bookmark.title;
                this.elements.pageUrl.contentEditable = "true";
                this.elements.pageUrl.classList.add("editable");
                this.elements.deleteBookmarkBtn.style.display = 'flex';
                await this.syncBrowserBookmarkSelectorState();
                return;
            }
        }
        this.elements.pageUrl.contentEditable = "true";
        this.elements.pageUrl.classList.add("editable");
        this.elements.deleteBookmarkBtn.style.display = 'none';
        await this.syncBrowserBookmarkSelectorState();
    }

    setupEventListeners() {
        const { pageTitle, pageUrl, tagsList, newTagInput, saveTagsBtn, cancelTagsBtn, deleteBookmarkBtn, pageExcerpt, generateTagsBtn, generateExcerptBtn, translateTitleBtn } = this.elements;

        document.addEventListener('keydown', (e) => {
            this.handleDocumentEscape(e);
        }, true);

        pageTitle.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                pageTitle.blur();
            }
        });

        // 监听撤销快捷键（只在翻译后支持）
        pageTitle.addEventListener('keydown', (e) => {
            // Escape 键：还原标题并失去焦点
            if (e.key === 'Escape') {
                e.preventDefault();
                e.stopPropagation();
                pageTitle.textContent = pageTitle.dataset.originalTitle;
                pageTitle.blur();
            }
            // Ctrl+Z 或 Cmd+Z（Mac）
            else if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
                // 只在已翻译且未修改的情况下支持撤销
                if (this.hasTranslated && this.originalTitle) {
                    const currentText = pageTitle.textContent.trim();
                    // 如果当前内容不等于原始标题，说明可以撤销
                    if (currentText !== this.originalTitle) {
                        e.preventDefault();
                        e.stopPropagation();
                        // 恢复原始标题
                        pageTitle.textContent = this.originalTitle;
                        pageTitle.title = this.originalTitle;
                        this.hasTranslated = false; // 清除翻译标记
                        return false;
                    }
                }
            }
        });

        // 监听用户输入，如果用户手动编辑了，清除翻译标记
        pageTitle.addEventListener('input', () => {
            // 用户手动编辑时，清除翻译标记，不再支持撤销
            if (this.hasTranslated) {
                const currentText = pageTitle.textContent.trim();
                // 如果内容与原始标题不同，说明用户编辑了
                if (currentText !== this.originalTitle) {
                    this.hasTranslated = false;
                }
            }
        });

        // 监听标题编辑状态，控制翻译按钮显示
        pageTitle.addEventListener('focus', () => {
            // 保存聚焦时的内容，用于失去焦点时还原
            pageTitle.dataset.originalTitle = pageTitle.textContent;
            if (translateTitleBtn) {
                translateTitleBtn.style.display = 'flex';
            }
        });

        pageTitle.addEventListener('blur', (e) => {
            logger.debug('标题失去焦点', e);
            const newTitle = pageTitle.textContent.trim();
            // 如果内容为空，还原到聚焦时的内容
            if (!newTitle) {
                pageTitle.textContent = pageTitle.dataset.originalTitle;
            }
            // 如果失去焦点是因为点击了翻译按钮，则保持焦点
            if (translateTitleBtn && e.relatedTarget === translateTitleBtn) {
                // 延迟恢复焦点，避免与按钮点击冲突
                setTimeout(() => {
                    if (document.activeElement !== pageTitle) {
                        pageTitle.focus();
                    }
                }, 0);
                return;
            }
            // 延迟隐藏，给按钮点击事件时间执行
            setTimeout(() => {
                if (document.activeElement !== pageTitle && document.activeElement !== translateTitleBtn) {
                    if (translateTitleBtn) {
                        translateTitleBtn.style.display = 'none';
                    }
                }
            }, 100);
        });

        // 翻译按钮点击事件 - 使用 mousedown 避免失去焦点
        if (translateTitleBtn) {
            translateTitleBtn.addEventListener('mousedown', (e) => {
                e.preventDefault(); // 阻止默认行为，避免失去焦点
                e.stopPropagation(); // 阻止事件冒泡
                this.translateTitle();
            });
        }

        pageUrl.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                pageUrl.blur();
            }
        });

        pageUrl.addEventListener('blur', () => {
            this.validateUrl();
        });

        tagsList.addEventListener('click', (e) => {
            if (e.target.closest('.clear-all-tags-btn')) {
                this.renderTags([]);
            } else if (e.target.classList.contains('remove-tag-btn')) {
                const tagElement = e.target.parentElement;
                tagElement.remove();
                if (this.getCurrentTags().length === 0) {
                    this.renderTags([]);
                }
            } else if (e.target.classList.contains('tag-text')) {
                const tagText = e.target.textContent.trim();
                if (newTagInput && tagText) {
                    newTagInput.value = tagText;
                    newTagInput.focus();
                }
            }
        });

        // 新标签输入事件
        newTagInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                this.addNewTag(newTagInput.value.trim());
            }
        });

        if (generateTagsBtn) {
            generateTagsBtn.addEventListener('click', async () => {
                if (generateTagsBtn.classList.contains('loading')) {
                    if (this.tagRequest) {
                        this.tagRequest.abort();
                        this.tagRequest = null;
                    }
                    return;
                }
                await this.generateTagsForCurrentPage({ useCache: false, interactive: true });
            });
        }

        // 取消按钮点击事件
        cancelTagsBtn.addEventListener('click', () => window.close());

        // 保存按钮点击事件
        saveTagsBtn.addEventListener('click', () => this.handleSave());

        // 删除按钮点击事件
        deleteBookmarkBtn.addEventListener('click', () => this.handleDelete());

        // 添加摘要文本域事件监听
        if (pageExcerpt) {
            // 输入事件 - 更新字符计数和调整高度
            pageExcerpt.addEventListener('input', () => {
                this.adjustTextareaHeight(pageExcerpt);
                this.updateCharCount(pageExcerpt);
            });
        }
        
        // 添加AI生成摘要按钮点击事件
        if (generateExcerptBtn) {
            generateExcerptBtn.addEventListener('click', () => this.generateExcerpt());
        }
    }

    handleDocumentEscape(event) {
        return Boolean(this.browserBookmarkSelector?.consumeEscapeKey?.(event));
    }

    renderTags(tags) {
        const { tagsList } = this.elements;
        tagsList.classList.remove('loading');
        tagsList.innerHTML = '';
        tags.forEach(tag => {
            const tagElement = document.createElement('span');
            tagElement.className = 'tag';
            tagElement.innerHTML = `
                <span class="tag-text">${tag}</span>
                <button class="remove-tag-btn">×</button>
            `;
            tagsList.appendChild(tagElement);
        });

        if (tags.length > 0) {
            const clearBtn = document.createElement('button');
            clearBtn.className = 'clear-all-tags-btn';
            clearBtn.title = i18n.getMessage('ui_tags_clear_all_title');
            clearBtn.innerHTML = `<svg viewBox="0 0 24 24" width="12" height="12"><path fill="currentColor" d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>${i18n.getMessage('ui_tags_clear_all')}`;
            tagsList.appendChild(clearBtn);
        }
    }

    renderPageExcerpt(excerpt) {
        if (excerpt) {
            this.elements.pageExcerpt.value = excerpt;
        } else {
            this.elements.pageExcerpt.value = '';
            this.elements.pageExcerpt.placeholder = i18n.getMessage('quicksave_excerpt_placeholder');
        }
        requestAnimationFrame(() => {
            this.adjustTextareaHeight(this.elements.pageExcerpt);
            this.updateCharCount(this.elements.pageExcerpt);
        });
    }

    getCurrentTags() {
        const tagElements = this.elements.tagsList.querySelectorAll('.tag-text');
        return Array.from(tagElements).map(el => el.textContent.trim());
    }

    addNewTag(tag) {
        if (!tag) return;
        
        const currentTags = this.getCurrentTags();
        if (!currentTags.includes(tag)) {
            this.renderTags([...currentTags, tag]);
            this.elements.newTagInput.value = '';
        } else {
            this.showStatus(i18n.getMessage('quicksave_error_tag_exists'), 'error');
        }
    }

    // 验证URL格式
    validateUrl() {
        const { pageUrl } = this.elements;
        let url = pageUrl.textContent.trim();
        
        try {
            // 尝试创建URL对象以验证格式
            new URL(url);
            // URL有效，不需要更改
        } catch (error) {
            // URL无效，恢复原始URL
            this.showStatus(i18n.getMessage('quicksave_error_url_invalid'), 'error');
            pageUrl.textContent = this.originalUrl;
        }
    }

    getEditedUrl() {
        const { pageUrl } = this.elements;
        let url = pageUrl.textContent.trim();
        try {
            new URL(url);
            return url;
        } catch (error) {
            return this.currentTab?.url;
        }
    }

    async handleSave() {
        if (!this.currentTab) return;
        
        const { saveTagsBtn, pageTitle } = this.elements;
        const tags = this.getCurrentTags();
        
        saveTagsBtn.disabled = true;
        
        try {
            this.showStatus(i18n.M('msg_status_saving_bookmark'), 'success');
            
            const title = pageTitle.textContent.trim();
            const url = this.getEditedUrl();
            const excerpt = this.getEditedExcerpt();

            // 验证URL
            try {
                new URL(url);
            } catch (error) {
                throw new Error(i18n.getMessage('quicksave_error_url_invalid'));
            }
            
            const savedAt = this.isEditMode && this.editingBookmark ? this.editingBookmark.savedAt : Date.now();
            const useCount = this.isEditMode && this.editingBookmark ? this.editingBookmark.useCount : 1;
            const lastUsed = this.isEditMode && this.editingBookmark ? this.editingBookmark.lastUsed : Date.now();
            const updates = { url, title, tags, excerpt, savedAt, useCount, lastUsed };

            // 打印书签编辑信息
            logger.debug('书签编辑信息:', {
                isEditMode: this.isEditMode,
                before: this.editingBookmark || null,
                after: updates
            });

            // 编辑改 URL 冲突：新 URL 已存在时提示合并确认（与 popup 一致）
            if (this.isEditMode && this.editingBookmark?.url !== url) {
                const existing = await LocalStorageMgr.getBookmark(url, true);
                if (existing) {
                    const confirmed = confirm(i18n.getMessage('popup_url_merge_confirm'));
                    if (!confirmed) {
                        saveTagsBtn.disabled = false;
                        return;
                    }
                }
            }

            this.showStatus(i18n.M('msg_status_saving_bookmark'), 'success');
            
            // 统一使用 bookmarkOps 更新（extension + Chrome）
            const bookmarkToUpdate = this.isEditMode ? this.editingBookmark : { url, title, tags, excerpt, savedAt, useCount, lastUsed, _presence: 'extension_only' };
            const oldUrl = this.isEditMode && this.editingBookmark?.url !== url ? this.editingBookmark.url : null;
            const browserSave = await this.resolveBrowserBookmarkSaveForSubmit();
            if (this.browserBookmarkSelector) {
                this.browserBookmarkSelector.setValue(browserSave);
            }
            const bookmarkOperationResult = await bookmarkOps.updateBookmark(bookmarkToUpdate, updates, oldUrl, { browserSave });
            if (BrowserBookmarkSelector.shouldPersistPreferenceAfterBookmarkSave({
                isEditMode: this.isEditMode,
                bookmarkOperationResult
            })) {
                await this.persistBrowserBookmarkPreference(browserSave);
            }
            await updateExtensionIcon(this.currentTab.id, true);

            sendMessageSafely({
                type: MessageType.BOOKMARKS_UPDATED,
                source: 'quickSave'
            });
            
            this.showStatus(i18n.M('msg_status_save_success'), 'success');
            setTimeout(() => window.close(), 500);
        } catch (error) {
            logger.error('保存书签失败:', error);
            this.showStatus(i18n.M('msg_error_save_failed', [error.message]), 'error');
            saveTagsBtn.disabled = false;
        }
    }

    async handleDelete() {
        if (!this.currentTab) return;
        
        const confirmation = confirm(i18n.M('msg_confirm_delete_bookmark'));
        if (confirmation) {
            try {
                const bookmarks = await getAllBookmarks(false);
                let bookmark = bookmarks[this.currentTab.url] || Object.values(bookmarks).find(b => b.url === this.currentTab.url);
                if (bookmark) {
                    await bookmarkOps.deleteBookmark(bookmark);
                    await updateExtensionIcon(this.currentTab.id, false);

                    sendMessageSafely({
                        type: MessageType.BOOKMARKS_UPDATED,
                        source: 'quickSave'
                    });
                }
                window.close();
            } catch (error) {
                logger.error('删除书签失败:', error);
            }
        }
    }

    // 添加调整文本域高度的方法
    adjustTextareaHeight(textarea) {
        if (!textarea) return;

        // 重置高度为自动，计算新高度
        textarea.style.height = 'auto';
        
        // 计算新的高度
        const scrollHeight = textarea.scrollHeight;
        
        // 获取css中设置的最大高度限制
        const maxHeight = parseInt(window.getComputedStyle(textarea).maxHeight);
        
        // 设置新高度，但不超过最大高度
        textarea.style.height = Math.min(scrollHeight, maxHeight) + 'px';
    }

    // 添加更新字符计数的方法
    updateCharCount(textarea) {
        if (!textarea) return;
        
        const maxLength = textarea.getAttribute('maxlength') || 500;
        const currentLength = textarea.value.length;
        const charCountElement = this.elements.charCount;
        const charCountContainer = this.elements.charCounter;
        
        if (charCountElement) {
            charCountElement.textContent = currentLength;
            
            // 根据字符数更新样式
            charCountContainer.classList.remove('near-limit', 'at-limit');
            if (currentLength >= maxLength) {
                charCountContainer.classList.add('at-limit');
            } else if (currentLength >= maxLength * 0.8) {
                charCountContainer.classList.add('near-limit');
            }
        }
    }

    // 获取编辑后的摘要
    getEditedExcerpt() {
        return this.elements.pageExcerpt ? this.elements.pageExcerpt.value.trim() : '';
    }

    async generateExcerpt() {
        const { pageExcerpt, generateExcerptBtn } = this.elements;
        if (!pageExcerpt || !generateExcerptBtn) return;
        
        // 如果已经在loading状态，尝试取消请求
        if (generateExcerptBtn.classList.contains('loading')) {
            if (this.excerptRequest) {
                this.excerptRequest.abort();
                this.excerptRequest = null;
            }
            return;
        }
        
        try {
            // 显示加载状态
            generateExcerptBtn.classList.add('loading');
            generateExcerptBtn.title = i18n.getMessage('quicksave_cancel_generate');

            await checkAPIKeyValid('chat');

            // 创建可取消的请求
            this.excerptRequest = requestManager.create();

            // 调用API生成摘要，传入signal
            const excerpt = await generateExcerpt(this.pageContent, this.currentTab, this.excerptRequest.signal);
            
            if (excerpt) {
                // 设置摘要内容
                pageExcerpt.value = excerpt;
                // 调整文本区域高度和字符计数
                this.adjustTextareaHeight(pageExcerpt);
                this.updateCharCount(pageExcerpt);
            } else {
                throw new Error(i18n.getMessage('quicksave_error_generate_excerpt_failed'));
            }
        } catch (error) {
            if (isUserCanceledError(error)) {
                this.showStatus(i18n.getMessage('quicksave_status_generate_canceled'), 'success');
            } else {
                this.showStatus(`${error.message}`, 'error');
            }
        } finally {
            // 移除loading状态
            generateExcerptBtn.classList.remove('loading');
            generateExcerptBtn.title = i18n.getMessage('quicksave_generate_excerpt_title');
            
            // 清理请求
            if (this.excerptRequest) {
                this.excerptRequest.done();
                this.excerptRequest = null;
            }
        }
    }

    async translateTitle() {
        const { pageTitle, translateTitleBtn } = this.elements;
        if (!pageTitle || !translateTitleBtn) return;
        
        // 如果已经在loading状态，尝试取消请求
        if (translateTitleBtn.classList.contains('loading')) {
            if (this.translateRequest) {
                this.translateRequest.abort();
                this.translateRequest = null;
            }
            return;
        }
                
        try {
            // 显示加载状态
            translateTitleBtn.classList.add('loading');
            translateTitleBtn.title = i18n.getMessage('ui_button_cancel_translate');

            await checkAPIKeyValid('chat');

            // 使用原始标题进行翻译，而不是当前标题
            const textToTranslate = this.originalTitle || pageTitle.textContent.trim();
            if (!textToTranslate) {
                throw new Error(i18n.getMessage('quicksave_error_title_empty'));
            }

            // 创建可取消的请求
            this.translateRequest = requestManager.create();

            // 调用API进行翻译（使用原始标题）
            const translatedText = await translateText(textToTranslate, this.translateRequest.signal);
            
            if (translatedText) {
                // 保存原始标题（如果还没有保存）
                if (!this.originalTitle) {
                    this.originalTitle = pageTitle.textContent.trim();
                }
                
                // 替换标题内容
                pageTitle.textContent = translatedText;
                pageTitle.title = translatedText;
                
                // 标记已翻译，支持撤销
                this.hasTranslated = true;
            } else {
                throw new Error(i18n.getMessage('quicksave_error_translate_failed'));
            }
        } catch (error) {
            if (isUserCanceledError(error)) {
                this.showStatus(i18n.getMessage('quicksave_status_translate_canceled'), 'success');
            } else {
                this.showStatus(error.message || i18n.getMessage('quicksave_error_translate_failed'), 'error');
            }
        } finally {
            // 移除loading状态
            translateTitleBtn.classList.remove('loading');
            translateTitleBtn.title = i18n.getMessage('ui_button_translate_title');
            
            // 清理请求
            if (this.translateRequest) {
                this.translateRequest.done();
                this.translateRequest = null;
            }
        }
    }
}

// 初始化
document.addEventListener('DOMContentLoaded', () => {
    i18n.initializeI18n();
    // 更新页面文本
    new QuickSaveManager();
}); 
