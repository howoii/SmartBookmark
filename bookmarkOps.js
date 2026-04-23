/**
 * 统一的书签操作模块
 * 管理编辑、删除等操作，确保 extension 与 Chrome 收藏夹的一致性
 * 所有涉及书签修改、删除的入口应使用本模块
 *
 * Chrome 书签的写操作统一代理到 background.js 执行（方案B），
 * background 在同一上下文中原子完成 mute + API 调用，彻底消除事件通知竞态。
 */
const bookmarkOps = {};

bookmarkOps._sendProxyMessage = async function(type, data) {
    const resp = await chrome.runtime.sendMessage({ type, data });
    if (!resp?.success) {
        throw new Error(resp?.error || `proxy ${type} failed`);
    }
    return resp;
};

/**
 * 代理调用 chrome.bookmarks.create，通过 background.js 执行
 * @param {chrome.bookmarks.CreateDetails} createDetails - 创建参数
 * @returns {Promise<chrome.bookmarks.BookmarkTreeNode>} 新建的书签节点
 */
bookmarkOps._proxyCreate = async function(createDetails) {
    logger.debug('[bookmarkOps] 代理 create', { createDetails });
    const resp = await bookmarkOps._sendProxyMessage(
        MessageType.PROXY_CHROME_BOOKMARK_CREATE,
        { createDetails }
    );
    return resp.result;
};

/**
 * 代理调用 chrome.bookmarks.update，通过 background.js 执行
 */
bookmarkOps._proxyUpdate = async function(chromeId, changes) {
    logger.debug('[bookmarkOps] 代理 update', { chromeId, changes });
    const resp = await bookmarkOps._sendProxyMessage(
        MessageType.PROXY_CHROME_BOOKMARK_UPDATE,
        { chromeId, changes }
    );
    return resp.result;
};

/**
 * 代理调用 chrome.bookmarks.remove，通过 background.js 执行
 */
bookmarkOps._proxyRemove = async function(chromeId) {
    logger.debug('[bookmarkOps] 代理 remove', { chromeId });
    await bookmarkOps._sendProxyMessage(
        MessageType.PROXY_CHROME_BOOKMARK_REMOVE,
        { chromeId }
    );
};

/**
 * 代理调用 chrome.bookmarks.move，通过 background.js 执行
 * @param {string} chromeId - 书签 ID
 * @param {chrome.bookmarks.MoveDestination} destination - 目标位置 { parentId, index }
 * @returns {Promise<chrome.bookmarks.BookmarkTreeNode>} 移动后的书签节点
 */
bookmarkOps._proxyMove = async function(chromeId, destination) {
    logger.debug('[bookmarkOps] 代理 move', { chromeId, destination });
    const resp = await bookmarkOps._sendProxyMessage(
        MessageType.PROXY_CHROME_BOOKMARK_MOVE,
        { chromeId, destination }
    );
    return resp.result;
};

bookmarkOps._proxyRemoveTree = async function(chromeId) {
    logger.debug('[bookmarkOps] 代理 removeTree', { chromeId });
    await bookmarkOps._sendProxyMessage(
        MessageType.PROXY_CHROME_BOOKMARK_REMOVE_TREE,
        { chromeId }
    );
};

bookmarkOps._buildChromeCreateDetails = async function(bookmark, browserTarget) {
    const target = BrowserBookmarkSelector.normalizeTarget(browserTarget) ||
        BrowserBookmarkSelector.normalizeTarget({
            kind: BrowserBookmarkTargetKind.FOLDER,
            nodeId: '1',
            folderId: '1',
            parentId: '0',
            placement: BrowserBookmarkPlacement.BOTTOM,
        });

    if (!target?.folderId && !target?.nodeId) {
        throw new Error(i18n.getMessage('bookmark_save_target_not_selected'));
    }

    if (target.kind === BrowserBookmarkTargetKind.BOOKMARK) {
        const [anchor] = await chrome.bookmarks.get(target.nodeId);
        if (!anchor?.parentId) {
            throw new Error(i18n.getMessage('bookmark_save_target_anchor_missing'));
        }
        return {
            parentId: anchor.parentId,
            index: target.placement === BrowserBookmarkPlacement.BEFORE ? anchor.index : anchor.index + 1,
            title: bookmark.title,
            url: bookmark.url
        };
    }

    const anchorFolderId = target.nodeId;
    if (!anchorFolderId) {
        throw new Error(i18n.getMessage('bookmark_save_target_not_selected'));
    }

    const [anchorFolder] = await chrome.bookmarks.get(anchorFolderId);
    if (!anchorFolder || anchorFolder.url) {
        throw new Error(i18n.getMessage('bookmark_save_target_anchor_missing'));
    }

    if (
        target.placement === BrowserBookmarkPlacement.BEFORE
        || target.placement === BrowserBookmarkPlacement.AFTER
    ) {
        if (!anchorFolder.parentId) {
            throw new Error(i18n.getMessage('bookmark_save_target_anchor_missing'));
        }
        return {
            parentId: anchorFolder.parentId,
            index: target.placement === BrowserBookmarkPlacement.BEFORE
                ? anchorFolder.index
                : anchorFolder.index + 1,
            title: bookmark.title,
            url: bookmark.url
        };
    }

    const parentId = target.folderId || target.nodeId;
    const createDetails = {
        parentId,
        title: bookmark.title,
        url: bookmark.url
    };

    if (target.placement === BrowserBookmarkPlacement.TOP) {
        createDetails.index = 0;
        return createDetails;
    }

    const children = await chrome.bookmarks.getChildren(parentId);
    createDetails.index = children.length;
    return createDetails;
};

