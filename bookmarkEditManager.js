/**
 * 书签编辑模式管理类
 * 用于管理书签的批量选择和编辑功能
 */
class BookmarkEditManager {
    constructor(elements, callbacks, itemName) {
        this.isEditMode = false;
        this.selectedBookmarks = new Set();
        this.container = elements.container;
        this.bookmarkList = elements.bookmarkList;
        this.selectAllCheckbox = elements.selectAllCheckbox;
        this.selectedCountElement = elements.selectedCountElement;
        this.batchDeleteButton = elements.batchDeleteButton;
        this.batchOpenButton = elements.batchOpenButton;
        this.exitEditModeButton = elements.exitEditModeButton;

        this.bookmarkItemClass = `.${itemName}`;

        this.showStatus = callbacks.showStatus;
        this.showDialog = callbacks.showDialog;
        this.afterDelete = callbacks.afterDelete;
        
        this.allBookmarks = []; // 用于存储所有书签
        this.lastSelectedBookmark = null; // 用于存储上一次选中的书签元素
        
        this.bindEvents();
    }
    
    /**
     * 绑定事件处理函数
     */
    bindEvents() {
        // 全选/取消全选
        this.selectAllCheckbox.addEventListener('change', () => {
            this.toggleSelectAll(this.selectAllCheckbox.checked);
        });
        
        // 批量删除
        this.batchDeleteButton.addEventListener('click', () => {
            this.batchDelete();
        });
        
        // 批量打开
        this.batchOpenButton.addEventListener('click', () => {
            this.batchOpen();
        });
        
        // 退出编辑模式
        this.exitEditModeButton.addEventListener('click', () => {
            this.exitEditMode();
        });
    }
    
    /**
     * 初始化编辑模式管理器
     * @param {Array} bookmarks 所有书签数据
     */
    initialize(bookmarks) {
        this.isEditMode = false;
        this.selectedBookmarks.clear();
        this.allBookmarks = bookmarks;
    }
    
    /**
     * 进入编辑模式
     * @param {HTMLElement} selectedItem 首个被选中的元素
     */
    enterEditMode(selectedItem) {
        this.isEditMode = true;
        this.container.classList.add('edit-mode');
        
        // 清空之前的选择
        this.selectedBookmarks.clear();
        
        // 如果有初始选中项，则添加到选中集合
        if (selectedItem) {
            const checkbox = selectedItem.querySelector('.bookmark-checkbox input');
            checkbox.checked = true;
            selectedItem.classList.add('selected');
            this.addToSelection(selectedItem);
            this.lastSelectedBookmark = selectedItem; // 记录最后一次选中的书签
        }
        
        // 更新计数器
        this.updateSelectedCount();
        
        // 更新全选复选框状态
        this.updateSelectAllCheckbox();

        // 刷新选中书签项的选择状态
        const url = selectedItem.dataset.url;
        if (url) {
            this.refreshBookmarkSelectionByUrl(url, selectedItem);
        }
    }
    
    /**
     * 退出编辑模式
     */
    exitEditMode() {
        if (!this.isEditMode) return;

        this.isEditMode = false;
        this.container.classList.remove('edit-mode');
        
        // 取消所有选中状态
        this.selectedBookmarks.clear();
        this.lastSelectedBookmark = null;
        
        // 取消所有复选框的选中状态
        this.bookmarkList.querySelectorAll('.bookmark-checkbox input').forEach(checkbox => {
            checkbox.checked = false;
            const bookmarkItem = checkbox.closest(`${this.bookmarkItemClass}`);
            if (bookmarkItem) {
                bookmarkItem.classList.remove('selected');
            }
        });
        
        // 重置全选复选框
        this.selectAllCheckbox.checked = false;
        
        // 更新计数器
        this.updateSelectedCount();
    }
    
    /**
     * 切换书签选中状态
     * @param {HTMLElement} bookmarkItem 书签项元素
     * @param {boolean} isSelected 是否选中
     * @param {boolean} isShiftKey 是否按下了Shift键
     */
    toggleBookmarkSelection(bookmarkItem, isSelected, isShiftKey) {
        // 处理Shift键多选逻辑
        if (isShiftKey && isSelected && this.lastSelectedBookmark && this.lastSelectedBookmark !== bookmarkItem) {
            // 处理Shift键按下时的范围选择
            this.selectBookmarkRange(this.lastSelectedBookmark, bookmarkItem);
        } else {
            // 正常的单选逻辑
            if (isSelected) {
                bookmarkItem.classList.add('selected');
                this.addToSelection(bookmarkItem);
                this.lastSelectedBookmark = bookmarkItem; // 更新最后选择的书签
            } else {
                bookmarkItem.classList.remove('selected');
                this.removeFromSelection(bookmarkItem);
                this.lastSelectedBookmark = null; // 如果取消选中，清除最后选择的书签记录
            }
        }
        
        // 更新计数器
        this.updateSelectedCount();
        
        // 如果没有选中的书签，自动退出编辑模式
        if (this.selectedBookmarks.size === 0) {
            this.exitEditMode();
        }
        
        // 更新全选复选框状态
        this.updateSelectAllCheckbox();

        // 刷新所有url相同的书签项
        const url = bookmarkItem.dataset.url;
        if (url) {
            this.refreshBookmarkSelectionByUrl(url, bookmarkItem);
        }
    }
    
