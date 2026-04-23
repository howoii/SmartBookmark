const BrowserBookmarkSaveMode = {
    NONE: 'none',
    BROWSER: 'browser'
};

const BrowserBookmarkTargetKind = {
    FOLDER: 'folder',
    BOOKMARK: 'bookmark'
};

const BrowserBookmarkPlacement = {
    TOP: 'top',
    BOTTOM: 'bottom',
    BEFORE: 'before',
    AFTER: 'after'
};

class BrowserBookmarkSelector {
    constructor(options = {}) {
        this.root = options.root || null;
        this.directoryOnly = Boolean(options.directoryOnly);
        const initialPreference = BrowserBookmarkSelector.normalizePreference({
            mode: options.mode,
            target: options.target
        }, {
            directoryOnly: this.directoryOnly
        });
        this.mode = initialPreference.mode;
        this.target = initialPreference.target;
        this.lockMode = Boolean(options.lockMode);
        this.lockReason = options.lockReason || '';
        this.onChange = typeof options.onChange === 'function' ? options.onChange : null;
        this.recommendationProvider = typeof options.recommendationProvider === 'function'
            ? options.recommendationProvider
            : null;

        this.isExpanded = false;
        this.hasLoadedTree = false;
        this.isLoadingTree = false;
        this.childrenById = new Map();
        this.folderMetaById = new Map();
        this.nodeMetaById = new Map();
        this.expandedFolderIds = new Set();
        this.loadingFolderIds = new Set();
        this.recommendations = [];
        this.selectedRecommendationIndex = -1;
        this._autoRecommendPromise = null;
        this._hasUserInteracted = false;
        this.pendingLocateTarget = this.target;
        this.anchorElement = null;
        this.preferredVerticalPlacement = options.preferredVerticalPlacement === 'above'
            ? 'above'
            : 'auto';
        this.handleDocumentPointerDown = this.handleDocumentPointerDown.bind(this);
        this.handleDocumentKeydown = this.handleDocumentKeydown.bind(this);
        this.handleViewportChange = this.handleViewportChange.bind(this);
        this.positionUpdateFrame = 0;
        this.pendingDismissClickHandler = null;
        this.pendingDismissClickTimeout = 0;

        this.elements = {};

        if (this.root) {
            this.renderShell();
            this.bindEvents();
            this.syncView();
        }
    }

    static normalizePreference(value = {}, options = {}) {
        const mode = value.mode === BrowserBookmarkSaveMode.BROWSER
            ? BrowserBookmarkSaveMode.BROWSER
            : BrowserBookmarkSaveMode.NONE;
        if (mode === BrowserBookmarkSaveMode.NONE) {
            return { mode, target: null };
        }
        let target = BrowserBookmarkSelector.normalizeTarget(value.target);
        if (options.directoryOnly && target?.kind === BrowserBookmarkTargetKind.BOOKMARK) {
            target = BrowserBookmarkSelector.buildFolderTargetFromBookmarkTarget(target);
        }
        return { mode, target };
    }

    static async resolvePreferenceInCurrentBrowser(value = {}, options = {}) {
        const normalized = BrowserBookmarkSelector.normalizePreference(value, options);
        if (normalized.mode !== BrowserBookmarkSaveMode.BROWSER || !normalized.target) {
            return normalized;
        }

        const validation = await BrowserBookmarkSelector.validateTargetInCurrentBrowser(normalized.target);
        if (!validation.isValid || !validation.target) {
            logger.warn('Browser bookmark save target is not valid in current browser, falling back to default');
            return BrowserBookmarkSelector.normalizePreference({}, options);
        }

        return BrowserBookmarkSelector.normalizePreference({
            ...normalized,
            target: validation.target
        }, options);
    }

    static shouldPersistPreferenceAfterBookmarkSave({ isEditMode = false, bookmarkOperationResult = null } = {}) {
        if (!isEditMode) {
            return true;
        }

        return Boolean(
            bookmarkOperationResult?.chromeBookmarkMoved ||
            bookmarkOperationResult?.chromeBookmarkCreated
        );
    }

    static async savePreference(value) {
        await updateSettingsWithSync({
            display: {
                browserBookmarkSave: BrowserBookmarkSelector.buildPreferencePayload(value?.mode, value?.target)
            }
        });
    }

    static normalizeTarget(target) {
        if (!target || typeof target !== 'object') {
            return null;
        }

        const kind = target.kind === BrowserBookmarkTargetKind.BOOKMARK
            ? BrowserBookmarkTargetKind.BOOKMARK
            : BrowserBookmarkTargetKind.FOLDER;
        const placement = BrowserBookmarkSelector.getDefaultPlacement(kind, target.placement);
        const folderId = target.folderId || (kind === BrowserBookmarkTargetKind.FOLDER ? target.nodeId : target.parentId) || '';
        const parentId = target.parentId || folderId || '';

        return {
            kind,
            placement,
            nodeId: target.nodeId || '',
            parentId,
            folderId,
            title: target.title || '',
            url: target.url || '',
            pathIds: Array.isArray(target.pathIds) ? [...target.pathIds] : [],
            pathTitles: Array.isArray(target.pathTitles) ? [...target.pathTitles] : []
        };
    }

    static getDefaultPlacement(kind, placement) {
        if (kind === BrowserBookmarkTargetKind.BOOKMARK) {
            return placement === BrowserBookmarkPlacement.BEFORE
                ? BrowserBookmarkPlacement.BEFORE
                : BrowserBookmarkPlacement.AFTER;
        }
        if (placement === BrowserBookmarkPlacement.BEFORE) {
            return BrowserBookmarkPlacement.BEFORE;
        }
        if (placement === BrowserBookmarkPlacement.AFTER) {
            return BrowserBookmarkPlacement.AFTER;
        }
        if (placement === BrowserBookmarkPlacement.BOTTOM) {
            return BrowserBookmarkPlacement.BOTTOM;
        }
        if (placement === BrowserBookmarkPlacement.TOP) {
            return BrowserBookmarkPlacement.BEFORE;
        }
        return BrowserBookmarkPlacement.BOTTOM;
    }

    static buildPreferencePayload(mode, target) {
        return {
            mode: mode === BrowserBookmarkSaveMode.BROWSER
                ? BrowserBookmarkSaveMode.BROWSER
                : BrowserBookmarkSaveMode.NONE,
            target: BrowserBookmarkSelector.normalizeTarget(target)
        };
    }

    static getRootFolderDisplayName(folderId) {
        if (folderId === '1') {
            return i18n.getMessage('bookmark_save_root_bookmarks_bar');
        }
        if (folderId === '2') {
            return i18n.getMessage('bookmark_save_root_other_bookmarks');
        }
        if (folderId === '3') {
            return i18n.getMessage('bookmark_save_root_mobile_bookmarks');
        }
        return '';
    }