bookmarkOps._buildChromeMoveDestination = async function(chromeId, browserTarget) {
    const target = BrowserBookmarkSelector.normalizeTarget(browserTarget);
    if (!target) {
        return null;
    }

    if (target.kind === BrowserBookmarkTargetKind.BOOKMARK && target.nodeId === chromeId) {
        return null;
    }

    const [currentNode] = await chrome.bookmarks.get(chromeId);
    if (!currentNode) {
        throw new Error('chrome bookmark not found');
    }

    const createDetails = await bookmarkOps._buildChromeCreateDetails({
        title: currentNode.title,
        url: currentNode.url
    }, target);

    let index = createDetails.index;

    if (index < 0) {
        index = 0;
    }

    return {
        parentId: createDetails.parentId,
        index
    };
};

bookmarkOps._isNodeInFolderSubtree = async function(folderId, targetNodeId) {
    let currentId = targetNodeId;

    while (currentId) {
        if (currentId === folderId) {
            return true;
        }

        const [node] = await chrome.bookmarks.get(currentId);
        currentId = node?.parentId || '';
    }

    return false;
};

bookmarkOps._buildFolderMoveDestination = async function(folderId, browserTarget) {
    const target = BrowserBookmarkSelector.normalizeTarget(browserTarget);
    if (!target?.nodeId) {
        throw new Error(i18n.getMessage('bookmark_save_target_not_selected'));
    }

    if (target.nodeId === folderId || await bookmarkOps._isNodeInFolderSubtree(folderId, target.nodeId)) {
        throw new Error(i18n.getMessage('popup_directory_folder_move_invalid_target'));
    }

    const [currentFolder] = await chrome.bookmarks.get(folderId);
    if (!currentFolder) {
        throw new Error('chrome folder not found');
    }

    const createDetails = await bookmarkOps._buildChromeCreateDetails({
        title: currentFolder.title || '',
        url: currentFolder.url
    }, target);

    return {
        parentId: createDetails.parentId,
        index: Math.max(0, createDetails.index ?? 0)
    };
};

/**
 * 判断将文件夹移到 destination 后子节点顺序是否与当前一致。
 * destination.index 与 _buildFolderMoveDestination 一致：在「未从父节点移除待移动项」的子列表中的插入下标（与 create 语义对齐）。
 * 同父级移动时按「先移除再插入」还原顺序，对齐 chrome.bookmarks.move 的常见索引约定。
 */
bookmarkOps._isFolderMoveNoOp = async function(folderId, destination) {
    const [folder] = await chrome.bookmarks.get(folderId);
    if (!folder || folder.url) {
        return false;
    }
    if (!destination || destination.parentId !== folder.parentId) {
        return false;
    }

    const siblings = await chrome.bookmarks.getChildren(folder.parentId);
    const childIds = siblings.map(node => node.id);
    const srcIdx = childIds.indexOf(folderId);
    if (srcIdx === -1) {
        return false;
    }

    const n = childIds.length;
    const destIdx = Math.max(0, destination.index ?? 0);
    const without = childIds.filter(id => id !== folderId);

    let insertPos;
    if (destIdx >= n) {
        insertPos = without.length;
    } else if (destIdx <= srcIdx) {
        insertPos = destIdx;
    } else {
        insertPos = destIdx - 1;
    }
    insertPos = Math.max(0, Math.min(insertPos, without.length));

    const after = [...without.slice(0, insertPos), folderId, ...without.slice(insertPos)];
    return after.length === childIds.length && after.every((id, i) => id === childIds[i]);
};

