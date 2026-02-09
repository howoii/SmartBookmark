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
            recommendedTags: document.querySelector('.recommended-tags'),
            recommendedTagsList: document.querySelector('.recommended-tags-list'),
            status: document.getElementById('status'),
            dialogContent: document.querySelector('.dialog-content'),
            charCount: document.getElementById('char-count'),
            charCounter: document.querySelector('.char-counter'),
            generateExcerptBtn: document.getElementById('generate-excerpt-btn')
        };

        this.currentTab = null;
        this.pageContent = null;
        this.isEditMode = false;
        this.editingBookmark = null;
        this.statusTimeout = null;
        this.originalUrl = null;
        this.excerptRequest = null;

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

            // 先检查是否已保存，这会设置 isEditMode
            await this.checkSavedState();
            
            // 获取页面内容并处理标签
            await this.setupPageContentAndTags();
            
            // 设置事件监听
            this.setupEventListeners();
        } catch (error) {
            logger.error('初始化失败:', error);
            this.showStatus(i18n.M('msg_error_init_failed', [error.message]), 'error', true);
            this.hideMainContent();
        }
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
                <button class="close-status" data-i18n-title="ui_button_close">
                    <svg viewBox="0 0 24 24" width="16" height="16">
                        <path fill="currentColor" d="M19,6.41L17.59,5L12,10.59L6.41,5L5,6.41L10.59,12L5,17.59L6.41,19L12,13.41L17.59,19L19,17.59L13.41,12L19,6.41Z" />
                    </svg>
                </button>
            `;
        }
        status.innerHTML = html;
        i18n.updateNodeText(status);

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

            // 如果有关键词，显示为推荐标签
            this.elements.recommendedTags.style.display = 'none';
            if (this.pageContent.metadata?.keywords) {
                this.showRecommendedTags(this.pageContent.metadata.keywords);
            }

            // 如果不是编辑模式，生成并显示标签
            const unclassifiedTag = i18n.M('ui_tag_unclassified');
            if (this.isEditMode) {
                this.renderTags(this.editingBookmark?.tags);
            } else {
                this.showTagsLoading();
                try {
                    // 检查缓存中是否已有标签
                    const cachedTags = await LocalStorageMgr.getTags(this.currentTab.url);
                    if (cachedTags) {
                        logger.debug('使用缓存的标签:', cachedTags);
                        this.hideTagsLoading();
                        this.renderTags(cachedTags);
                    } else {
                        const hierarchicalTags = await generateHierarchicalTags(this.pageContent, this.currentTab);
                        logger.debug('生成层级标签:', hierarchicalTags);
                        this.hideTagsLoading();
                        if (hierarchicalTags && hierarchicalTags.length > 0) {
                            this.renderTags(hierarchicalTags);
                            // 缓存生成的标签
                            await LocalStorageMgr.setTags(this.currentTab.url, hierarchicalTags);
                            logger.debug('缓存标签:', hierarchicalTags);
                        } else {
                            this.renderTags([unclassifiedTag]);
                        }
                    }
                } catch (error) {
                    logger.error('生成标签失败:', error);
                    this.hideTagsLoading();
                    this.renderTags([unclassifiedTag]);
                }
            }
        } catch (error) {
            logger.error('获取页面内容失败:', error);
            if (!this.isEditMode) {
                this.hideTagsLoading();
                this.renderTags([unclassifiedTag]);
            }
        }
    }

    async checkSavedState() {
        const isSaved = await checkIfPageSaved(this.currentTab.url);
        if (isSaved) {
            const bookmark = await LocalStorageMgr.getBookmark(this.currentTab.url, true);
            if (bookmark) {
                this.isEditMode = true;
                this.editingBookmark = bookmark;
                this.elements.pageTitle.textContent = bookmark.title;
                this.elements.pageUrl.contentEditable = "true";
                this.elements.pageUrl.classList.add("editable");
                this.elements.deleteBookmarkBtn.style.display = 'flex';
            }
        } else {
            this.elements.pageUrl.contentEditable = "true";
            this.elements.pageUrl.classList.add("editable");
            this.elements.deleteBookmarkBtn.style.display = 'none';
        }
    }

    setupEventListeners() {
        const { pageTitle, pageUrl, tagsList, newTagInput, saveTagsBtn, cancelTagsBtn, deleteBookmarkBtn, recommendedTagsList, pageExcerpt, generateExcerptBtn } = this.elements;

        pageTitle.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                pageTitle.blur();
            }
        });

        pageUrl.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                pageUrl.blur();
            }
        });

        pageUrl.addEventListener('blur', () => {
            this.validateUrl();
        });

        // 标签列表点击事件（删除标签）
        tagsList.addEventListener('click', (e) => {
            if (e.target.classList.contains('remove-tag-btn')) {
                const tagElement = e.target.parentElement;
                tagElement.remove();
            }  else if (e.target.classList.contains('tag-text')) {
                // 点击扁平标签本身，将标签内容设置到输入框中
                const tagText = e.target.textContent.trim();
                if (newTagInput && tagText) {
                    newTagInput.value = tagText;
                    newTagInput.focus();
                }
            } else if (e.target.className && e.target.className.startsWith('tag-level-')) {
                // 点击层级标签的某个层级，将完整标签路径设置到输入框中
                const tagElement = e.target.closest('.tag');
                if (tagElement && tagElement.classList.contains('hierarchical-tag')) {
                    const levelSpans = tagElement.querySelectorAll('[class^="tag-level-"]');
                    const fullPath = Array.from(levelSpans).map(span => span.textContent.trim()).join('/');
                    if (newTagInput && fullPath) {
                        newTagInput.value = fullPath;
                        newTagInput.focus();
                    }
                }
            }
        });

        // 新标签输入事件
        newTagInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                const newTag = newTagInput.value.trim().replace(/>/g, '/'); // 将>转换为/
                this.addNewTag(newTag);
            }
        });

        // 输入时显示自动补全建议
        newTagInput.addEventListener('input', async (e) => {
            const inputValue = e.target.value.trim();
            if (inputValue.length > 0) {
                await this.showTagAutoComplete(inputValue);
            } else {
                this.hideTagSuggestions();
            }
        });

        // 失去焦点时隐藏建议（延迟以允许点击建议）
        newTagInput.addEventListener('blur', () => {
            setTimeout(() => this.hideTagSuggestions(), 200);
        });

        // 推荐标签点击事件
        recommendedTagsList.addEventListener('click', (e) => {
            const tagElement = e.target.closest('.tag');
            if (tagElement) {
                this.addNewTag(tagElement.textContent.trim());
            }
        });

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

    renderTags(tags) {
        const { tagsList } = this.elements;
        tagsList.innerHTML = '';

        tags.forEach(tag => {
            const tagElement = document.createElement('span');

            // 检查是否为层级标签
            if (tag.includes('/')) {
                // 渲染层级标签
                tagElement.className = 'tag hierarchical-tag';
                const parts = tag.split('/');
                let innerHTML = '';

                parts.forEach((part, index) => {
                    const levelClass = `tag-level-${index + 1}`;
                    innerHTML += `<span class="${levelClass}">${part.trim()}</span>`;
                    if (index < parts.length - 1) {
                        innerHTML += '<span class="tag-separator">/</span>';
                    }
                });

                innerHTML += '<button class="remove-tag-btn">×</button>';
                tagElement.innerHTML = innerHTML;
            } else {
                // 渲染扁平标签
                tagElement.className = 'tag';
                tagElement.innerHTML = `
                    <span class="tag-text">${tag}</span>
                    <button class="remove-tag-btn">×</button>
                `;
            }

            tagsList.appendChild(tagElement);
        });
    }

    renderPageExcerpt(excerpt) {
        if (excerpt) {
            this.elements.pageExcerpt.value = excerpt;
        } else {
            this.elements.pageExcerpt.value = '';
            this.elements.pageExcerpt.placeholder = '添加或编辑书签摘要...';
        }
        requestAnimationFrame(() => {
            this.adjustTextareaHeight(this.elements.pageExcerpt);
            this.updateCharCount(this.elements.pageExcerpt);
        });
    }

    getCurrentTags() {
        const tagElements = this.elements.tagsList.querySelectorAll('.tag');
        return Array.from(tagElements).map(tagEl => {
            // 检查是否为层级标签
            if (tagEl.classList.contains('hierarchical-tag')) {
                // 提取所有层级span的文本并用/连接
                const levelSpans = tagEl.querySelectorAll('[class^="tag-level-"]');
                return Array.from(levelSpans).map(span => span.textContent.trim()).join('/');
            } else {
                // 扁平标签
                const tagText = tagEl.querySelector('.tag-text');
                return tagText ? tagText.textContent.trim() : '';
            }
        }).filter(tag => tag); // 过滤空标签
    }

    addNewTag(tag) {
        if (!tag) return;
        
        const currentTags = this.getCurrentTags();
        if (!currentTags.includes(tag)) {
            this.renderTags([...currentTags, tag]);
            this.elements.newTagInput.value = '';
        } else {
            this.showStatus('标签已存在', 'error');
        }
    }

    showRecommendedTags(keywords) {
        if (!keywords) return;

        const tags = keywords
            .split(/[,，;；]/)
            .map(tag => tag.trim())
            .filter(tag => tag.length > 0 && tag.length <= 20)
            .slice(0, 10);

        // 获取推荐标签容器
        const recommendedTags = this.elements.recommendedTags;
        
        if (tags.length === 0) {
            return;
        }

        // 显示推荐标签区域
        if (recommendedTags) {
            recommendedTags.style.display = 'block';
        }

        // 渲染标签
        this.elements.recommendedTagsList.innerHTML = tags
            .map(tag => `<span class="tag">${tag}</span>`)
            .join('');
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
            this.showStatus('URL格式错误', 'error');
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
                throw new Error('URL格式错误');
            }
            
            const pageInfo = {
                url: url, 
                title: title,
                tags: tags,
                excerpt: excerpt,
                savedAt: this.isEditMode ? this.editingBookmark.savedAt : Date.now(),
                useCount: this.isEditMode ? this.editingBookmark.useCount : 1,
                lastUsed: Date.now(),
            };

            // 打印书签编辑信息
            logger.debug('书签编辑信息:', {
                isEditMode: this.isEditMode,
                before: this.isEditMode ? this.editingBookmark : null,
                after: pageInfo
            });

            this.showStatus(i18n.M('msg_status_saving_bookmark'), 'success');
            
            // 如果编辑模式下URL发生变化，则先删除旧书签
            if (this.isEditMode && this.editingBookmark.url !== url) {
                await LocalStorageMgr.removeBookmark(this.editingBookmark.url);
            }
            
            // 保存新书签
            await updateBookmarksAndEmbedding(pageInfo);
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
                const bookmark = await LocalStorageMgr.getBookmark(this.currentTab.url, true);
                if (bookmark) {
                    await LocalStorageMgr.removeBookmark(this.currentTab.url);
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

    /**
     * 显示标签自动补全建议
     * @param {string} inputValue - 输入的值
     */
    async showTagAutoComplete(inputValue) {
        // 获取所有现有书签的标签
        const bookmarks = await LocalStorageMgr.getBookmarksList();
        const allTags = new Set();

        for (const bookmark of bookmarks) {
            const tags = bookmark.hierarchicalTags || bookmark.tags || [];
            tags.forEach(tag => allTags.add(tag));
        }

        // 过滤匹配的标签
        const suggestions = Array.from(allTags).filter(tag => {
            const normalizedTag = tag.toLowerCase();
            const normalizedInput = inputValue.toLowerCase().replace(/>/g, '/');

            // 支持前缀匹配和包含匹配
            return normalizedTag.includes(normalizedInput);
        }).slice(0, 10); // 最多显示10个建议

        if (suggestions.length > 0) {
            this.renderTagSuggestions(suggestions, inputValue);
        } else {
            this.hideTagSuggestions();
        }
    }

    /**
     * 渲染标签建议列表
     * @param {Array<string>} suggestions - 建议的标签列表
     * @param {string} inputValue - 当前输入值
     */
    renderTagSuggestions(suggestions, inputValue) {
        const { newTagInput } = this.elements;
        if (!newTagInput) return;

        // 移除旧的建议容器
        let suggestionsContainer = document.querySelector('.tag-suggestions');
        if (!suggestionsContainer) {
            suggestionsContainer = document.createElement('div');
            suggestionsContainer.className = 'tag-suggestions';
            newTagInput.parentElement.appendChild(suggestionsContainer);
        }

        // 清空并填充新建议
        suggestionsContainer.innerHTML = '';
        suggestions.forEach(tag => {
            const suggestionItem = document.createElement('div');
            suggestionItem.className = 'tag-suggestion-item';

            // 高亮匹配部分
            const normalizedInput = inputValue.toLowerCase().replace(/>/g, '/');
            const normalizedTag = tag.toLowerCase();
            const matchIndex = normalizedTag.indexOf(normalizedInput);

            if (matchIndex !== -1) {
                const before = tag.substring(0, matchIndex);
                const match = tag.substring(matchIndex, matchIndex + inputValue.length);
                const after = tag.substring(matchIndex + inputValue.length);
                suggestionItem.innerHTML = `${before}<strong>${match}</strong>${after}`;
            } else {
                suggestionItem.textContent = tag;
            }

            // 点击建议项添加标签
            suggestionItem.addEventListener('click', () => {
                this.addNewTag(tag);
                newTagInput.value = '';
                this.hideTagSuggestions();
            });

            suggestionsContainer.appendChild(suggestionItem);
        });

        suggestionsContainer.style.display = 'block';
    }

    /**
     * 隐藏标签建议
     */
    hideTagSuggestions() {
        const suggestionsContainer = document.querySelector('.tag-suggestions');
        if (suggestionsContainer) {
            suggestionsContainer.style.display = 'none';
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
            generateExcerptBtn.title = "取消生成";

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
                throw new Error('摘要生成失败');
            }
        } catch (error) {
            if (error.message.includes('UserCanceled')) {
                this.showStatus('已取消生成摘要', 'success');
            } else {
                this.showStatus(`${error.message}`, 'error');
            }
        } finally {
            // 移除loading状态
            generateExcerptBtn.classList.remove('loading');
            generateExcerptBtn.title = "AI生成摘要";
            
            // 清理请求
            if (this.excerptRequest) {
                this.excerptRequest.done();
                this.excerptRequest = null;
            }
        }
    }
}

// 初始化
document.addEventListener('DOMContentLoaded', () => {
    new QuickSaveManager();
}); 