    /**
     * 判断给定 id 是否为已知的浏览器根文件夹（id 1/2/3）。
     * Edge 等浏览器会额外注入"工作区"之类的根文件夹，对它们返回 false。
     */
    static isKnownRootFolder(folderId) {
        return KNOWN_ROOT_BOOKMARK_FOLDER_IDS.has(folderId);
    }

    static async validateTargetInCurrentBrowser(target) {
        const normalized = BrowserBookmarkSelector.normalizeTarget(target);
        if (!normalized) {
            return {
                isValid: false,
                target: null
            };
        }

        try {
            if (normalized.kind === BrowserBookmarkTargetKind.BOOKMARK) {
                return await BrowserBookmarkSelector.validateBookmarkTargetInCurrentBrowser(normalized);
            }

            return await BrowserBookmarkSelector.validateFolderTargetInCurrentBrowser(normalized);
        } catch (error) {
            logger.debug('Target validation failed:', error);
            return {
                isValid: false,
                target: null
            };
        }
    }

    static async validateBookmarkTargetInCurrentBrowser(target) {
        const bookmarkNode = await BrowserBookmarkSelector.getBookmarkNode(target.nodeId);
        const bookmarkStillExists = bookmarkNode &&
            bookmarkNode.url &&
            (!target.url || bookmarkNode.url === target.url);

        if (!bookmarkStillExists) {
            return BrowserBookmarkSelector.validateFolderTargetInCurrentBrowser(
                BrowserBookmarkSelector.buildFolderTargetFromBookmarkTarget(target)
            );
        }

        if ((bookmarkNode.parentId || '') !== (target.folderId || '')) {
            const parentFolderNode = await BrowserBookmarkSelector.getBookmarkNode(bookmarkNode.parentId);
            if (!parentFolderNode || parentFolderNode.url) {
                return {
                    isValid: false,
                    target: null
                };
            }

            return {
                isValid: true,
                target: await BrowserBookmarkSelector.buildTargetFromFolderNode(parentFolderNode)
            };
        }

        const folderValidation = await BrowserBookmarkSelector.validateFolderTargetInCurrentBrowser(
            BrowserBookmarkSelector.buildFolderTargetFromBookmarkTarget(target)
        );
        if (!folderValidation.isValid || !folderValidation.target) {
            return {
                isValid: false,
                target: null
            };
        }

        const actualBookmarkTarget = await BrowserBookmarkSelector.buildTargetFromBookmarkNode(bookmarkNode);
        return {
            isValid: true,
            target: {
                ...actualBookmarkTarget,
                placement: folderValidation.changed
                    ? BrowserBookmarkSelector.getDefaultPlacement(BrowserBookmarkTargetKind.BOOKMARK)
                    : BrowserBookmarkSelector.getDefaultPlacement(BrowserBookmarkTargetKind.BOOKMARK, target.placement)
            }
        };
    }

    static async validateFolderTargetInCurrentBrowser(target) {
        const normalized = BrowserBookmarkSelector.normalizeTarget(target);
        if (!normalized) {
            return {
                isValid: false,
                target: null,
                changed: true
            };
        }

        const folderId = normalized.folderId || normalized.nodeId || normalized.pathIds?.[normalized.pathIds.length - 1];
        if (!folderId) {
            return {
                isValid: false,
                target: null,
                changed: true
            };
        }

        const folderNode = await BrowserBookmarkSelector.getBookmarkNode(folderId);
        if (!folderNode || folderNode.url) {
            return {
                isValid: false,
                target: null,
                changed: true
            };
        }

        const isRoot = BrowserBookmarkSelector.isRootFolder(normalized);
        if (!isRoot) {
            if (normalized.title !== folderNode.title) {
                return {
                    isValid: false,
                    target: null,
                    changed: true
                };
            }
        }

        const actualTarget = await BrowserBookmarkSelector.buildTargetFromFolderNode(folderNode);
        const changed = !BrowserBookmarkSelector.areStringArraysEqual(normalized.pathIds, actualTarget.pathIds);

        return {
            isValid: true,
            target: changed
                ? actualTarget
                : {
                    ...normalized,
                    parentId: actualTarget.parentId,
                    folderId: actualTarget.folderId,
                    title: actualTarget.title,
                    pathIds: [...actualTarget.pathIds],
                    pathTitles: [...actualTarget.pathTitles],
                    placement: BrowserBookmarkSelector.getDefaultPlacement(BrowserBookmarkTargetKind.FOLDER, normalized.placement)
                },
            changed
        };
    }

    static async getBookmarkNode(nodeId) {
        if (!nodeId) return null;

        try {
            const [node] = await chrome.bookmarks.get(nodeId);
            return node || null;
        } catch (error) {
            return null;
        }
    }

    static getFolderDisplayNameFromNode(node) {
        if (!node) return '';
        return BrowserBookmarkSelector.getRootFolderDisplayName(node.id) || node.title || '';
    }

    static isRootFolder(target) {
        return !target.parentId || target.parentId === '0';
    }

    static areStringArraysEqual(left, right) {
        if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) {
            return false;
        }

