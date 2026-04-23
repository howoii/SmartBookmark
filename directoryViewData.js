/**
 * 目录视图数据层
 * 负责聚合 Chrome 书签树与插件书签，构建 BookmarkFacet 与 DirectoryNode 树
 */

/**
 * 简单字符串哈希，用于生成稳定的 nodeKey
 * @param {string} str
 * @returns {string}
 */
function simpleHash(str) {
    let h = 0;
    for (let i = 0; i < str.length; i++) {
        h = ((h << 5) - h) + str.charCodeAt(i);
        h |= 0;
    }
    return Math.abs(h).toString(36);
}

/**
 * 获取目录视图所需数据：Chrome 树 + 虚拟未归类
 * @returns {Promise<{ facets: Map<string, Object>, rootNodes: Array }>}
 */
async function getBookmarksForDirectoryView() {
    const [chromeTree, extensionBookmarks] = await Promise.all([
        chrome.bookmarks.getTree(),
        LocalStorageMgr.getBookmarksFromLocalCache().then(c => c || LocalStorageMgr.getBookmarks())
    ]);

    const extensionByUrl = new Map();
    const extList = Object.values(extensionBookmarks || {}).filter(b => b && b.url);
    for (const data of extList) {
        if (isNonMarkableUrl(data.url)) continue;
        const bookmark = new UnifiedBookmark(data, BookmarkSource.EXTENSION);
        extensionByUrl.set(data.url, bookmark);
    }

    const facetByKey = new Map();

    function buildChromeRef(node, pathIds, pathTitles) {
        return {
            chromeId: node.id,
            parentId: node.parentId || '',
            index: node.index ?? 0,
            pathIds: [...pathIds],
            pathTitles: [...pathTitles],
            title: node.title || '',
            dateAdded: node.dateAdded,
            dateLastUsed: node.dateLastUsed
        };
    }

    function traverseChrome(node, pathIds, pathTitles) {
        if (!node.url) {
            const nextPathIds = node.id ? [...pathIds, node.id] : pathIds;
            const isRoot = !node.parentId || node.parentId === '0';
            // Edge 等浏览器会在根层额外注入"工作区"之类的专有文件夹，跳过非标准根目录
            if (isRoot && !BrowserBookmarkSelector?.isKnownRootFolder?.(node.id)) return null;
            const displayTitle = BrowserBookmarkSelector?.getRootFolderDisplayName?.(node.id) || node.title || '';
            const nextPathTitles = (!isRoot && displayTitle) ? [...pathTitles, displayTitle] : pathTitles;
            const children = (node.children || []).map(child => traverseChrome(child, nextPathIds, nextPathTitles)).filter(Boolean);
            return {
                type: 'folder',
                id: node.id,
                title: node.title || displayTitle,
                parentId: node.parentId || '',
                index: node.index ?? 0,
                pathIds: nextPathIds,
                pathTitles: nextPathTitles,
                isRoot: !node.parentId || node.parentId === '0',
                children
            };
        }
        if (isNonMarkableUrl(node.url)) return null;
        const key = node.url;
        const ext = extensionByUrl.get(key);
        if (ext) extensionByUrl.delete(key);
        const chromeRef = buildChromeRef(node, pathIds, pathTitles);
        let facet = facetByKey.get(key);
        if (!facet) {
            facet = {
                key,
                url: node.url,
                presence: ext ? 'both' : 'chrome_only',
                extension: ext || undefined,
                chromeRefs: []
            };
            facetByKey.set(key, facet);
        } else {
            facet.presence = facet.extension ? 'both' : 'chrome_only';
        }
        facet.chromeRefs.push(chromeRef);
        return { type: 'bookmark', chromeId: node.id, chromeRef, facet };
    }

    const root = Array.isArray(chromeTree) ? chromeTree[0] : chromeTree;
    const chromeChildren = (root?.children || []).filter(c => c.id);
    const folderNodes = chromeChildren.map(child => traverseChrome(child, [], []));

    for (const [key, ext] of extensionByUrl) {
        const facet = {
            key,
            url: ext.url,
            presence: 'extension_only',
            extension: ext,
            chromeRefs: []
        };
        facetByKey.set(key, facet);
    }

    const rootNodes = folderNodes.map(fn => fn && fn.type === 'folder' ? fn : null).filter(Boolean);

    const uncategorizedBookmarks = [];
    for (const [key, facet] of facetByKey) {
        if (facet.presence === 'extension_only') {
            uncategorizedBookmarks.push({ facet, nodeKey: `virtual:uncategorized:${simpleHash(key)}` });
        }
    }
    uncategorizedBookmarks.sort((a, b) => (b.facet.extension?.savedAt || 0) - (a.facet.extension?.savedAt || 0));

    return {
        facets: facetByKey,
        rootNodes,
        uncategorizedBookmarks
    };
}

/**
 * 将目录视图数据转换为扁平节点列表（供渲染器使用）
 * 保持树结构：每个节点包含 children 或为叶子书签
 * @param {Object} data - getBookmarksForDirectoryView 的返回值
 * @returns {Array<Object>} 根节点数组，每个节点含 type, title, nodeKey, children, facet, chromeId 等
 */
function buildDirectoryViewTree(data) {
    const { rootNodes, uncategorizedBookmarks, facets } = data;

    function toDirNode(fn) {
        if (!fn) return null;
        if (fn.type === 'folder') {
            const children = (fn.children || [])
                .map(c => toDirNode(c))
                .filter(Boolean);
            return {
                nodeKey: `folder:${fn.id}`,
                type: 'folder',
                title: fn.title,
                chromeId: fn.id,
                parentId: fn.parentId || '',
                index: fn.index ?? 0,
                pathIds: [...(fn.pathIds || [])],
                pathTitles: [...(fn.pathTitles || [])],
                isRoot: Boolean(fn.isRoot),
                isVirtual: false,
                children
            };
        }
        if (fn.type === 'bookmark' && fn.facet) {
            // both 书签优先显示插件标题；chrome_only 用 Chrome 标题
            const title = fn.facet.extension?.title || fn.chromeRef.title || fn.facet.url;
            return {
                nodeKey: `bookmark:${fn.chromeId}`,
                type: 'bookmark',
                title,
                chromeId: fn.chromeId,
                bookmarkKey: fn.facet.key,
                facet: fn.facet
            };
        }
        return null;
    }

    const tree = rootNodes.map(toDirNode).filter(Boolean);

    if (uncategorizedBookmarks.length > 0) {
        tree.push({
            nodeKey: 'virtual:uncategorized',
            type: 'virtual-folder',
            title: 'uncategorized', // 由 i18n 替换
            isRoot: false,
            isVirtual: true,
            children: uncategorizedBookmarks.map(({ facet, nodeKey }) => ({
                nodeKey,
                type: 'bookmark',
                title: facet.extension?.title || facet.url,
                bookmarkKey: facet.key,
                facet
            }))
        });
    }

    return tree;
}
