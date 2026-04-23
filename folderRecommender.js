/**
 * 书签保存目录自动推荐模块
 *
 * 三路召回（行为 / 词面 / 向量）+ 统一排序，实时构造目录画像，不引入新的持久化存储。
 * 作为共享模块在 quickSave / popup 页面上下文中运行。
 *
 * 依赖（由 HTML script 顺序保证）：
 *   logger, i18n, LocalStorageMgr, BrowserBookmarkSelector,
 *   BrowserBookmarkTargetKind, BrowserBookmarkPlacement, getEmbedding, makeEmbeddingText,
 *   ConfigManager, isNonMarkableUrl
 */

const FolderRecommender = (() => {
    // ─── 常量 ───

    const HALF_LIFE_MS = 24 * 60 * 60 * 1000;
    const DECAY_LAMBDA = Math.LN2 / HALF_LIFE_MS;
    const ONE_DAY_MS = 86400000;
    const MAX_RECOMMENDATIONS = 5;

    const WEIGHTS_WITH_EMBEDDING = { behavior: 0.10, domain: 0.25, lexical: 0.20, vector: 0.40, preference: 0.05 };
    const WEIGHTS_WITHOUT_EMBEDDING = { behavior: 0.20, domain: 0.40, lexical: 0.30, vector: 0.00, preference: 0.10 };

    // ─── 分词 ───

    const RE_CJK = /[\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff]/;
    const RE_CJK_RUN = /[\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff]+/g;
    const RE_WORD_SEPARATORS = /[\s\-_\/\.,:;!?()[\]{}'"]+/;

    function isCjkToken(token) {
        return RE_CJK.test(token);
    }

    function tokenize(text) {
        if (!text) return new Set();
        const tokens = new Set();

        const cjkRuns = text.match(RE_CJK_RUN) || [];
        for (const run of cjkRuns) {
            if (run.length >= 2) tokens.add(run);
        }

        const nonCjk = text.replace(RE_CJK_RUN, ' ');
        for (const word of nonCjk.split(RE_WORD_SEPARATORS)) {
            const w = word.trim().toLowerCase();
            if (w.length > 1) tokens.add(w);
        }

        return tokens;
    }

    function getHost(url) {
        try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; }
    }

    // ─── 向量计算 ───

    function cosineSimilarity(vec1, vec2) {
        if (!vec1 || !vec2 || vec1.length === 0 || vec2.length === 0 || vec1.length !== vec2.length) {
            return 0;
        }
        let dot = 0, magA = 0, magB = 0;
        for (let i = 0; i < vec1.length; i++) {
            dot += vec1[i] * vec2[i];
            magA += vec1[i] * vec1[i];
            magB += vec2[i] * vec2[i];
        }
        magA = Math.sqrt(magA);
        magB = Math.sqrt(magB);
        return magA && magB ? dot / (magA * magB) : 0;
    }

    function maxSim(queryEmbeddings, targetEmbedding) {
        let best = 0;
        for (const qe of queryEmbeddings) {
            const sim = cosineSimilarity(qe, targetEmbedding);
            if (sim > best) best = sim;
        }
        return best;
    }

    // ─── 集合运算 ───

    function tokenMatchesInSet(token, targetSet) {
        if (targetSet.has(token)) return true;
        if (!isCjkToken(token)) return false;
        for (const t of targetSet) {
            if (isCjkToken(t) && (t.includes(token) || token.includes(t))) return true;
        }
        return false;
    }

    function overlapCoefficient(setA, setB) {
        if (!setA.size || !setB.size) return 0;
        let intersection = 0;
        for (const token of setA) {
            if (tokenMatchesInSet(token, setB)) intersection++;
        }
        if (intersection === 0) return 0;
        const overlapScore = Math.pow(intersection / setA.size, 0.2);
        const matchConfidence = 1 - Math.exp(-1.0 * intersection);
        const queryConfidence = 1 - Math.exp(-1.0 * setA.size);
        const maxSize = Math.max(setA.size, setB.size);
        const sizePenalty = maxSize <= 8 ? 1 : Math.sqrt(8 / maxSize);
        return overlapScore * matchConfidence * queryConfidence * sizePenalty;
    }

    const TAG = '[folder-recommend]';

    function topN(map, n, labelFn) {
        return [...map.entries()]
            .sort((a, b) => (b[1].score || 0) - (a[1].score || 0))
            .slice(0, n)
            .map(([id, detail]) => ({ folder: labelFn?.(id) || id, score: +(detail.score || 0).toFixed(4), ...detail }));
    }

    // ─── buildFolderIndex ───

    function buildFolderIndex(chromeTree, extensionBookmarks) {
        const extByUrl = new Map();
        const extValues = Object.values(extensionBookmarks || {});
        for (const bm of extValues) {
            if (bm && bm.url) extByUrl.set(bm.url, bm);
        }

        const folderIndex = new Map();

        function traverse(node, pathIds, pathTitles) {
            if (!node) return;

            if (!node.url) {
                const id = node.id || '';
                const isRoot = !node.parentId || node.parentId === '0';
                if (isRoot && !BrowserBookmarkSelector?.isKnownRootFolder?.(id)) return;
                const displayTitle = BrowserBookmarkSelector?.getRootFolderDisplayName?.(id) || node.title || '';
                const nextPathIds = id ? [...pathIds, id] : pathIds;
                const nextPathTitles = (!isRoot && displayTitle) ? [...pathTitles, displayTitle] : pathTitles;

                const titleForTokens = [displayTitle, ...pathTitles].filter(Boolean).join(' ');

                const profile = {
                    id,
                    title: node.title || displayTitle,
                    displayTitle,
                    parentId: node.parentId || '',
                    dateAdded: node.dateAdded || 0,
                    pathIds: nextPathIds,
                    pathTitles: nextPathTitles,
                    isRoot,
                    bookmarks: [],
                    tokens: tokenize(titleForTokens),
                    contentTokens: new Set(),
                    hostHistogram: new Map(),
                    embeddingCount: 0,
                };
                folderIndex.set(id, profile);

                for (const child of (node.children || [])) {
                    traverse(child, nextPathIds, nextPathTitles);
                }
                return;
            }

            if (isNonMarkableUrl(node.url)) return;

            const parentProfile = folderIndex.get(node.parentId);
            if (!parentProfile) return;

            const ext = extByUrl.get(node.url);
            const host = getHost(node.url);
            const savedAt = ext?.savedAt || node.dateAdded || 0;

            parentProfile.bookmarks.push({
                url: node.url,
                title: ext?.title || node.title || '',
                host,
                tags: ext?.tags || [],
                savedAt,
                embedding: ext?.embedding || null,
            });
        }

        const root = Array.isArray(chromeTree) ? chromeTree[0] : chromeTree;
        if (root) {
            for (const child of (root.children || [])) {
                traverse(child, [], []);
            }
        }

        for (const profile of folderIndex.values()) {
            let embeddingCount = 0;
            const contentParts = [];
            for (const bm of profile.bookmarks) {
                const bmHost = bm.host;
                if (bmHost) {
                    profile.hostHistogram.set(bmHost, (profile.hostHistogram.get(bmHost) || 0) + 1);
                }

                for (const tag of bm.tags) {
                    if (tag) contentParts.push(tag);
                }

                if (bm.embedding) embeddingCount++;
            }
            if (contentParts.length > 0) {
                profile.contentTokens = tokenize(contentParts.join(' '));
            }
            profile.embeddingCount = embeddingCount;
        }

        let totalBookmarks = 0, totalWithEmbedding = 0;
        for (const p of folderIndex.values()) {
            totalBookmarks += p.bookmarks.length;
            totalWithEmbedding += p.embeddingCount;
        }
        logger.debug(TAG, 'buildFolderIndex 完成', {
            folders: folderIndex.size,
            bookmarks: totalBookmarks,
            withEmbedding: totalWithEmbedding,
            extensionBookmarks: extByUrl.size,
        });

        return folderIndex;
    }

    // ─── Query 特征提取 ───

    function extractQueryFeatures(bookmarkInfo) {
        const tagTokens = new Set();
        for (const tag of (bookmarkInfo.tags || [])) {
            for (const t of tokenize(tag)) tagTokens.add(t);
        }
        const host = getHost(bookmarkInfo.url);

        return { tagTokens, host };
    }

    // ─── 行为召回 ───

    const HEAT_SIGMOID_K = 0.5;

    function recallByBehavior(folderIndex) {
        const now = Date.now();
        const result = new Map();

        for (const [folderId, profile] of folderIndex) {
            if (profile.bookmarks.length === 0) continue;

            let recentHeat = 0;
            for (const bm of profile.bookmarks) {
                const age = now - (bm.savedAt || 0);
                if (age >= 0) {
                    recentHeat += Math.exp(-DECAY_LAMBDA * age);
                }
            }
            const normalizedHeat = 1 - Math.exp(-HEAT_SIGMOID_K * recentHeat);

            if (normalizedHeat > 0) {
                result.set(folderId, { score: normalizedHeat, recentHeat, normalizedHeat });
            }
        }
        return result;
    }

    // ─── 域名召回 ───

    function recallByDomain(queryFeatures, folderIndex) {
        if (!queryFeatures.host) return new Map();

        const result = new Map();
        for (const [folderId, profile] of folderIndex) {
            if (profile.bookmarks.length === 0) continue;

            const domainCount = profile.hostHistogram.get(queryFeatures.host) || 0;
            if (domainCount === 0) continue;

            const rawDomainRatio = Math.pow(domainCount / profile.bookmarks.length, 1.1);
            const confidence = 1 - Math.exp(-0.2 * Math.pow(domainCount,2)/(domainCount+1));
            const score = rawDomainRatio * confidence;

            result.set(folderId, { score, domainCount, rawDomainRatio, confidence });
        }
        return result;
    }

    // ─── 词面召回 ───

    function findMatchedToken(queryToken, targetTokens) {
        if (targetTokens.has(queryToken)) return queryToken;
        if (!isCjkToken(queryToken)) return null;
        for (const t of targetTokens) {
            if (isCjkToken(t) && (t.includes(queryToken) || queryToken.includes(t))) return t;
        }
        return null;
    }

    function calcMaxIdf(queryTokens, targetTokens, tokenDocFreq, totalFolders) {
        let bestIdf = 0;
        const maxIdf = Math.log(totalFolders);
        if (maxIdf <= 0) return 0;
        for (const t of queryTokens) {
            const matched = findMatchedToken(t, targetTokens);
            if (matched) {
                const df = tokenDocFreq.get(matched) || 1;
                const idf = Math.log(totalFolders / df);
                if (idf > bestIdf) bestIdf = idf;
            }
        }
        return bestIdf / maxIdf;
    }

    function recallByLexical(queryFeatures, folderIndex) {
        logger.trace(TAG, '词面召回输入', {
            tagTokens: [...queryFeatures.tagTokens],
        });

        const tokenDocFreq = new Map();
        for (const [, profile] of folderIndex) {
            for (const t of profile.tokens) {
                tokenDocFreq.set(t, (tokenDocFreq.get(t) || 0) + 1);
            }
        }
        const totalFolders = folderIndex.size;

        const result = new Map();
        for (const [folderId, profile] of folderIndex) {
            const folderOverlap = overlapCoefficient(queryFeatures.tagTokens, profile.tokens);
            if (folderOverlap <= 0) continue;

            const idfFactor = calcMaxIdf(queryFeatures.tagTokens, profile.tokens, tokenDocFreq, totalFolders);
            const lexicalScore = folderOverlap * Math.max(idfFactor, 0.1);
            result.set(folderId, {
                score: lexicalScore,
                folderOverlap,
                profileTokens: [...profile.tokens],
                queryTokens: [...queryFeatures.tagTokens],
            });
        }
        return result;
    }

    // ─── 向量召回 ───

    const DEFAULT_SIM_THRESHOLDS = { HIGH: 0.65, MEDIUM: 0.5, LOW: 0.4 };

    function resolveVectorThresholds(simThresholds, customApiConfig) {
        const base = simThresholds || DEFAULT_SIM_THRESHOLDS;
        if (!customApiConfig?.isCustom) return base;
        const high = Math.min(1, Math.max(0, customApiConfig.highSimilarity || base.HIGH));
        const medium = Math.min(high, base.MEDIUM);
        return { ...base, HIGH: high, MEDIUM: medium };
    }

    function recallByVector(queryEmbeddings, folderIndex, simThresholds, customApiConfig) {
        if (!queryEmbeddings || queryEmbeddings.length === 0) return new Map();

        const { HIGH, MEDIUM } = resolveVectorThresholds(simThresholds, customApiConfig);
        const result = new Map();

        for (const [folderId, profile] of folderIndex) {
            if (profile.embeddingCount === 0) continue;

            let highCount = 0, mediumCount = 0;
            for (const bm of profile.bookmarks) {
                if (!bm.embedding) continue;
                const sim = maxSim(queryEmbeddings, bm.embedding);
                if (sim >= HIGH) highCount++;
                else if (sim >= MEDIUM) mediumCount++;
            }

            const matchCount = highCount + mediumCount;
            if (matchCount === 0) continue;

            const ratio = matchCount / profile.embeddingCount;
            const ratioScore = Math.pow(ratio, 0.3);
            const qualityScore = (highCount * 1.0 + mediumCount * 0.4) / matchCount;
            const matchConfidence = 1 - Math.exp(-0.3 * Math.pow(matchCount,2)/(matchCount+1));

            const score = ratioScore * qualityScore * matchConfidence;
            result.set(folderId, { score, highCount, mediumCount, matchCount });
        }
        return result;
    }

    // ─── 排序 ───

    function newFolderBonus(profile, now) {
        if (profile.bookmarks.length > 0) return 0;
        const age = now - (profile.dateAdded || 0);
        if (age < ONE_DAY_MS) return 0.25;
        if (age < 3 * ONE_DAY_MS) return 0.15;
        if (age < 7 * ONE_DAY_MS) return 0.08;
        return 0;
    }

    function penalties(profile) {
        let p = 0;
        if (profile.isRoot) p += 0.15;
        if (profile.bookmarks.length > 50) {
            p += 0.1 * Math.log2(profile.bookmarks.length / 50);
        }
        return p;
    }

    function buildRankMap(scoreMap) {
        const sorted = [...scoreMap.entries()]
            .filter(([, detail]) => (detail.score || 0) > 0)
            .sort((a, b) => (b[1].score || 0) - (a[1].score || 0));
        const rankMap = new Map();
        for (let i = 0; i < sorted.length; i++) {
            rankMap.set(sorted[i][0], i + 1);
        }
        return rankMap;
    }

    function rankCandidates(folderIndex, behaviorScores, domainScores, lexicalScores, vectorScores, bookmarkInfo, preferenceFolderId) {
        const hasEmbedding = bookmarkInfo.embedding != null;
        const W = hasEmbedding ? WEIGHTS_WITH_EMBEDDING : WEIGHTS_WITHOUT_EMBEDDING;
        const now = Date.now();

        const behaviorRanks = buildRankMap(behaviorScores);
        const domainRanks = buildRankMap(domainScores);
        const lexicalRanks = buildRankMap(lexicalScores);
        const vectorRanks = buildRankMap(vectorScores);
        const totalFolders = folderIndex.size;

        const candidates = [];
        for (const [folderId, profile] of folderIndex) {
            const bScore = behaviorScores.get(folderId)?.score || 0;
            const dScore = domainScores.get(folderId)?.score || 0;
            const lScore = lexicalScores.get(folderId)?.score || 0;
            const vScore = vectorScores.get(folderId)?.score || 0;
            const prefBias = (preferenceFolderId && folderId === preferenceFolderId) ? 1.0 : 0.0;
            const nfBonus = newFolderBonus(profile, now);
            const pen = penalties(profile);

            const finalScore = W.behavior * bScore
                + W.domain * dScore
                + W.lexical * lScore
                + W.vector * vScore
                + W.preference * prefBias
                + nfBonus
                - pen;

            if (finalScore > 0) {
                candidates.push({
                    folderId,
                    profile,
                    finalScore,
                    behaviorDetail: behaviorScores.get(folderId) || null,
                    domainDetail: domainScores.get(folderId) || null,
                    lexicalDetail: lexicalScores.get(folderId) || null,
                    vectorDetail: vectorScores.get(folderId) || null,
                    prefBias,
                    nfBonus,
                    penalty: pen,
                    scores: { behavior: bScore, domain: dScore, lexical: lScore, vector: vScore, preference: prefBias },
                    weights: W,
                    ranks: {
                        behavior: behaviorRanks.get(folderId) || totalFolders,
                        domain: domainRanks.get(folderId) || totalFolders,
                        lexical: lexicalRanks.get(folderId) || totalFolders,
                        vector: vectorRanks.get(folderId) || totalFolders,
                    },
                });
            }
        }

        candidates.sort((a, b) => b.finalScore - a.finalScore);
        return candidates;
    }

    // ─── 推荐理由 ───

    function getTopReasonKey(candidate) {
        const { prefBias, nfBonus, scores, weights, ranks } = candidate;

        const contributions = [
            { key: 'behavior', rank: ranks.behavior, value: weights.behavior * scores.behavior },
            { key: 'domain', rank: ranks.domain, value: weights.domain * scores.domain },
            { key: 'lexical', rank: ranks.lexical, value: weights.lexical * scores.lexical },
            { key: 'vector', rank: ranks.vector, value: weights.vector * scores.vector },
            { key: 'preference', rank: prefBias > 0 ? 0 : Infinity, value: weights.preference * scores.preference },
            { key: 'newFolder', rank: nfBonus > 0 ? 0 : Infinity, value: nfBonus },
        ];
        contributions.sort((a, b) => a.rank - b.rank || b.value - a.value);

        const top = contributions[0];
        if (!top || top.value <= 0) return null;

        if (top.key === 'behavior') {
            const recentCount = candidate.profile.bookmarks.filter(
                bm => (Date.now() - (bm.savedAt || 0)) < 14 * ONE_DAY_MS
            ).length;
            if (recentCount > 0) return 'recent';
            return 'recent_generic';
        }
        return top.key;
    }

    function generateReason(candidate) {
        const key = getTopReasonKey(candidate);
        if (!key) return '';
        const { domainDetail } = candidate;
        const map = {
            domain: () => i18n.getMessage('folder_recommend_reason_domain', [String(domainDetail?.domainCount || 0)]),
            recent: () => {
                const count = candidate.profile.bookmarks.filter(
                    bm => (Date.now() - (bm.savedAt || 0)) < 14 * ONE_DAY_MS
                ).length;
                return i18n.getMessage('folder_recommend_reason_recent', [String(count)]);
            },
            recent_generic: () => i18n.getMessage('folder_recommend_reason_recent_generic'),
            lexical: () => i18n.getMessage('folder_recommend_reason_name_match'),
            vector: () => i18n.getMessage('folder_recommend_reason_similar'),
            preference: () => i18n.getMessage('folder_recommend_reason_default'),
            newFolder: () => i18n.getMessage('folder_recommend_reason_new_folder'),
        };
        return (map[key] || (() => ''))();
    }

    function generateShortReason(candidate) {
        const key = getTopReasonKey(candidate);
        if (!key) return '';
        const map = {
            domain: 'folder_recommend_reason_domain_short',
            recent: 'folder_recommend_reason_recent_short',
            recent_generic: 'folder_recommend_reason_recent_generic_short',
            lexical: 'folder_recommend_reason_name_match_short',
            vector: 'folder_recommend_reason_similar_short',
            preference: 'folder_recommend_reason_default_short',
            newFolder: 'folder_recommend_reason_new_folder_short',
        };
        return i18n.getMessage(map[key] || '') || '';
    }

    function formatFolderPath(profile) {
        const titles = (profile.pathTitles || []).filter(Boolean);
        if (titles.length === 0) return profile.displayTitle || profile.title || '';
        return titles.join(' › ');
    }

    function buildTargetFromProfile(profile) {
        return BrowserBookmarkSelector.normalizeTarget({
            kind: BrowserBookmarkTargetKind.FOLDER,
            nodeId: profile.id,
            parentId: profile.parentId,
            folderId: profile.id,
            placement: BrowserBookmarkPlacement.BOTTOM,
            title: profile.displayTitle || profile.title || '',
            pathIds: [...(profile.pathIds || [])],
            pathTitles: [...(profile.pathTitles || [])],
        });
    }

    // ─── 缓存 ───

    let _folderIndexCache = null;
    let _folderIndexPromise = null;
    const _embeddingCache = new Map();

    async function fetchAndBuildIndex() {
        const t0 = Date.now();
        const [chromeTree, extensionBookmarks] = await Promise.all([
            chrome.bookmarks.getTree(),
            LocalStorageMgr.getBookmarks(),
        ]);
        const fetchTime = Date.now() - t0;

        const t1 = Date.now();
        const folderIndex = buildFolderIndex(chromeTree, extensionBookmarks);
        const buildTime = Date.now() - t1;

        logger.debug(TAG, 'folderIndex 构建完成', {
            folders: folderIndex.size,
            fetchTime,
            buildTime,
        });
        return folderIndex;
    }

    function getOrBuildFolderIndex() {
        if (_folderIndexCache) return Promise.resolve(_folderIndexCache);
        if (_folderIndexPromise) return _folderIndexPromise;

        _folderIndexPromise = fetchAndBuildIndex().then(index => {
            _folderIndexCache = index;
            _folderIndexPromise = null;
            return index;
        }).catch(e => {
            _folderIndexPromise = null;
            throw e;
        });
        return _folderIndexPromise;
    }

    async function warmUp() {
        try {
            await getOrBuildFolderIndex();
            logger.debug(TAG, 'warmUp 完成');
        } catch (e) {
            logger.debug(TAG, 'warmUp 失败，recommend 时会重试', e);
        }
    }

    async function resolveQueryEmbeddings(bookmarkInfo, timings) {
        const url = bookmarkInfo.url;

        if (bookmarkInfo.embedding) {
            const embeddings = [bookmarkInfo.embedding];
            logger.debug(TAG, '使用传入的 embedding', { count: 1, dim: bookmarkInfo.embedding.length });
            _embeddingCache.set(url, embeddings);
            return embeddings;
        }

        const cached = _embeddingCache.get(url);
        if (cached) {
            logger.debug(TAG, '使用缓存的 embeddings', { count: cached.length });
            return cached;
        }

        try {
            const embeddingService = await ConfigManager.getEmbeddingService();
            if (!embeddingService?.apiKey || !embeddingService?.embedModel) {
                logger.debug(TAG, '无可用 embedding 服务，向量路跳过');
                return null;
            }

            const tags = (bookmarkInfo.tags || []).filter(t => t?.trim());
            const texts = tags.length > 0 ? tags : [bookmarkInfo.title].filter(Boolean);
            if (texts.length === 0) return null;

            logger.debug(TAG, '尝试获取 embeddings...', { texts, count: texts.length });
            const t0 = Date.now();
            const results = await getBatchEmbeddings(texts);
            timings.embeddingApi = Date.now() - t0;

            const embeddings = results.filter(r => r.embedding).map(r => r.embedding);
            logger.debug(TAG, 'embeddings 获取完成', {
                requested: texts.length,
                succeeded: embeddings.length,
                dim: embeddings[0]?.length,
                elapsed: timings.embeddingApi,
            });

            if (embeddings.length === 0) return null;
            _embeddingCache.set(url, embeddings);
            return embeddings;
        } catch (e) {
            logger.debug(TAG, 'embedding API 调用失败，向量路跳过', e);
            return null;
        }
    }

    // ─── 主入口 ───

    async function recommend(bookmarkInfo) {
        if (!bookmarkInfo || !bookmarkInfo.url) return [];

        const startTime = Date.now();
        const timings = {};

        logger.debug(TAG, '开始推荐', {
            url: bookmarkInfo.url,
            title: bookmarkInfo.title,
            tagsCount: bookmarkInfo.tags?.length || 0,
            hasExcerpt: !!bookmarkInfo.excerpt,
            hasEmbedding: !!bookmarkInfo.embedding,
        });

        try {
            let t0 = Date.now();
            const folderIndex = await getOrBuildFolderIndex();
            timings.getIndex = Date.now() - t0;
            if (folderIndex.size === 0) {
                logger.debug(TAG, '目录索引为空，跳过推荐');
                return [];
            }

            const folderLabel = (id) => {
                const p = folderIndex.get(id);
                return p ? formatFolderPath(p) : id;
            };

            const queryFeatures = extractQueryFeatures(bookmarkInfo);
            logger.debug(TAG, 'query 特征', {
                host: queryFeatures.host,
                tagTokens: [...queryFeatures.tagTokens].slice(0, 10),
                tagTokensCount: queryFeatures.tagTokens.size,
            });

            const queryEmbeddings = await resolveQueryEmbeddings(bookmarkInfo, timings);
            const bookmarkInfoWithEmbedding = { ...bookmarkInfo, embedding: queryEmbeddings?.[0] || null };

            t0 = Date.now();
            const behaviorScores = recallByBehavior(folderIndex);
            timings.behaviorRecall = Date.now() - t0;
            logger.debug(TAG, '行为召回', {
                hitFolders: behaviorScores.size,
                elapsed: timings.behaviorRecall,
            });
            logger.trace(TAG, '行为召回 Top10', topN(behaviorScores, 10, folderLabel));

            t0 = Date.now();
            const domainScores = recallByDomain(queryFeatures, folderIndex);
            timings.domainRecall = Date.now() - t0;
            logger.debug(TAG, '域名召回', {
                hitFolders: domainScores.size,
                elapsed: timings.domainRecall,
            });
            if (domainScores.size > 0) {
                logger.trace(TAG, '域名召回 Top10', topN(domainScores, 10, folderLabel));
            }

            t0 = Date.now();
            const lexicalScores = recallByLexical(queryFeatures, folderIndex);
            timings.lexicalRecall = Date.now() - t0;
            logger.debug(TAG, '词面召回', {
                hitFolders: lexicalScores.size,
                elapsed: timings.lexicalRecall,
            });
            logger.trace(TAG, '词面召回 Top10', topN(lexicalScores, 10, folderLabel));

            let simThresholds = DEFAULT_SIM_THRESHOLDS;
            let customApiConfig = null;
            try {
                const apiService = await ConfigManager.getEmbeddingService();
                if (apiService?.similarityThreshold) {
                    simThresholds = {
                        HIGH: apiService.similarityThreshold.HIGH || DEFAULT_SIM_THRESHOLDS.HIGH,
                        MEDIUM: apiService.similarityThreshold.MEDIUM || DEFAULT_SIM_THRESHOLDS.MEDIUM,
                        LOW: apiService.similarityThreshold.LOW || DEFAULT_SIM_THRESHOLDS.LOW,
                    };
                }
                if (apiService?.isCustom) {
                    customApiConfig = {
                        isCustom: true,
                        highSimilarity: apiService.highSimilarity,
                    };
                }
            } catch { /* use defaults */ }

            t0 = Date.now();
            const vectorScores = recallByVector(queryEmbeddings, folderIndex, simThresholds, customApiConfig);
            timings.vectorRecall = Date.now() - t0;
            logger.debug(TAG, '向量召回', {
                enabled: !!queryEmbeddings,
                queryVectorCount: queryEmbeddings?.length || 0,
                hitFolders: vectorScores.size,
                elapsed: timings.vectorRecall,
            });
            if (vectorScores.size > 0) {
                logger.trace(TAG, '向量召回 Top10', topN(vectorScores, 10, folderLabel));
            }

            let preferenceFolderId = null;
            try {
                const pref = await SettingsManager.get('display.browserBookmarkSave');
                preferenceFolderId = pref?.target?.folderId || null;
            } catch { /* ignore */ }

            t0 = Date.now();
            const ranked = rankCandidates(
                folderIndex, behaviorScores, domainScores, lexicalScores, vectorScores,
                bookmarkInfoWithEmbedding, preferenceFolderId
            );
            timings.rank = Date.now() - t0;

            logger.debug(TAG, '排序完成', {
                totalCandidates: ranked.length,
                weights: ranked[0]?.weights || (queryEmbeddings ? WEIGHTS_WITH_EMBEDDING : WEIGHTS_WITHOUT_EMBEDDING),
                preferenceFolderId,
                elapsed: timings.rank,
            });

            logger.trace(TAG, '排序 Top10 详情', ranked.slice(0, 10).map(c => ({
                folder: formatFolderPath(c.profile),
                finalScore: +c.finalScore.toFixed(4),
                behavior: +c.scores.behavior.toFixed(4),
                domain: +c.scores.domain.toFixed(4),
                lexical: +c.scores.lexical.toFixed(4),
                vector: +c.scores.vector.toFixed(4),
                preference: c.scores.preference,
                nfBonus: c.nfBonus,
                penalty: +c.penalty.toFixed(4),
                ranks: c.ranks,
                behaviorDetail: c.behaviorDetail ? {
                    heat: +c.behaviorDetail.normalizedHeat.toFixed(3),
                } : null,
                domainDetail: c.domainDetail ? {
                    domainCount: c.domainDetail.domainCount,
                } : null,
                lexicalDetail: c.lexicalDetail ? {
                    folderOverlap: +c.lexicalDetail.folderOverlap.toFixed(3),
                } : null,
                vectorDetail: c.vectorDetail ? {
                    highCount: c.vectorDetail.highCount,
                    mediumCount: c.vectorDetail.mediumCount,
                    matchCount: c.vectorDetail.matchCount,
                    embeddingCount: c.profile.embeddingCount,
                } : null,
            })));

            const results = ranked.slice(0, MAX_RECOMMENDATIONS).map(candidate => ({
                target: buildTargetFromProfile(candidate.profile),
                label: formatFolderPath(candidate.profile),
                shortLabel: candidate.profile.displayTitle || candidate.profile.title || '',
                description: generateReason(candidate),
                shortDescription: generateShortReason(candidate),
            })).filter(r => r.target);

            timings.total = Date.now() - startTime;
            logger.debug(TAG, '推荐完成', {
                resultCount: results.length,
                timings,
                results: results.map(r => ({ label: r.label, description: r.description })),
            });

            return results;
        } catch (error) {
            logger.error(TAG, '推荐失败', error);
            return [];
        }
    }

    return { recommend, warmUp };
})();