        return left.every((value, index) => value === right[index]);
    }

    static summarizePathSegments(segments = []) {
        logger.debug('summarizePathSegments', segments);
        const filtered = segments.filter(Boolean);
        if (filtered.length <= 3) {
            return filtered.join('/');
        }

        return `.../${filtered.slice(-3).join('/')}`;
    }

    static buildFolderTargetFromBookmarkTarget(target) {
        const normalized = BrowserBookmarkSelector.normalizeTarget(target);
        if (!normalized) return null;

        const folderPathIds = Array.isArray(normalized.pathIds) && normalized.pathIds.length > 0
            ? normalized.pathIds.slice(0, -1)
            : [];
        const folderId = normalized.folderId || normalized.parentId || folderPathIds[folderPathIds.length - 1] || '';

        return BrowserBookmarkSelector.normalizeTarget({
            kind: BrowserBookmarkTargetKind.FOLDER,
            nodeId: folderId,
            folderId,
            parentId: folderPathIds.length > 1 ? folderPathIds[folderPathIds.length - 2] : '0',
            placement: BrowserBookmarkSelector.getDefaultPlacement(BrowserBookmarkTargetKind.FOLDER),
            title: normalized.pathTitles?.[normalized.pathTitles.length - 1] || '',
            pathIds: folderPathIds,
            pathTitles: Array.isArray(normalized.pathTitles) ? [...normalized.pathTitles] : []
        });
    }

    static async buildTargetFromFolderNode(folderNode) {
        const pathInfo = await BrowserBookmarkSelector.buildNodePathInfo(folderNode);
        return BrowserBookmarkSelector.normalizeTarget({
            kind: BrowserBookmarkTargetKind.FOLDER,
            nodeId: folderNode.id,
            parentId: folderNode.parentId || '',
            folderId: folderNode.id,
            placement: BrowserBookmarkSelector.getDefaultPlacement(BrowserBookmarkTargetKind.FOLDER),
            title: BrowserBookmarkSelector.getFolderDisplayNameFromNode(folderNode),
            pathIds: pathInfo.pathIds,
            pathTitles: pathInfo.pathTitles
        });
    }

    static async buildTargetFromBookmarkNode(bookmarkNode) {
        const pathInfo = await BrowserBookmarkSelector.buildNodePathInfo(bookmarkNode);
        return BrowserBookmarkSelector.normalizeTarget({
            kind: BrowserBookmarkTargetKind.BOOKMARK,
            nodeId: bookmarkNode.id,
            parentId: bookmarkNode.parentId || '',
            folderId: bookmarkNode.parentId || '',
            placement: BrowserBookmarkSelector.getDefaultPlacement(BrowserBookmarkTargetKind.BOOKMARK),
            title: bookmarkNode.title || bookmarkNode.url || '',
            url: bookmarkNode.url || '',
            pathIds: pathInfo.pathIds,
            pathTitles: pathInfo.pathTitles
        });
    }

    static async buildNodePathInfo(node) {
        const pathIds = [];
        const pathTitles = [];
        let current = node;

        while (current) {
            pathIds.unshift(current.id);

            if (!current.parentId || current.parentId === '0') {
                break;
            }

            if (!current.url) {
                const displayName = BrowserBookmarkSelector.getFolderDisplayNameFromNode(current);
                if (displayName) {
                    pathTitles.unshift(displayName);
                }
            }


            current = await BrowserBookmarkSelector.getBookmarkNode(current.parentId);
        }

        return { pathIds, pathTitles };
    }

    renderShell() {
        this.root.innerHTML = `
            <section class="browser-bookmark-selector">
                <div class="browser-bookmark-selector-panel">
                    <div class="browser-bookmark-selector-summary">
                        <div
                            class="browser-bookmark-selector-summary-title"
                            data-i18n-title="bookmark_save_target_title"
                            data-i18n-aria-label="bookmark_save_target_title"
                            title=""
                            aria-label=""
                        >
                            <span class="browser-bookmark-selector-summary-title-icon" aria-hidden="true">
                                <svg viewBox="0 0 24 24" width="18" height="18">
                                    <path fill="currentColor" d="M10,4H4C2.89,4 2,4.89 2,6V18A2,2 0 0,0 4,20H20A2,2 0 0,0 22,18V8C22,6.89 21.1,6 20,6H12L10,4Z"/>
                                </svg>
                            </span>
                            <span class="browser-bookmark-selector-summary-title-accent" aria-hidden="true"></span>
                        </div>
                        <div class="browser-bookmark-selector-control">
                            <button type="button" class="browser-bookmark-selector-toggle">
                                <span class="browser-bookmark-selector-summary-text">
                                    <span class="browser-bookmark-selector-summary-meta"></span>
                                    <span class="browser-bookmark-selector-summary-value"></span>
                                </span>
                                <span class="browser-bookmark-selector-toggle-icon" aria-hidden="true">
                                    <svg viewBox="0 0 24 24" width="18" height="18">
                                        <path fill="currentColor" d="M7 10l5 5 5-5z"></path>
                                    </svg>
                                </span>
                            </button>
                            <button type="button" class="browser-bookmark-selector-clear" hidden data-i18n-title="bookmark_save_target_disable" title="">
                                <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
                                    <path fill="currentColor" d="M18.3 5.71L12 12l6.3 6.29-1.41 1.41L10.59 13.41 4.29 19.71 2.88 18.3 9.17 12 2.88 5.71 4.29 4.29l6.3 6.3 6.29-6.3z"></path>
                                </svg>
                            </button>
                        </div>
                    </div>
                    <div class="browser-bookmark-selector-content" hidden>
                        <div class="browser-bookmark-selector-state"></div>
                        <div class="browser-bookmark-selector-tree"></div>
                        <div class="browser-bookmark-selector-recommendations" hidden></div>
                    </div>
                </div>
            </section>
        `;

        this.elements = {
            panel: this.root.querySelector('.browser-bookmark-selector-panel'),
            control: this.root.querySelector('.browser-bookmark-selector-control'),
            summaryTitle: this.root.querySelector('.browser-bookmark-selector-summary-title'),
            summaryMeta: this.root.querySelector('.browser-bookmark-selector-summary-meta'),
            summaryValue: this.root.querySelector('.browser-bookmark-selector-summary-value'),
            clearButton: this.root.querySelector('.browser-bookmark-selector-clear'),
            toggleButton: this.root.querySelector('.browser-bookmark-selector-toggle'),
            content: this.root.querySelector('.browser-bookmark-selector-content'),
            state: this.root.querySelector('.browser-bookmark-selector-state'),
            tree: this.root.querySelector('.browser-bookmark-selector-tree'),
            recommendations: this.root.querySelector('.browser-bookmark-selector-recommendations')
        };

        i18n.updateNodeText(this.root);
    }

    bindEvents() {
        this.elements.toggleButton.addEventListener('click', () => {
            void this.toggleExpanded();
        });

        this.elements.clearButton.addEventListener('click', event => {
            event.stopPropagation();
            if (this.lockMode) return;
            this.setMode(BrowserBookmarkSaveMode.NONE);
        });

        // Recommendation events are bound dynamically in bindRecommendationEvents()
    }

    async setMode(mode) {
        this.mode = mode === BrowserBookmarkSaveMode.BROWSER
            ? BrowserBookmarkSaveMode.BROWSER
            : BrowserBookmarkSaveMode.NONE;

        if (this.mode !== BrowserBookmarkSaveMode.BROWSER) {
            this.closePopover();
        } else if (!this.target) {
            this.target = await this.getFallbackTarget();
        }

        this.syncView();

        if (this.mode === BrowserBookmarkSaveMode.BROWSER) {
            void this.ensureTreeLoaded();
            void this.refreshRecommendations();
        }

        this.emitChange();
    }

    setLockMode(lockMode, reason = '') {
        this.lockMode = Boolean(lockMode);
        this.lockReason = reason || '';
        this.syncView();
    }

    setValue(value = {}) {
        const normalized = BrowserBookmarkSelector.normalizePreference(value, {
            directoryOnly: this.directoryOnly
        });
        this.mode = normalized.mode;
        this.target = normalized.target;
        this.pendingLocateTarget = this.target;
        this.syncView();
    }

    getValue() {
        return BrowserBookmarkSelector.buildPreferencePayload(this.mode, this.target);
    }

    setAnchorElement(element) {
        this.anchorElement = element || null;
        this.schedulePopoverPositionUpdate();
    }

    clearAnchorElement() {
        this.anchorElement = null;
        this.schedulePopoverPositionUpdate();
    }

    async getFallbackTarget() {
        try {
            const [node] = await chrome.bookmarks.get('1');
            if (!node || node.url) {
                return null;
            }
            return await BrowserBookmarkSelector.buildTargetFromFolderNode(node);
        } catch (error) {
            logger.debug('Error getting fallback target:', error);
            return null;
        }
    }

    async toggleExpanded() {
        if (this.lockMode && this.mode !== BrowserBookmarkSaveMode.BROWSER) {
            return;
        }

        this._hasUserInteracted = true;

        if (this.mode !== BrowserBookmarkSaveMode.BROWSER) {
            this.mode = BrowserBookmarkSaveMode.BROWSER;
            if (!this.target) {
                this.target = await this.getFallbackTarget();
            }
        }

        this.isExpanded = !this.isExpanded;
        this.elements.content.hidden = !this.isExpanded;
        this.syncView();

        if (this.isExpanded) {
            this.resetTreeCache();
            this.attachPopoverListeners();
            this.schedulePopoverPositionUpdate();
            await this.ensureTreeLoaded();
            await this.refreshRecommendations();
        } else {
            this.detachPopoverListeners();
            this.resetPopoverPosition();
        }

        this.emitChange();
    }

    async openPopover() {
        if (this.mode !== BrowserBookmarkSaveMode.BROWSER) {
            this.mode = BrowserBookmarkSaveMode.BROWSER;
            if (!this.target) {
                this.target = await this.getFallbackTarget();
            }
        }

        if (this.isExpanded) {
            this.schedulePopoverPositionUpdate();
            await this.ensureTreeLoaded();
            await this.refreshRecommendations();
            return;
        }

        this.isExpanded = true;
        this.elements.content.hidden = false;
        this.syncView();
        this.resetTreeCache();
        this.attachPopoverListeners();
        this.schedulePopoverPositionUpdate();
        await this.ensureTreeLoaded();
        await this.refreshRecommendations();
        this.emitChange();
    }

    resetTreeCache() {
        this.hasLoadedTree = false;
        this.isLoadingTree = false;
        this.childrenById.clear();
        this.folderMetaById.clear();
        this.nodeMetaById.clear();
        this.expandedFolderIds.clear();
        this.pendingLocateTarget = this.target;
        if (this.elements?.tree) {
            this.elements.tree.innerHTML = '';
        }
    }

    async ensureTreeLoaded() {
        if (this.hasLoadedTree || this.isLoadingTree) {
            if (this.pendingLocateTarget && this.hasLoadedTree) {
                await this.locateTarget(this.pendingLocateTarget);
            }
            return;
        }

        this.isLoadingTree = true;
        this.renderState(i18n.getMessage('bookmark_save_target_loading'));
        this.elements.tree.innerHTML = '';

        try {
            const [root] = await chrome.bookmarks.getTree();
            const rootChildren = (root?.children || []).filter(node =>
                node && !node.url && BrowserBookmarkSelector.isKnownRootFolder(node.id)
            );
            this.childrenById.set('0', rootChildren.map(node => node.id));
            rootChildren.forEach(node => this.cacheTreeSubtree(node, []));

            if (!this.target && rootChildren.length > 0) {
                this.target = this.buildTargetFromFolder(this.folderMetaById.get(rootChildren[0].id));
            }

            this.hasLoadedTree = true;
            this.isLoadingTree = false;
            this.renderState('');
            await this.renderTree();
            await this.locateTarget(this.pendingLocateTarget || this.target);
        } catch (error) {
            this.isLoadingTree = false;
            logger.error('加载浏览器收藏夹目录失败:', error);
            this.renderState(i18n.getMessage('bookmark_save_target_load_failed', [error.message || '']));
        }
    }

    async ensureFolderChildren(folderId) {
        if (this.childrenById.has(folderId) || this.loadingFolderIds.has(folderId)) {
            return;
        }

        this.loadingFolderIds.add(folderId);
        try {
            const children = await chrome.bookmarks.getChildren(folderId);
            this.childrenById.set(folderId, children.map(node => node.id));
            const parentMeta = this.folderMetaById.get(folderId);
            const parentPathIds = parentMeta?.pathIds || [];
            children.forEach(node => this.cacheNodeMeta(node, parentPathIds));
        } finally {
            this.loadingFolderIds.delete(folderId);
        }
    }

    cacheNodeMeta(node, parentPathIds) {
        const pathIds = [...parentPathIds, node.id];
        const meta = {
            id: node.id,
            parentId: node.parentId || '',
            title: node.title || '',
            url: node.url || '',
            index: node.index ?? 0,
            kind: node.url ? BrowserBookmarkTargetKind.BOOKMARK : BrowserBookmarkTargetKind.FOLDER,
            pathIds
        };
        if (meta.kind === BrowserBookmarkTargetKind.FOLDER) {
            meta.title = BrowserBookmarkSelector.getFolderDisplayNameFromNode(node);
        }
        this.nodeMetaById.set(node.id, meta);

        if (meta.kind === BrowserBookmarkTargetKind.FOLDER) {
            const parentMeta = node.parentId ? this.folderMetaById.get(node.parentId) : null;
            const pathTitles = parentMeta?.pathTitles ? [...parentMeta.pathTitles] : [];
            if (node.title && node.parentId && node.parentId !== '0') {
                pathTitles.push(node.title);
            }
            this.folderMetaById.set(node.id, { ...meta, pathTitles });
        }
    }

    cacheTreeSubtree(node, parentPathIds) {
        if (!node?.id) {
            return;
        }

        this.cacheNodeMeta(node, parentPathIds);
        if (node.url) {
            return;
        }

        const childNodes = Array.isArray(node.children) ? node.children : [];
        this.childrenById.set(node.id, childNodes.map(child => child.id));
        const pathIds = [...parentPathIds, node.id];
        childNodes.forEach(child => this.cacheTreeSubtree(child, pathIds));
    }

    getRenderableChildIds(folderId) {
        const childIds = this.childrenById.get(folderId) || [];
        if (!this.directoryOnly) {
            return childIds;
        }

        return childIds.filter(id => this.nodeMetaById.get(id)?.kind === BrowserBookmarkTargetKind.FOLDER);
    }

    canFolderExpand(folderId) {
        if (!folderId) {
            return false;
        }

        if (!this.directoryOnly) {
            return true;
        }

        if (!this.childrenById.has(folderId)) {
            return true;
        }

        return this.getRenderableChildIds(folderId).length > 0;
    }

    async resolveTargetAgainstLoadedTree(target) {
        const normalized = BrowserBookmarkSelector.normalizeTarget(target);
        if (!normalized) return null;

        if (normalized.nodeId && this.nodeMetaById.has(normalized.nodeId)) {
            return normalized;
        }
        return null;
    }

    async renderTree() {
        const rootIds = this.childrenById.get('0') || [];
        if (!rootIds.length) {
            this.elements.tree.innerHTML = `<div class="browser-bookmark-selector-empty" data-i18n="bookmark_save_target_empty"></div>`;
            i18n.updateNodeText(this.elements.tree);
            return;
        }

        const markup = await Promise.all(rootIds.map(id => this.renderNode(id, 0)));
        this.elements.tree.innerHTML = markup.join('');
        i18n.updateNodeText(this.elements.tree);
        this.bindTreeEvents();
        this.highlightSelectedTarget();
        this.schedulePopoverPositionUpdate();
    }

    async renderNode(nodeId, depth) {
        const meta = this.nodeMetaById.get(nodeId);
        if (!meta) return '';

        if (meta.kind === BrowserBookmarkTargetKind.BOOKMARK) {
            if (this.directoryOnly) {
                return '';
            }
            const target = this.buildTargetFromBookmark(meta);
            return `
                <div class="browser-bookmark-node browser-bookmark-node-bookmark" data-node-id="${meta.id}">
                    <div class="browser-bookmark-node-main">
                        <button type="button" class="browser-bookmark-node-label" data-select-bookmark="${meta.id}" style="padding-left:${12 + depth * 18}px">
                            <span class="browser-bookmark-node-icon browser-bookmark-node-icon-bookmark" aria-hidden="true"></span>
                            <span class="browser-bookmark-node-text">${this.escapeHtml(meta.title || meta.url)}</span>
                        </button>
                        ${this.renderPlacementButtons(target)}
                    </div>
                </div>
            `;
        }

        const canExpand = this.canFolderExpand(meta.id);
        const isExpanded = canExpand && this.expandedFolderIds.has(meta.id);
        const childIds = this.getRenderableChildIds(meta.id);
        const target = this.buildTargetFromFolder(meta);
        const childrenMarkup = isExpanded && this.childrenById.has(meta.id)
            ? (await Promise.all(childIds.map(id => this.renderNode(id, depth + 1)))).join('')
            : '';
        const folderIndent = `margin-left:${depth * 18}px`;
        const folderToggleMarkup = canExpand
            ? `
                    <button type="button" class="browser-bookmark-folder-toggle ${isExpanded ? 'expanded' : ''}" data-toggle-folder="${meta.id}" style="${folderIndent}">
                        <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
                            <path fill="currentColor" d="M8.59 16.59L13.17 12L8.59 7.41L10 6l6 6-6 6z"></path>
                        </svg>
                    </button>
                `
            : `<span class="browser-bookmark-folder-toggle-spacer" aria-hidden="true" style="${folderIndent}"></span>`;

        return `
            <div class="browser-bookmark-node browser-bookmark-node-folder" data-node-id="${meta.id}">
                <div class="browser-bookmark-node-main">
                    ${folderToggleMarkup}
                    <button type="button" class="browser-bookmark-node-label browser-bookmark-folder-label" data-select-folder="${meta.id}">
                        <span class="browser-bookmark-node-icon browser-bookmark-node-icon-folder" aria-hidden="true"></span>
                        <span class="browser-bookmark-node-text">${this.escapeHtml(meta.title || i18n.getMessage('bookmark_save_target_unnamed_folder'))}</span>
                    </button>
                    ${this.renderPlacementButtons(target)}
                </div>
                <div class="browser-bookmark-node-children ${isExpanded ? '' : 'hidden'}" data-folder-children="${meta.id}">
                    ${isExpanded && !this.childrenById.has(meta.id) ? `<div class="browser-bookmark-node-loading" data-i18n="bookmark_save_target_loading"></div>` : childrenMarkup}
                </div>
            </div>
        `;
    }

    renderPlacementButtons(target) {
        if (this.directoryOnly) {
            return '';
        }

        if (
            target?.kind === BrowserBookmarkTargetKind.FOLDER
            && BrowserBookmarkSelector.isRootFolder(target)
        ) {
            return '';
        }

        const actions = [
            {
                placement: BrowserBookmarkPlacement.BEFORE,
                i18nKey: 'bookmark_save_target_before',
                iconPath: 'M12 18V6M7 11l5-5 5 5'
            },
            {
                placement: BrowserBookmarkPlacement.AFTER,
                i18nKey: 'bookmark_save_target_after',
                iconPath: 'M12 6v12M7 13l5 5 5-5'
            }
        ];

        return `
            <div class="browser-bookmark-placement-group">
                ${actions.map(action => `
                    <button
                        type="button"
                        class="browser-bookmark-placement-btn"
                        data-apply-target='${this.escapeAttribute(JSON.stringify({ ...target, placement: action.placement }))}'
                        data-i18n-title="${action.i18nKey}"
                        title=""
                    >
                        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
                            <path d="${action.iconPath}" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"></path>
                        </svg>
                    </button>
                `).join('')}
            </div>
        `;
    }

    bindTreeEvents() {
        this.elements.tree.querySelectorAll('[data-toggle-folder]').forEach(button => {
            button.addEventListener('click', async () => {
                const folderId = button.dataset.toggleFolder;
                if (!folderId) return;
                if (this.expandedFolderIds.has(folderId)) {
                    this.expandedFolderIds.delete(folderId);
                } else {
                    this.expandedFolderIds.add(folderId);
                    await this.ensureFolderChildren(folderId);
                }
                await this.renderTree();
            });
        });

        this.elements.tree.querySelectorAll('[data-select-folder]').forEach(button => {
            button.addEventListener('click', () => {
                const folderMeta = this.folderMetaById.get(button.dataset.selectFolder);
                if (folderMeta) {
                    this.applyTarget(this.buildTargetFromFolder(folderMeta), { expand: true });
                }
            });
        });

        this.elements.tree.querySelectorAll('[data-select-bookmark]').forEach(button => {
            button.addEventListener('click', () => {
                const bookmarkMeta = this.nodeMetaById.get(button.dataset.selectBookmark);
                if (bookmarkMeta) {
                    this.applyTarget(this.buildTargetFromBookmark(bookmarkMeta), { expand: true });
                }
            });
        });

        this.elements.tree.querySelectorAll('[data-apply-target]').forEach(button => {
            button.addEventListener('click', event => {
                event.stopPropagation();
                try {
                    this.applyTarget(JSON.parse(button.dataset.applyTarget), { expand: true });
                } catch (error) {
                    logger.error('解析浏览器收藏夹目标失败:', error);
                }
            });
        });
    }

    buildTargetFromFolder(folderMeta) {
        return BrowserBookmarkSelector.normalizeTarget({
            kind: BrowserBookmarkTargetKind.FOLDER,
            nodeId: folderMeta.id,
            parentId: folderMeta.parentId || '',
            folderId: folderMeta.id,
            placement: BrowserBookmarkPlacement.BOTTOM,
            title: this.getFolderDisplayName(folderMeta),
            pathIds: [...(folderMeta.pathIds || [])],
            pathTitles: [...(folderMeta.pathTitles || [])]
        });
    }

    buildTargetFromBookmark(bookmarkMeta) {
        const parentFolder = this.folderMetaById.get(bookmarkMeta.parentId);
        return BrowserBookmarkSelector.normalizeTarget({
            kind: BrowserBookmarkTargetKind.BOOKMARK,
            nodeId: bookmarkMeta.id,
            parentId: bookmarkMeta.parentId || '',
            folderId: bookmarkMeta.parentId || '',
            placement: BrowserBookmarkPlacement.AFTER,
            title: bookmarkMeta.title || bookmarkMeta.url || '',
            url: bookmarkMeta.url || '',
            pathIds: [...(bookmarkMeta.pathIds || [])],
            pathTitles: parentFolder?.pathTitles ? [...parentFolder.pathTitles] : []
        });
    }

    applyTarget(target, options = {}) {
        this._hasUserInteracted = true;
        const normalized = BrowserBookmarkSelector.normalizePreference({
            mode: BrowserBookmarkSaveMode.BROWSER,
            target
        }, {
            directoryOnly: this.directoryOnly
        });
        this.target = normalized.target;
        this.mode = normalized.mode;
        if (options.expand) {
            this.isExpanded = true;
            this.elements.content.hidden = false;
        }
        this.syncView();
        this.highlightSelectedTarget();
        this.emitChange();

        if (options.locate) {
            void this.locateTarget(this.target);
        }

        this.closePopover();
    }

    async locateTarget(target) {
        const normalized = await this.resolveTargetAgainstLoadedTree(target);
        if (!normalized || !this.hasLoadedTree) return;

        this.pendingLocateTarget = null;
        const folderIds = normalized.pathIds.slice(0, -1);

        for (const folderId of folderIds) {
            if (!folderId || folderId === '0') continue;
            this.expandedFolderIds.add(folderId);
            await this.ensureFolderChildren(folderId);
        }

        await this.renderTree();
        const row = this.elements.tree.querySelector(`[data-node-id="${normalized.nodeId}"]`);
        if (row) {
            row.classList.add('active');
            row.scrollIntoView({ block: 'nearest' });
        }
    }

    highlightSelectedTarget() {
        this.elements.tree.querySelectorAll('.browser-bookmark-node').forEach(node => node.classList.remove('active'));
        if (!this.target?.nodeId) return;
        const row = this.elements.tree.querySelector(`[data-node-id="${this.target.nodeId}"]`);
        if (row) row.classList.add('active');
    }

    async refreshRecommendations(context = null) {
        if (!this.recommendationProvider || this.mode !== BrowserBookmarkSaveMode.BROWSER) {
            this.setRecommendations([]);
            return;
        }

        if (this.recommendations.length > 0) {
            this.setRecommendations(this.recommendations);
            return;
        }

        try {
            const result = await this.recommendationProvider(context || this.getValue());
            const recs = Array.isArray(result) ? result : [];
            this.recommendations = recs.filter(item => item?.target);
            this.setRecommendations(this.recommendations);
        } catch (error) {
            logger.error('加载浏览器收藏夹推荐目录失败:', error);
            this.setRecommendations([]);
        }
    }

    clearRecommendations() {
        this.setRecommendations([]);
    }

    setRecommendations(recommendations) {
        this.recommendations = Array.isArray(recommendations) ? recommendations.filter(item => item?.target) : [];
        this.selectedRecommendationIndex = -1;

        if (!this.recommendations.length || this.mode !== BrowserBookmarkSaveMode.BROWSER) {
            this.elements.recommendations.hidden = true;
            this.elements.recommendations.innerHTML = '';
            return;
        }

        this.elements.recommendations.hidden = false;
        this.elements.recommendations.innerHTML = `
            <div class="browser-bookmark-recommendations-strip">
                <button type="button" class="browser-bookmark-recommendations-arrow arrow-left" disabled aria-label="Previous">
                    <svg viewBox="0 0 24 24" width="14" height="14"><path fill="currentColor" d="M15.41 7.41L14 6l-6 6 6 6 1.41-1.41L10.83 12z"/></svg>
                </button>
                <div class="browser-bookmark-recommendations-track">
                    ${this.recommendations.map((item, index) => {
                        const shortName = this.escapeHtml(item.shortLabel || item.label?.split(' › ').pop() || '');
                        const shortDesc = this.escapeHtml(item.shortDescription || '');
                        const tooltip = this.escapeHtml((item.label || '') + (item.description ? ' — ' + item.description : ''));
                        return `<button type="button" class="browser-bookmark-recommendation" data-index="${index}" title="${tooltip}">
                            <span class="browser-bookmark-recommendation-title">${shortName}</span>${shortDesc ? `<span class="browser-bookmark-recommendation-desc">${shortDesc}</span>` : ''}
                        </button>`;
                    }).join('')}
                </div>
                <button type="button" class="browser-bookmark-recommendations-arrow arrow-right" ${this.recommendations.length <= 1 ? 'disabled' : ''} aria-label="Next">
                    <svg viewBox="0 0 24 24" width="14" height="14"><path fill="currentColor" d="M8.59 16.59L10 18l6-6-6-6-1.41 1.41L13.17 12z"/></svg>
                </button>
            </div>
        `;
        this.bindRecommendationEvents();
        this.schedulePopoverPositionUpdate();
    }

    bindRecommendationEvents() {
        const strip = this.elements.recommendations.querySelector('.browser-bookmark-recommendations-strip');
        if (!strip) return;

        const track = strip.querySelector('.browser-bookmark-recommendations-track');
        const arrowLeft = strip.querySelector('.arrow-left');
        const arrowRight = strip.querySelector('.arrow-right');

        const selectRecommendation = (index) => {
            if (index < 0 || index >= this.recommendations.length) return;
            this.selectedRecommendationIndex = index;

            track.querySelectorAll('.browser-bookmark-recommendation').forEach((btn, i) => {
                btn.classList.toggle('active', i === index);
                if (i === index) btn.scrollIntoView({ inline: 'nearest', block: 'nearest' });
            });

            arrowLeft.disabled = index <= 0;
            arrowRight.disabled = index >= this.recommendations.length - 1;

            const recommendation = this.recommendations[index];
            if (recommendation?.target) {
                this.selectRecommendationTarget(recommendation.target);
            }
        };

        track.addEventListener('click', (event) => {
            const button = event.target.closest('.browser-bookmark-recommendation');
            if (!button) return;
            selectRecommendation(Number(button.dataset.index || '0'));
        });

        arrowLeft.addEventListener('click', () => {
            selectRecommendation(Math.max(0, this.selectedRecommendationIndex - 1));
        });

        arrowRight.addEventListener('click', () => {
            selectRecommendation(Math.min(this.recommendations.length - 1, this.selectedRecommendationIndex + 1));
        });
    }

    selectRecommendationTarget(target) {
        const normalized = BrowserBookmarkSelector.normalizePreference({
            mode: BrowserBookmarkSaveMode.BROWSER,
            target
        }, { directoryOnly: this.directoryOnly });

        this.target = normalized.target;
        this.mode = normalized.mode;
        this.syncView();
        this.highlightSelectedTarget();
        this.emitChange();
        void this.locateTarget(this.target);
    }

    autoRecommend() {
        if (this._autoRecommendPromise) return this._autoRecommendPromise;
        if (!this.recommendationProvider || this.mode !== BrowserBookmarkSaveMode.BROWSER || this.lockMode) {
            return Promise.resolve();
        }
        if (this.isExpanded) return Promise.resolve();

        this._hasUserInteracted = false;

        this._autoRecommendPromise = this.recommendationProvider(this.getValue())
            .then(result => {
                const recs = Array.isArray(result) ? result.filter(item => item?.target) : [];
                this.recommendations = recs;

                if (recs.length > 0 && !this._hasUserInteracted) {
                    this.selectRecommendationTarget(recs[0].target);
                }
            })
            .catch(error => {
                logger.error('autoRecommend 失败:', error);
            })
            .finally(() => {
                this._autoRecommendPromise = null;
            });

        return this._autoRecommendPromise;
    }

    renderState(message) {
        this.elements.state.textContent = message || '';
        this.elements.state.style.display = message ? 'block' : 'none';
        this.schedulePopoverPositionUpdate();
    }

    syncView() {
        const isBrowserMode = this.mode === BrowserBookmarkSaveMode.BROWSER;
        const summaryState = this.getSummaryState();
        const summaryMeta = this.getSummaryMeta(summaryState);
        const summaryValue = this.describeTarget(this.target, this.mode);
        const showClearButton = isBrowserMode && !this.lockMode;
        this.root.classList.toggle('browser-bookmark-selector-enabled', isBrowserMode);
        this.root.classList.toggle('browser-bookmark-selector-locked', this.lockMode);
        this.root.dataset.summaryState = summaryState;
        this.elements.content.hidden = !this.isExpanded;
        this.elements.summaryTitle.dataset.summaryState = summaryState;
        this.elements.toggleButton.dataset.summaryState = summaryState;
        this.elements.summaryMeta.textContent = summaryMeta;
        this.elements.summaryValue.textContent = summaryValue;
        this.elements.summaryValue.title = this.describeTarget(this.target, this.mode, { condensed: false });
        this.elements.clearButton.hidden = false;
        this.elements.clearButton.style.display = showClearButton ? 'inline-flex' : 'none';
        this.elements.toggleButton.classList.toggle('active', this.isExpanded);
        this.elements.toggleButton.classList.toggle('browser-bookmark-selector-toggle-has-clear', showClearButton);

        if (this.isExpanded) {
            this.schedulePopoverPositionUpdate();
        }
    }

    getSummaryState(mode = this.mode) {
        if (mode !== BrowserBookmarkSaveMode.BROWSER) {
            return 'disabled';
        }

        return this.lockMode ? 'existing' : 'pending';
    }

    getSummaryMeta(summaryState = this.getSummaryState()) {
        if (summaryState === 'existing') {
            return i18n.getMessage('bookmark_save_target_state_existing');
        }

        if (summaryState === 'pending') {
            return i18n.getMessage('bookmark_save_target_state_pending');
        }

        return i18n.getMessage('bookmark_save_target_state_disabled');
    }

    getTargetPathSegments(target) {
        const normalized = BrowserBookmarkSelector.normalizeTarget(target);
        if (!normalized) {
            return [];
        }

        const segments = [];
        const rootId = normalized.pathIds?.[0] || '';
        const rootTitle = BrowserBookmarkSelector.getRootFolderDisplayName(rootId);
        if (rootTitle) {
            segments.push(rootTitle);
        }

        const dedupedPathTitles = Array.isArray(normalized.pathTitles) ? [...normalized.pathTitles] : [];
        if (dedupedPathTitles.length > 0) {
            segments.push(...dedupedPathTitles);
        }

        return segments.filter(Boolean);
    }

    describeTarget(target, mode = this.mode, options = {}) {
        if (mode !== BrowserBookmarkSaveMode.BROWSER) {
            return i18n.getMessage('bookmark_save_target_disabled_desc');
        }

        const normalized = BrowserBookmarkSelector.normalizeTarget(target);
        if (!normalized) {
            return i18n.getMessage('bookmark_save_target_not_selected');
        }

        const segments = this.getTargetPathSegments(normalized);
        if (segments.length > 0) {
            return options.condensed === false
                ? segments.join('/')
                : BrowserBookmarkSelector.summarizePathSegments(segments);
        }

        if (normalized.kind === BrowserBookmarkTargetKind.BOOKMARK) {
            return normalized.pathTitles?.[normalized.pathTitles.length - 1] ||
                i18n.getMessage('bookmark_save_target_unnamed_folder');
        }

        return normalized.title ||
            normalized.pathTitles?.[normalized.pathTitles.length - 1] ||
            i18n.getMessage('bookmark_save_target_unnamed_folder');
    }

    getFolderDisplayName(folderMeta) {
        if (!folderMeta) {
            return i18n.getMessage('bookmark_save_target_unnamed_folder');
        }

        const rootTitle = BrowserBookmarkSelector.getRootFolderDisplayName(folderMeta.id);
        if (rootTitle) {
            return rootTitle;
        }

        if (folderMeta.title) {
            return folderMeta.title;
        }

        return i18n.getMessage('bookmark_save_target_unnamed_folder');
    }

    emitChange() {
        if (this.onChange) {
            this.onChange(this.getValue());
        }
    }

    closePopover() {
        this.isExpanded = false;
        this.elements.content.hidden = true;
        this.detachPopoverListeners();
        this.resetPopoverPosition();
        this.syncView();
    }

    attachPopoverListeners() {
        document.addEventListener('pointerdown', this.handleDocumentPointerDown, true);
        document.addEventListener('keydown', this.handleDocumentKeydown, true);
        document.addEventListener('scroll', this.handleViewportChange, true);
        window.addEventListener('resize', this.handleViewportChange);
    }

    detachPopoverListeners() {
        document.removeEventListener('pointerdown', this.handleDocumentPointerDown, true);
        document.removeEventListener('keydown', this.handleDocumentKeydown, true);
        document.removeEventListener('scroll', this.handleViewportChange, true);
        window.removeEventListener('resize', this.handleViewportChange);
    }

    handleViewportChange() {
        this.schedulePopoverPositionUpdate();
    }

    schedulePopoverPositionUpdate() {
        if (!this.isExpanded || !this.elements?.content || this.elements.content.hidden) {
            return;
        }

        if (this.positionUpdateFrame) {
            cancelAnimationFrame(this.positionUpdateFrame);
        }

        this.positionUpdateFrame = requestAnimationFrame(() => {
            this.positionUpdateFrame = 0;
            this.updatePopoverPosition();
        });
    }

    updatePopoverPosition() {
        if (!this.isExpanded || !this.elements?.content || !this.elements?.control) {
            return;
        }

        const anchorRect = (this.anchorElement || this.elements.control).getBoundingClientRect();
        const rootRect = this.root.getBoundingClientRect();
        const viewportPadding = 8;
        const viewportHeight = window.innerHeight || rootRect.height || 0;
        const anchorTop = anchorRect.top ?? 0;
        const anchorBottom = anchorRect.bottom ?? (anchorTop + (anchorRect.height || 0));
        const minimumHeight = 320;
        const availableHeightAbove = Math.max(0, Math.floor(anchorTop - viewportPadding));
        const availableHeightBelow = Math.max(0, Math.floor(viewportHeight - anchorBottom - viewportPadding));
        const placeBelow = this.preferredVerticalPlacement === 'above'
            ? false
            :  availableHeightAbove >= minimumHeight 
            ? false 
            : availableHeightBelow > availableHeightAbove;
        const availableHeight = placeBelow ? availableHeightBelow : availableHeightAbove;

        const controlOffsetTop = anchorTop - rootRect.top;
        const controlOffsetBottom = anchorBottom - rootRect.top;
        const controlOffsetLeft = anchorRect.left - rootRect.left;
        const rootHeight = rootRect.height;

        this.elements.content.style.left = `${Math.round(controlOffsetLeft)}px`;
        this.elements.content.style.width = `${Math.round(anchorRect.width)}px`;
        if (placeBelow) {
            this.elements.content.style.top = `${Math.round(controlOffsetBottom)}px`;
            this.elements.content.style.bottom = '';
        } else {
            this.elements.content.style.top = '';
            this.elements.content.style.bottom = `${Math.round(rootHeight - controlOffsetTop)}px`;
        }
        this.elements.content.style.maxHeight = `${availableHeight}px`;

        const contentStyles = window.getComputedStyle(this.elements.content);
        const recommendationStyles = window.getComputedStyle(this.elements.recommendations);
        const stateStyles = window.getComputedStyle(this.elements.state);
        const nonTreeHeight =
            parseFloat(contentStyles.paddingTop || '0') +
            parseFloat(contentStyles.paddingBottom || '0') +
            (this.elements.recommendations.hidden ? 0 : this.elements.recommendations.offsetHeight + parseFloat(recommendationStyles.marginBottom || '0')) +
            (this.elements.state.style.display === 'none' ? 0 : this.elements.state.offsetHeight + parseFloat(stateStyles.marginBottom || '0'));
        const treeMaxHeight = Math.max(0, availableHeight - nonTreeHeight);
        this.elements.tree.style.maxHeight = `${treeMaxHeight}px`;
    }

    resetPopoverPosition() {
        if (this.positionUpdateFrame) {
            cancelAnimationFrame(this.positionUpdateFrame);
            this.positionUpdateFrame = 0;
        }

        if (!this.elements?.content || !this.elements?.tree) {
            return;
        }

        this.elements.content.style.left = '';
        this.elements.content.style.width = '';
        this.elements.content.style.top = '';
        this.elements.content.style.bottom = '';
        this.elements.content.style.maxHeight = '';
        this.elements.tree.style.maxHeight = '';
    }

    clearPendingDismissClickSuppression() {
        if (this.pendingDismissClickHandler) {
            document.removeEventListener('click', this.pendingDismissClickHandler, true);
            this.pendingDismissClickHandler = null;
        }

        if (this.pendingDismissClickTimeout) {
            clearTimeout(this.pendingDismissClickTimeout);
            this.pendingDismissClickTimeout = 0;
        }
    }

    suppressDismissClick() {
        this.clearPendingDismissClickSuppression();

        const handler = (event) => {
            event.preventDefault?.();
            event.stopPropagation?.();
            event.stopImmediatePropagation?.();
            this.clearPendingDismissClickSuppression();
        };

        this.pendingDismissClickHandler = handler;
        document.addEventListener('click', handler, true);
        this.pendingDismissClickTimeout = setTimeout(() => {
            if (this.pendingDismissClickHandler === handler) {
                this.clearPendingDismissClickSuppression();
            }
        }, 500);
    }

    handleDocumentPointerDown(event) {
        if (!this.isExpanded) return;
        if (this.root.contains(event.target)) return;
        event.preventDefault?.();
        event.stopPropagation?.();
        event.stopImmediatePropagation?.();
        this.suppressDismissClick();
        this.closePopover();
    }

    consumeEscapeKey(event) {
        if (!this.isExpanded || event?.key !== 'Escape') {
            return false;
        }

        event.preventDefault?.();
        event.stopPropagation?.();
        event.stopImmediatePropagation?.();
        this.closePopover();
        return true;
    }

    handleDocumentKeydown(event) {
        this.consumeEscapeKey(event);
    }

    escapeHtml(value) {
        return String(value || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    escapeAttribute(value) {
        return this.escapeHtml(value);
    }
}