bookmarkOps.createFolder = async function({ parentId, title }) {
    return bookmarkOps._proxyCreate({ parentId, title });
};

bookmarkOps.renameFolder = async function(folderId, { title }) {
    return bookmarkOps._proxyUpdate(folderId, { title });
};

/**
 * @returns {Promise<{ moved: boolean, node: chrome.bookmarks.BookmarkTreeNode }>}
 */
bookmarkOps.moveFolder = async function(folderId, browserTarget) {
    const destination = await bookmarkOps._buildFolderMoveDestination(folderId, browserTarget);
    if (await bookmarkOps._isFolderMoveNoOp(folderId, destination)) {
        const [folder] = await chrome.bookmarks.get(folderId);
        return { moved: false, node: folder };
    }
    const node = await bookmarkOps._proxyMove(folderId, destination);
    return { moved: true, node };
};

bookmarkOps._collectUrlsFromTreeNodes = function(nodes, urls = new Set()) {
    for (const node of nodes || []) {
        if (node?.url) {
            urls.add(node.url);
        }
        if (node?.children?.length) {
            bookmarkOps._collectUrlsFromTreeNodes(node.children, urls);
        }
    }
    return urls;
};

bookmarkOps._filterUrlsMissingFromChrome = async function(urls) {
    const urlsToRemove = [];

    for (const url of urls || []) {
        if (!url) {
            continue;
        }

        try {
            const remaining = await chrome.bookmarks.search({ url });
            if (remaining.length > 0) {
                continue;
            }
        } catch (_) {
            // 搜索失败时退化为原行为，避免残留已被 Chrome 删除的插件书签
        }

        urlsToRemove.push(url);
    }

    return urlsToRemove;
};

bookmarkOps.removeFolderTree = async function(folderId) {
    const subtree = await chrome.bookmarks.getSubTree(folderId);
    const extensionUrls = Array.from(bookmarkOps._collectUrlsFromTreeNodes(subtree));
    await bookmarkOps._proxyRemoveTree(folderId);
    const urlsToRemove = await bookmarkOps._filterUrlsMissingFromChrome(extensionUrls);
    if (urlsToRemove.length > 0) {
        await LocalStorageMgr.removeBookmarks(urlsToRemove);
    }
};

/**
 * 判断书签是否为 chrome_only（仅存在于 Chrome 收藏夹）
 * @param {Object} bookmark - 书签对象，需含 source、_presence、chromeId
 * @returns {boolean}
 */
bookmarkOps.isChromeOnly = function(bookmark) {
    if (!bookmark) return false;
    return bookmark._presence === 'chrome_only' ||
        (bookmark.source === BookmarkSource.CHROME && bookmark.chromeId);
}

/**
 * 判断书签是否为 both（同时存在于 extension 与 Chrome）
 * @param {Object} bookmark
 * @returns {boolean}
 */
bookmarkOps.isBoth = function(bookmark) {
    if (!bookmark) return false;
    return bookmark._presence === 'both' ||
        (bookmark.source === BookmarkSource.EXTENSION && bookmark.chromeId);
};

/**
 * 判断书签是否为 extension_only（仅存在于插件存储）
 * @param {Object} bookmark
 * @returns {boolean}
 */
bookmarkOps.isExtensionOnly = function(bookmark) {
    if (!bookmark) return false;
    return bookmark._presence === 'extension_only' ||
        (bookmark.source === BookmarkSource.EXTENSION && !bookmark.chromeId);
};

/**
 * 统一更新书签（extension + Chrome）
 * - chrome_only: 保存到 extension，并更新 Chrome 收藏夹
 * - both: 同时更新 extension 和 Chrome
 * - extension_only: 仅更新 extension
 * @param {Object} bookmark - 当前书签（编辑前），需含 _presence、chromeId
 * @param {Object} updates - 更新内容 { url, title, tags, excerpt, savedAt, useCount, lastUsed }
 * @param {string} [oldUrl] - 旧 URL（编辑改 URL 时传入，用于删除旧 extension 记录）
 */
