class SearchManager {
    constructor() {
        this.searchTimer = null;
        this.DEBOUNCE_DELAY = 500; // 搜索防抖延迟(毫秒)
        this.searchHistoryManager = new SearchHistoryManager();
    }

    // 搜索书签
    async search(query, options = {}) {
        const {
            debounce = true,
            maxResults = null, // 改为null，从设置中获取
            includeUrl = false,
            includeChromeBookmarks = false,
            recordSearch = true
        } = options;

        // 从设置中获取最大结果数
        const settings = await SettingsManager.getAll();
        const actualMaxResults = maxResults || settings?.search?.maxResults || 50;

        logger.debug('搜索参数:', {
            ...options,
            maxResults: actualMaxResults
        });

        // 如果已有定时器，清除之前的定时器
        if (this.searchTimer) {
            clearTimeout(this.searchTimer);
        }

        // 返回一个 Promise
        return new Promise((resolve, reject) => {
            const executeSearch = async () => {
                logger.debug("开始搜索", {
                    query: query
                })
                try {
                    if (!query.trim()) {
                        resolve([]);
                        return;
                    }

                    // 获取查询向量
                    let queryEmbedding = await this.searchHistoryManager.getVector(query);
                    logger.debug('获取缓存向量:', {
                        query,
                        queryEmbedding
                    });
                    
                    if (!queryEmbedding) {
                        queryEmbedding = await getEmbedding(query);
                        if (queryEmbedding) {
                            const activeService = await ConfigManager.getEmbeddingService();
                            await this.searchHistoryManager.cacheVector(query, queryEmbedding, activeService);
                        }
                    }

                    // 搜索书签
                    const results = await this.searchBookmarks(queryEmbedding, query, actualMaxResults, includeUrl, includeChromeBookmarks);

                    logger.debug('搜索结果:', {
                        query,
                        results
                    });
                    
                    // 添加到搜索历史
                    if (recordSearch) {
                        await this.searchHistoryManager.addSearch(query);
                    }
                    
                    resolve(results);
                } catch (error) {
                    logger.error('搜索失败:', error);
                    reject(error);
                }
            };

            // 如果启用防抖，设置定时器
            if (debounce) {
                this.searchTimer = setTimeout(executeSearch, this.DEBOUNCE_DELAY);
            } else {
                executeSearch();
            }
        });
    }

