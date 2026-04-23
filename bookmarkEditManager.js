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
        this.batchMoveButton = elements.batchMoveButton;
        this.batchDeleteButton = elements.batchDeleteButton;
        this.batchOpenButton = elements.batchOpenButton;
        this.exitEditModeButton = elements.exitEditModeButton;

        this.bookmarkItemClass = `.${itemName}`;

        this.showStatus = callbacks.showStatus;
        this.showDialog = callbacks.showDialog;
        this.afterDelete = callbacks.afterDelete;
        this.onBatchMove = callbacks.onBatchMove;
        this.onExitEditMode = callbacks.onExitEditMode;
        
        this.allBookmarks = []; // 用于存储所有书签
        this.isDirectoryView = false; // 目录视图下选择集按 nodeKey
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

        // 批量移动
        if (this.batchMoveButton) {
            this.batchMoveButton.addEventListener('click', () => {
                if (this.onBatchMove) this.onBatchMove(this);
            });
        }

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

        // ESC 键退出编辑模式
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && this.isEditMode) {
                e.preventDefault();
                e.stopPropagation();
                e.stopImmediatePropagation();
                this.exitEditMode();
            }
        });
    }
    
    /**
     * 初始化编辑模式管理器
     * @param {Array} bookmarks 所有书签数据
     */
    initialize(bookmarks) {
        this.isEditMode = false;
        this.selectedBookmarks.clear();
        this.allBookmarks = bookmarks || [];
        this.isDirectoryView = this.allBookmarks.some(b => b && b._nodeKey);
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

        // 刷新选中书签项的选择状态（目录视图下同 URL 不联动，仅刷新当前项）
        if (this.isDirectoryView) {
            this.refreshBookmarkSelection(selectedItem);
        } else {
            const url = selectedItem.dataset.url;
            if (url) this.refreshBookmarkSelectionByUrl(url, selectedItem);
        }
    }
    
    /**
     * 退出编辑模式
     */
    exitEditMode() {
        if (!this.isEditMode) return;

        this.isEditMode = false;
        this.container.classList.remove('edit-mode');
        
        if (this.onExitEditMode) this.onExitEditMode();

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

        // 目录视图下同 URL 不联动；列表视图下刷新所有同 URL 项
        if (this.isDirectoryView) {
            this.refreshBookmarkSelection(bookmarkItem);
        } else {
            const url = bookmarkItem.dataset.url;
            if (url) this.refreshBookmarkSelectionByUrl(url, bookmarkItem);
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
            const key = this.isDirectoryView ? bookmarkItem.dataset.nodeKey : bookmarkItem.dataset.url;
            if (key) this.selectedBookmarks.add(key);
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
            const key = this.isDirectoryView ? bookmarkItem.dataset.nodeKey : bookmarkItem.dataset.url;
            if (key) this.selectedBookmarks.delete(key);
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
                const key = this.isDirectoryView ? bookmark._nodeKey : bookmark.url;
                if (key) this.addToSelection(key);
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
     * 目录视图下按 nodeKey 删除；列表视图下按 url 删除
     */
    async batchDelete() {
        if (this.selectedBookmarks.size === 0) return;
        
        if (!this.showDialog || !this.showStatus) {
            logger.error('批量删除书签失败: 缺少showDialog或showStatus');
            return;
        }
        
        const confirmMessage = i18n.getMessage('popup_batch_delete_confirm', [this.selectedBookmarks.size]);
        this.showDialog({
            title: i18n.getMessage('popup_batch_delete_title'),
            message: confirmMessage,
            primaryText: i18n.getMessage('action_delete_bookmark'),
            secondaryText: i18n.getMessage('ui_button_cancel'),
            onPrimary: async () => {
                const keysToDelete = Array.from(this.selectedBookmarks);
                this.showStatus(i18n.getMessage('popup_batch_delete_deleting'), false);
                
                const bookmarksToDelete = [];
                if (this.isDirectoryView) {
                    for (const nodeKey of keysToDelete) {
                        const bookmark = this.allBookmarks.find(bm => bm._nodeKey === nodeKey);
                        if (bookmark) bookmarksToDelete.push(bookmark);
                    }
                } else {
                    for (const url of keysToDelete) {
                        const bookmark = this.allBookmarks.find(bm => bm.url === url);
                        if (bookmark) bookmarksToDelete.push(bookmark);
                    }
                }

                let failCount = 0;
                for (const bookmark of bookmarksToDelete) {
                    try {
                        await bookmarkOps.deleteBookmark(bookmark);
                    } catch (e) {
                        logger.error('删除书签失败:', bookmark, e);
                        failCount++;
                    }
                }

                const successCount = bookmarksToDelete.length - failCount;
                if (failCount === 0) {
                    this.showStatus(i18n.getMessage('popup_batch_delete_success', [keysToDelete.length]), false);
                } else if (successCount > 0) {
                    this.showStatus(i18n.getMessage('popup_delete_partial_success') + ` (${successCount}/${bookmarksToDelete.length})`, false);
                } else {
                    this.showStatus(i18n.getMessage('popup_batch_delete_failed'), true);
                }

                this.exitEditMode();
                if (this.afterDelete) this.afterDelete();
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

    getSelectedBookmarksList() {
        const keys = Array.from(this.selectedBookmarks);
        if (this.isDirectoryView) {
            return keys
                .map(nk => this.allBookmarks.find(b => b._nodeKey === nk))
                .filter(Boolean);
        }
        return keys
            .map(url => this.allBookmarks.find(b => b.url === url))
            .filter(Boolean);
    }

    /**
     * 批量打开选中的书签
     */
    async batchOpen() {
        if (this.selectedBookmarks.size === 0) return;
        
        const urlsToOpen = this.isDirectoryView
            ? Array.from(this.selectedBookmarks)
                .map(nk => this.allBookmarks.find(b => b._nodeKey === nk)?.url)
                .filter(Boolean)
            : Array.from(this.selectedBookmarks);
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
                this.showStatus(i18n.getMessage('popup_batch_open_failed'), true);
            }
        };
        
        // 如果选中书签数量大于10，则提示用户是否要批量打开，告知可能会导致浏览器卡顿
        if (bookmarkCount > 10) {
            if (!this.showDialog || !this.showStatus) {
                logger.error('批量打开书签失败: 缺少showDialog或showStatus');
                return;
            }
            
            const confirmMessage = i18n.getMessage('popup_batch_open_warning', [bookmarkCount]);
            this.showDialog({
                title: i18n.getMessage('popup_batch_open_title'),
                message: confirmMessage,
                primaryText: i18n.getMessage('action_open'),
                secondaryText: i18n.getMessage('ui_button_cancel'),
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

        const key = this.isDirectoryView ? bookmarkItem.dataset.nodeKey : bookmarkItem.dataset.url;
        const isSelected = key ? this.selectedBookmarks.has(key) : false;
        if (isSelected) {
            checkbox.checked = true;
            bookmarkItem.classList.add('selected');
        } else {
            checkbox.checked = false;
            bookmarkItem.classList.remove('selected');
        }
    }
}