bookmarkOps.updateBookmark = async function(bookmark, updates, oldUrl = null, options = {}) {
    logger.debug('updateBookmark', {
        bookmark: bookmark,
        updates: updates,
        oldUrl: oldUrl,
    });
    const { url, title, tags, excerpt, savedAt, useCount, lastUsed } = updates;
    const pageInfo = {
        url: url || bookmark.url,
        title: title || bookmark.title,
        tags: tags ?? bookmark.tags ?? [],
        excerpt: excerpt ?? bookmark.excerpt ?? '',
        savedAt: savedAt ?? bookmark.savedAt ?? Date.now(),
        useCount: useCount ?? bookmark.useCount ?? 1,
        lastUsed: lastUsed ?? bookmark.lastUsed ?? Date.now(),
    };
    const operationResult = {
        chromeBookmarkMoved: false,
        chromeBookmarkCreated: false
    };

    // 编辑改 URL 时，先删除旧 extension 记录（chrome_only 无旧记录）
    if (oldUrl && oldUrl !== pageInfo.url && !bookmarkOps.isChromeOnly(bookmark)) {
        await LocalStorageMgr.removeBookmark(oldUrl);
    }

    // 保存到 extension（chrome_only 会新建，both/extension_only 会更新）
    await updateBookmarksAndEmbedding(pageInfo);

    // Chrome 收藏夹：chrome_only 或 both 时通过代理更新
    if ((bookmarkOps.isChromeOnly(bookmark) || bookmarkOps.isBoth(bookmark)) && bookmark.chromeId) {
        try {
            if (options?.browserSave?.mode === BrowserBookmarkSaveMode.BROWSER && options?.browserSave?.target) {
                const [currentNode] = await chrome.bookmarks.get(bookmark.chromeId);
                const destination = await bookmarkOps._buildChromeMoveDestination(bookmark.chromeId, options.browserSave.target);
                if (
                    currentNode &&
                    destination &&
                    (currentNode.parentId !== destination.parentId || currentNode.index !== destination.index)
                ) {
                    const movedNode = await bookmarkOps._proxyMove(bookmark.chromeId, destination);
                    operationResult.chromeBookmarkMoved = Boolean(
                        movedNode &&
                        (movedNode.parentId !== currentNode.parentId || movedNode.index !== currentNode.index)
                    );
                }
            }

            await bookmarkOps._proxyUpdate(bookmark.chromeId, {
                title: pageInfo.title,
                url: pageInfo.url
            });
        } catch (e) {
            logger.error('更新 Chrome 书签失败:', bookmark.chromeId, e);
            throw e;
        }
    } else if (options?.browserSave?.mode === BrowserBookmarkSaveMode.BROWSER) {
        try {
            const createDetails = await bookmarkOps._buildChromeCreateDetails(pageInfo, options.browserSave.target);
            await bookmarkOps._proxyCreate(createDetails);
            operationResult.chromeBookmarkCreated = true;
        } catch (e) {
            logger.error('创建 Chrome 书签失败:', e);
            throw e;
        }
    }

    return operationResult;
}

/**
 * 仅更新书签标题（用于 quickSearch 重命名等轻量场景）
 * @param {Object} bookmark - 当前书签
 * @param {string} newTitle - 新标题
 */
bookmarkOps.updateBookmarkTitle = async function(bookmark, newTitle) {
    if (bookmarkOps.isExtensionOnly(bookmark)) {
        const updated = { ...bookmark, title: newTitle };
        await updateBookmarksAndEmbedding(updated);
    } else if (bookmarkOps.isChromeOnly(bookmark) || bookmarkOps.isBoth(bookmark)) {
        if (bookmark.chromeId) {
            await bookmarkOps._proxyUpdate(bookmark.chromeId, { title: newTitle });
        }
        if (!bookmarkOps.isChromeOnly(bookmark)) {
            const updated = { ...bookmark, title: newTitle };
            await updateBookmarksAndEmbedding(updated);
        }
    }
};

/**
 * 统一删除书签
 * - chrome_only: 仅删除 Chrome 收藏夹
 * - both: 同时删除 extension 和 Chrome
 * - extension_only: 仅删除 extension
 * @param {Object} bookmark - 书签对象
 */
bookmarkOps.deleteBookmark = async function(bookmark) {
    logger.debug('deleteBookmark', {
        bookmark: bookmark,
    });
    if (bookmarkOps.isChromeOnly(bookmark)) {
        if (bookmark.chromeId) {
            try {
                await bookmarkOps._proxyRemove(bookmark.chromeId);
            } catch (e) {
                logger.error('删除 Chrome 书签失败:', bookmark.chromeId, e);
                throw e;
            }
        }
    } else if (bookmarkOps.isBoth(bookmark)) {
        await LocalStorageMgr.removeBookmark(bookmark.url);
        if (bookmark.chromeId) {
            try {
                await bookmarkOps._proxyRemove(bookmark.chromeId);
            } catch (e) {
                logger.error('删除 Chrome 书签失败:', bookmark.chromeId, e);
                throw e;
            }
        }
    } else {
        await LocalStorageMgr.removeBookmark(bookmark.url);
    }
}