    /**
     * 选择两个书签之间的所有书签
     * @param {HTMLElement} startItem 起始书签
     * @param {HTMLElement} endItem 结束书签
     */
    selectBookmarkRange(startItem, endItem) {
        // 获取所有书签项元素
        const bookmarkItems = Array.from(this.bookmarkList.querySelectorAll(`${this.bookmarkItemClass}`));
        
        // 获取起始和结束索引
        const startIndex = bookmarkItems.indexOf(startItem);
        const endIndex = bookmarkItems.indexOf(endItem);
        
        if (startIndex === -1 || endIndex === -1) return;
        
        // 决定选择范围的方向
        const start = Math.min(startIndex, endIndex);
        const end = Math.max(startIndex, endIndex);
        
        // 选择范围内的所有书签
        for (let i = start; i <= end; i++) {
            const item = bookmarkItems[i];
            const checkbox = item.querySelector('.bookmark-checkbox input');
            if (checkbox) {
                checkbox.checked = true;
            }
            item.classList.add('selected');
            this.addToSelection(item);
        }
        
        // 更新最后选择的书签
        this.lastSelectedBookmark = endItem;
        // 刷新所有书签的选择状态
        this.refreshAllBookmarkSelection();
    }
    
    /**
     * 添加书签到选中集合
     * @param {HTMLElement} bookmarkItem 
     */
    addToSelection(bookmarkItem) {
        if (typeof bookmarkItem === 'string') {
            this.selectedBookmarks.add(bookmarkItem);
        } else {
            const url = bookmarkItem.dataset.url;
            if (url) {
                this.selectedBookmarks.add(url);
            }
        }
    }
    
    /**
     * 从选中集合中移除书签
     * @param {HTMLElement} bookmarkItem 
     */
    removeFromSelection(bookmarkItem) {
        if (typeof bookmarkItem === 'string') {
            this.selectedBookmarks.delete(bookmarkItem);
        } else {
            const url = bookmarkItem.dataset.url;
            if (url) {
                this.selectedBookmarks.delete(url);
            }
        }
    }
    
    /**
     * 更新已选择数量显示
     */
    updateSelectedCount() {
        this.selectedCountElement.textContent = this.selectedBookmarks.size;
    }
    
    /**
     * 更新全选复选框状态
     */
    updateSelectAllCheckbox() {
        const allCheckboxes = this.allBookmarks.length;
        const checkedCount = this.selectedBookmarks.size;
        
        if (checkedCount < allCheckboxes) {
            this.selectAllCheckbox.checked = false;
        } else {
            this.selectAllCheckbox.checked = true;
        }
    }
    
    /**
     * 全选/取消全选
     * @param {boolean} selectAll 是否全选
     */
    toggleSelectAll(selectAll) {
        const bookmarkItems = this.bookmarkList.querySelectorAll(`${this.bookmarkItemClass}`);
        
        bookmarkItems.forEach(item => {
            const checkbox = item.querySelector('.bookmark-checkbox input');
            checkbox.checked = selectAll;
            item.classList.toggle('selected', selectAll);
        });
        if (selectAll) {
            this.allBookmarks.forEach(bookmark => {
                this.addToSelection(bookmark.url);
            });
        }
        
        // 更新计数器
        this.updateSelectedCount();
        
        // 如果取消全选，退出编辑模式
        if (!selectAll) {
            this.exitEditMode();
        }
    }
    