    // 搜索书签
    async searchBookmarks(queryEmbedding, searchInput, maxResults = 50, includeUrl = false, includeChromeBookmarks = false) {
        const allBookmarks = await getAllBookmarks(includeChromeBookmarks);
        
        // 获取API服务配置
        const apiService = await ConfigManager.getEmbeddingService();
        const SIMILARITY_THRESHOLDS = {
            MAX: apiService.similarityThreshold?.MAX || 0.85,
            HIGH: apiService.similarityThreshold?.HIGH || 0.65, // 高相关性，分数 >= 80
            MEDIUM: apiService.similarityThreshold?.MEDIUM || 0.5, // 有点相关，可以显示， 分数 >= 60
            LOW: apiService.similarityThreshold?.LOW || 0.4 // 基本无关，如果有关键词可能显示
        };
        // 自定义api参数
        let highSimilarity = apiService.highSimilarity || SIMILARITY_THRESHOLDS.MEDIUM;
        highSimilarity = Math.min(1, Math.max(0, highSimilarity));
        const hideLowSimilarity = apiService.hideLowSimilarity === true;

        logger.debug('相似度阈值:', {
            similarityThreshold: SIMILARITY_THRESHOLDS,
            highSimilarity,
            hideLowSimilarity
        });

        // 计算单个书签的分数
        const calculateBookmarkScore = (item) => {
            // 计算向量相似度
            let similarity = 0;
            if (item.source === BookmarkSource.EXTENSION && item.embedding) {
                similarity = this.cosineSimilarity(queryEmbedding, item.embedding);
            }
            similarity = Math.min(1, Math.max(0, similarity));
            
            // 检查关键词匹配
            const searchInputLower = searchInput.toLowerCase();
            const keywordMatch = {
                title: item.title?.toLowerCase().includes(searchInputLower) || false,
                tags: item.tags?.some(tag => tag.toLowerCase().includes(searchInputLower)) || false,
                excerpt: item.excerpt?.toLowerCase().includes(searchInputLower) || false,
                url: includeUrl ? item.url?.toLowerCase().includes(searchInputLower) : false
            };
            
            const hasKeywordMatch = Object.values(keywordMatch).some(match => match);
            
            // 计算基础分数
            let score = 0;
            if (apiService.isCustom) {
                const SIMILARITY_THRESHOLDS_MAX = highSimilarity >= 0.7 ? 1.0 : 0.7;
                if (similarity >= highSimilarity) {
                    const param = Math.sqrt((similarity - highSimilarity) / (SIMILARITY_THRESHOLDS_MAX - highSimilarity))
                    score = hasKeywordMatch 
                         ? 70 + 30 * param 
                         : 60 + 40 * param;
                }else {
                    const param = Math.sqrt(similarity / highSimilarity)
                    score = hasKeywordMatch
                        ? 30 + 30 * param
                        : 0 + 60 * param;
                }
            } else {
                if (similarity >= SIMILARITY_THRESHOLDS.HIGH) {
                    const param = Math.sqrt((similarity - SIMILARITY_THRESHOLDS.HIGH) / (SIMILARITY_THRESHOLDS.MAX - SIMILARITY_THRESHOLDS.HIGH))
                    score = hasKeywordMatch 
                        ? 90 + 10 * param
                        : 80 + 20 * param;
                } else if (similarity >= SIMILARITY_THRESHOLDS.MEDIUM) {
                    const param = Math.sqrt((similarity - SIMILARITY_THRESHOLDS.MEDIUM) / (SIMILARITY_THRESHOLDS.HIGH - SIMILARITY_THRESHOLDS.MEDIUM))
                    score = hasKeywordMatch
                        ? 70 + 20 * param
                        : 60 + 20 * param;
                } else if (similarity >= SIMILARITY_THRESHOLDS.LOW) {
                    const param = Math.sqrt((similarity - SIMILARITY_THRESHOLDS.LOW) / (SIMILARITY_THRESHOLDS.MEDIUM - SIMILARITY_THRESHOLDS.LOW))
                    score = hasKeywordMatch
                        ? 30 + 30 * param
                        : 20 + 40 * param;
                }
            }
            
            // 根据匹配位置微调分数
            if (hasKeywordMatch) {
                score += (keywordMatch.title ? 5 : 0) +
                        (keywordMatch.tags ? 3 : 0) +
                        (keywordMatch.url ? 2 : 0) +
                        (keywordMatch.excerpt ? 2 : 0);
            }
            
            score = Math.min(100, Math.max(0, score));
            
            return {
                ...item,
                score,
                similarity,
                keywordMatch
            };
        };

        // 处理所有书签
        const results = Object.values(allBookmarks)
            .map(item => calculateBookmarkScore(item))
         
        if (DEBUG) {
            // 打印详细的匹配信息用于调试
            results.sort((a, b) => b.score - a.score || b.similarity - a.similarity);
            logger.debug('搜索结果详情:', results.map(r => ({
                title: r.title,
                score: Math.round(r.score),
                similarity: r.similarity.toFixed(3),
                keywordMatch: r.keywordMatch
            })));
        }
    
        const filteredResults = results.filter(item => {
            if (Object.values(item.keywordMatch).some(match => match)) {
                return true;
            }
            if (apiService.isCustom) {  
                if (hideLowSimilarity && item.similarity < highSimilarity) {
                    return false;
                }
                return true;
            }
            return item.score >= 60;
        });
        // 按分数降序排序, 分数相同按相似度排序
        filteredResults.sort((a, b) => b.score - a.score || b.similarity - a.similarity);
        
        return filteredResults.slice(0, maxResults);
    }

