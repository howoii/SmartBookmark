EnvIdentifier = 'quickSave';

class QuickSaveManager {
    constructor() {
        // DOM 元素
        this.elements = {
            pageTitle: document.querySelector('.page-title'),
            pageUrl: document.querySelector('.page-url'),
            pageExcerpt: document.querySelector('.page-excerpt'),
            pageFavicon: document.querySelector('.page-favicon img'),
            tagsList: document.getElementById('tags-list'),
            newTagInput: document.getElementById('new-tag-input'),
            saveTagsBtn: document.getElementById('save-tags-btn'),
            cancelTagsBtn: document.getElementById('cancel-tags-btn'),
            deleteBookmarkBtn: document.getElementById('delete-bookmark-btn'),
            recommendedTags: document.querySelector('.recommended-tags'),
            recommendedTagsList: document.querySelector('.recommended-tags-list'),
            status: document.getElementById('status'),
            dialogContent: document.querySelector('.dialog-content')
        };

        this.currentTab = null;
        this.pageContent = null;
        this.isEditMode = false;
        this.editingBookmark = null;
        this.statusTimeout = null;

        this.init();
    }

    async init() {
        try {
            // 获取当前标签页信息
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            if (!tab) {
                throw new Error('无法获取当前标签页信息');
            }

            this.currentTab = tab;

            // 检查是否是不可标记的URL
            if (isNonMarkableUrl(tab.url)) {
                this.showStatus('基于隐私安全保护，不支持保存此页面', 'error', true);
                this.hideMainContent();
                return;
            }

            // 检查页面是否加载完成
            if (tab.status !== 'complete') {
                this.showStatus('页面正在加载中，请等待加载完成后再试', 'warning', true);
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
            this.showStatus('初始化失败: ' + error.message, 'error', true);
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
        const { pageTitle, pageUrl, pageFavicon, recommendedTags, pageExcerpt } = this.elements;
        const { title, url } = this.currentTab;

        // 设置页面信息
        pageTitle.textContent = title || '';
        pageTitle.title = title || '';
        pageUrl.textContent = url || '';
        pageUrl.title = url || '';

        // 设置推荐标签
        recommendedTags.style.display = 'none';
        pageExcerpt.style.display = 'none';

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
            <span>正在生成标签...</span>
        `;
        tagsList.classList.add('loading');
    }

    hideTagsLoading() {
        const { tagsList } = this.elements;
        tagsList.classList.remove('loading');
        tagsList.innerHTML = '';
    }

    async setupPageContentAndTags() {
        try {
            // 使用 getPageContent 获取页面内容
            this.pageContent = await getPageContent(this.currentTab);
            logger.debug("获取页面内容", {
                tab: this.currentTab,
                pageContent: this.pageContent,
                isEditMode: this.isEditMode
            });
            
            // 设置页面摘要
            const excerpt = this.pageContent.excerpt?.trim();
            if (excerpt) {
                this.elements.pageExcerpt.textContent = excerpt;
                this.elements.pageExcerpt.style.display = 'block';
            }

            // 如果有关键词，显示为推荐标签
            if (this.pageContent.metadata?.keywords) {
                this.showRecommendedTags(this.pageContent.metadata.keywords);
            }

            // 如果不是编辑模式，生成并显示标签
            if (!this.isEditMode) {
                this.showTagsLoading();
                try {
                    // 检查缓存中是否已有标签
                    const cachedTags = await LocalStorageMgr.getTags(this.currentTab.url);
                    if (cachedTags) {
                        logger.debug('使用缓存的标签:', cachedTags);
                        this.hideTagsLoading();
                        this.renderTags(cachedTags);
                    } else {
                        const tags = await generateTags(this.pageContent, this.currentTab);
                        logger.debug('生成标签:', tags);
                        this.hideTagsLoading();
                        if (tags && tags.length > 0) {
                            this.renderTags(tags);
                            // 缓存生成的标签
                            await LocalStorageMgr.setTags(this.currentTab.url, tags);
                            logger.debug('缓存标签:', tags);
                        } else {
                            this.renderTags(['未分类']);
                        }
                    }
                } catch (error) {
                    logger.error('生成标签失败:', error);
                    this.hideTagsLoading();
                    this.renderTags(['未分类']);
                }
            }
        } catch (error) {
            logger.error('获取页面内容失败:', error);
            if (!this.isEditMode) {
                this.hideTagsLoading();
                this.renderTags(['未分类']);
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
                this.renderTags(bookmark.tags);
                this.elements.deleteBookmarkBtn.style.display = 'flex';
            }
        }
    }

    setupEventListeners() {
        const { tagsList, newTagInput, saveTagsBtn, cancelTagsBtn, deleteBookmarkBtn, recommendedTagsList } = this.elements;

        // 标签列表点击事件（删除标签）
        tagsList.addEventListener('click', (e) => {
            if (e.target.classList.contains('remove-tag-btn')) {
                const tagElement = e.target.parentElement;
                tagElement.remove();
            }
        });

        // 新标签输入事件
        newTagInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                this.addNewTag(newTagInput.value.trim());
            }
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
    }

    renderTags(tags) {
        const { tagsList } = this.elements;
        tagsList.innerHTML = '';
        tags.forEach(tag => {
            const tagElement = document.createElement('span');
            tagElement.className = 'tag';
            tagElement.innerHTML = `
                ${tag}
                <button class="remove-tag-btn">×</button>
            `;
            tagsList.appendChild(tagElement);
        });
    }

    getCurrentTags() {
        const tagElements = this.elements.tagsList.querySelectorAll('.tag');
        return Array.from(tagElements).map(el => el.textContent.replace('×', '').trim());
    }

    addNewTag(tag) {
        if (!tag) return;
        
        const currentTags = this.getCurrentTags();
        if (!currentTags.includes(tag)) {
            this.renderTags([...currentTags, tag]);
            this.elements.newTagInput.value = '';
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

    async handleSave() {
        if (!this.currentTab) return;
        
        const { saveTagsBtn } = this.elements;
        const tags = this.getCurrentTags();
        
        saveTagsBtn.disabled = true;
        
        try {
            this.showStatus('正在保存书签...', 'success');
            
            const title = this.elements.pageTitle.textContent.trim();

            // 生成嵌入向量
            let embedding = null;
            if (!this.isEditMode) {
                this.showStatus('正在生成向量...', 'success');
                embedding = await getEmbedding(makeEmbeddingText(this.pageContent, this.currentTab, tags));
            }

            // 获取当前服务信息
            const apiService = await ConfigManager.getActiveService();
            
            const pageInfo = {
                url: this.currentTab.url,
                title: title,
                tags: tags,
                excerpt: this.pageContent?.excerpt || '',
                embedding: this.isEditMode ? this.editingBookmark.embedding : embedding,
                savedAt: this.isEditMode ? this.editingBookmark.savedAt : new Date().toISOString(),
                useCount: this.isEditMode ? this.editingBookmark.useCount : 1,
                lastUsed: new Date().toISOString(),
                apiService: this.isEditMode ? this.editingBookmark.apiService : apiService.id,
                embedModel: this.isEditMode ? this.editingBookmark.embedModel : apiService.embedModel,
            };

            // 打印书签编辑信息
            logger.debug('书签编辑信息:', {
                isEditMode: this.isEditMode,
                before: this.isEditMode ? this.editingBookmark : null,
                after: pageInfo
            });

            this.showStatus('正在保存到本地...', 'success');
            await LocalStorageMgr.setBookmark(this.currentTab.url, pageInfo);
            await recordBookmarkChange(pageInfo, false, true);
            await updateExtensionIcon(this.currentTab.id, true);

            sendMessageSafely({
                type: MessageType.BOOKMARKS_UPDATED,
                source: 'quickSave'
            });
            
            this.showStatus('保存成功', 'success');
            setTimeout(() => window.close(), 500);
        } catch (error) {
            logger.error('保存书签失败:', error);
            this.showStatus('保存失败: ' + error.message, 'error');
            saveTagsBtn.disabled = false;
        }
    }

    async handleDelete() {
        if (!this.currentTab) return;
        
        const confirmation = confirm('确定要删除此书签吗？');
        if (confirmation) {
            try {
                const bookmark = await LocalStorageMgr.getBookmark(this.currentTab.url, true);
                if (bookmark) {
                    await LocalStorageMgr.removeBookmark(this.currentTab.url);
                    await recordBookmarkChange(bookmark, true, true);
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
}

// 初始化
document.addEventListener('DOMContentLoaded', () => {
    new QuickSaveManager();
}); 