    /**
     * 批量删除选中的书签
     */
    async batchDelete() {
        if (this.selectedBookmarks.size === 0) return;
        
        // 确认删除
        if (!this.showDialog || !this.showStatus) {
            logger.error('批量删除书签失败: 缺少showDialog或showStatus');
            return;
        }
        
        const confirmMessage = `确定要删除选中的 ${this.selectedBookmarks.size} 个书签吗？此操作不可撤销。`;
        this.showDialog({
            title: '批量删除',
            message: confirmMessage,
            primaryText: '删除',
            secondaryText: '取消',
            onPrimary: async () => {
                // 执行删除操作
                const urlsToDelete = Array.from(this.selectedBookmarks);
                
                // 显示状态消息
                this.showStatus('正在删除书签...', false);
                
                try {
                    // 根据书签类型分别处理
                    const userBookmarks = [];
                    const chromeBookmarksToDelete = [];
                    const userBookmarksToDelete = [];

                    for (const url of urlsToDelete) {
                        // 查找匹配的书签对象
                        const bookmark = this.allBookmarks.find(bm => bm.url === url);
                        if (bookmark) {
                            if (bookmark.source === BookmarkSource.CHROME) {
                                chromeBookmarksToDelete.push(bookmark.chromeId);
                            } else {
                                userBookmarks.push(bookmark);
                                userBookmarksToDelete.push(bookmark.url);
                            }
                        }
                    }

                    if (userBookmarksToDelete.length > 0) {
                        await LocalStorageMgr.removeBookmarks(userBookmarksToDelete);
                        await recordBookmarkChange(userBookmarks, true, true);
                    }

                    if (chromeBookmarksToDelete.length > 0) {
                        for (const chromeId of chromeBookmarksToDelete) {
                            await chrome.bookmarks.remove(chromeId);
                        }
                    }
                    
                    // 显示成功消息
                    this.showStatus(`成功删除 ${urlsToDelete.length} 个书签`, false);
                    
                    // 退出编辑模式
                    this.exitEditMode();

                    // 删除完成后刷新列表
                    if (this.afterDelete) {
                        this.afterDelete();
                    }
                } catch (error) {
                    logger.error('批量删除书签失败:', error);
                    this.showStatus('删除书签失败，请重试', true);
                }
            }
        });
    }
    
    /**
     * 判断是否处于编辑模式
     * @returns {boolean}
     */
    isInEditMode() {
        return this.isEditMode;
    }

    /**
     * 批量打开选中的书签
     */
    async batchOpen() {
        if (this.selectedBookmarks.size === 0) return;
        
        const urlsToOpen = Array.from(this.selectedBookmarks);
        const bookmarkCount = urlsToOpen.length;
        
        // 定义打开书签的函数
        const openBookmarks = async () => {
            try {
                // 更新书签使用频率
                await batchUpdateBookmarksUsage(urlsToOpen);

                // 使用chrome.tabs.create打开所有URL
                for (let i = 0; i < urlsToOpen.length; i++) {
                    // 第一个URL在当前标签打开，其余的在新标签页打开
                    const active = i === 0; // 只有第一个标签页会被激活
                    chrome.tabs.create({ url: urlsToOpen[i], active: active });
                }
            } catch (error) {
                logger.error('批量打开书签失败:', error);
                this.showStatus('打开书签失败，请重试', true);
            }
        };
        
        // 如果选中书签数量大于10，则提示用户是否要批量打开，告知可能会导致浏览器卡顿
        if (bookmarkCount > 10) {
            if (!this.showDialog || !this.showStatus) {
                logger.error('批量打开书签失败: 缺少showDialog或showStatus');
                return;
            }
            
            const confirmMessage = `您选择了 ${bookmarkCount} 个书签，一次性打开过多标签页可能会导致浏览器卡顿。确定要继续吗？`;
            this.showDialog({
                title: '批量打开提醒',
                message: confirmMessage,
                primaryText: '打开',
                secondaryText: '取消',
                onPrimary: openBookmarks
            });
        } else {
            // 数量不超过10个，直接打开
            await openBookmarks();
        }
    }

    /**
     * 刷新指定URL的书签项选择状态
     * @param {string} url 书签URL
     * @param {HTMLElement} bookmarkItem 书签项元素
     */
    refreshBookmarkSelectionByUrl(url, bookmarkItem) {
        // 在整个文档中查找所有具有相同URL的书签项
        const sameUrlBookmarks = this.bookmarkList.querySelectorAll(`${this.bookmarkItemClass}[data-url="${url}"]`);
        // 更新每一个相同URL的书签项的选中状态
        sameUrlBookmarks.forEach(item => {
            if (item !== bookmarkItem) {  // 跳过当前操作的书签项，避免重复操作
                this.refreshBookmarkSelection(item);
            }
        });
    }

    /**
     * 刷新所有书签的选择状态
     */
    refreshAllBookmarkSelection() {
        this.bookmarkList.querySelectorAll(`${this.bookmarkItemClass}`).forEach(item => {
            this.refreshBookmarkSelection(item);
        });
    }

    /**
     * 更新书签选择状态
     * @param {HTMLElement} bookmarkItem 书签项元素
     */
    refreshBookmarkSelection(bookmarkItem) {
        if (!this.isEditMode) return;

        const checkbox = bookmarkItem.querySelector('.bookmark-checkbox input');
        if (!checkbox) return;

        const url = bookmarkItem.dataset.url;
        const isSelected = this.selectedBookmarks.has(url);
        if (isSelected) {
            checkbox.checked = true;
            bookmarkItem.classList.add('selected');
        } else {
            checkbox.checked = false;
            bookmarkItem.classList.remove('selected');
        }
    }
}