    // 计算余弦相似度
    cosineSimilarity(vec1, vec2) {
        if (!vec1 || !vec2 || vec1.length === 0 || vec2.length === 0) {
            return 0;
        }

        const dotProduct = vec1.reduce((sum, val, i) => sum + val * vec2[i], 0);
        const magnitudeA = Math.sqrt(vec1.reduce((sum, val) => sum + val * val, 0));
        const magnitudeB = Math.sqrt(vec2.reduce((sum, val) => sum + val * val, 0));
        
        return magnitudeA && magnitudeB ? dotProduct / (magnitudeA * magnitudeB) : 0;
    }
}

// 搜索历史管理器
class SearchHistoryManager {
    constructor() {
        this.MAX_HISTORY = 50;
        this.MAX_HISTORY_SHOW = 8;
        this.MAX_HISTORY_SHOW_QUICK = 4;
        this.MAX_CACHE_HISTORY = 125;
        this.STORAGE_KEY = 'recentSearches';
        this.VECTOR_CACHE_KEY = 'searchVectorCache';
        this.historyCache = null;
    }

    async getHistory(fromCache = true) {
        if (fromCache && this.historyCache) {
            logger.debug('搜索历史缓存命中');
            return this.historyCache;
        }
        logger.debug('搜索历史缓存未命中', { fromCache });
        const history = await LocalStorageMgr.get(this.STORAGE_KEY) || [];
        this.historyCache = history;
        return history;
    }

    async addSearch(query) {
        if (!query) return;

        let history = await this.getHistory(false);
        // 移除重复项
        history = history.filter(item => item.query !== query);
        // 添加到开头
        history.unshift({
            query,
            timestamp: Date.now()
        });
        // 保持最大数量
        history = history.slice(0, this.MAX_HISTORY);
        await LocalStorageMgr.set(this.STORAGE_KEY, history);
        this.historyCache = null;
    }

    async removeSearch(query) {
        if (!query) return;
        
        let history = await this.getHistory(false);
        // 移除指定的搜索项
        history = history.filter(item => item.query !== query);
        await LocalStorageMgr.set(this.STORAGE_KEY, history);
        this.historyCache = null;
    }

    async clearHistory() {
        // 清除搜索历史
        await LocalStorageMgr.remove(this.STORAGE_KEY);
        this.historyCache = null;
    }

    async getVectorCache() {
        return await LocalStorageMgr.get(this.VECTOR_CACHE_KEY) || {};
    }

    async cacheVector(query, vector, service) {
        const cache = await this.getVectorCache();
        cache[query] = {
            vector,
            serviceId: service.id,
            embedModel: service.embedModel,
            timestamp: Date.now()
        };
        
        // 如果缓存项超过上限，删除最旧的
        const entries = Object.entries(cache);
        if (entries.length > this.MAX_CACHE_HISTORY) {
            // 按时间戳排序
            entries.sort((a, b) => b[1].timestamp - a[1].timestamp);
            // 只保留最新的10个
            const newCache = Object.fromEntries(entries.slice(0, this.MAX_CACHE_HISTORY));
            await LocalStorageMgr.set(this.VECTOR_CACHE_KEY, newCache);
        } else {
            await LocalStorageMgr.set(this.VECTOR_CACHE_KEY, cache);
        }
    }

    async getVector(query) {
        const cache = await this.getVectorCache();
        const activeService = await ConfigManager.getEmbeddingService();
        if (cache[query] && cache[query].serviceId === activeService.id && cache[query].embedModel === activeService.embedModel) {
            return cache[query].vector;
        }
        return null;
    }

    async clearVectorCache() {
        await LocalStorageMgr.remove(this.VECTOR_CACHE_KEY);
    }
}

// 导出搜索管理器实例
const searchManager = new SearchManager(); 