class APIStatsManager {
    constructor() {
        this.storageKey = 'api_stats';
        this.currentMonth = new Date().getMonth();
        this.inited = false;
        this.stats = null;
    }

    async init() {
        if (this.inited) return;
        this.stats = await this.loadStats();
        this.inited = true;
    }

    async loadStats() {
        const defaultStats = {
            month: this.currentMonth,
            chat: {
                calls: 0,
                inputTokens: 0,
                outputTokens: 0
            },
            embedding: {
                calls: 0,
                tokens: 0
            }
        };

        try {
            const saved = await LocalStorageMgr.get(this.storageKey);
            if (!saved) return defaultStats;
            // 如果月份变化，重置统计
            if (saved.month !== this.currentMonth) {
                return defaultStats;
            }
            return saved;
        } catch (error) {
            logger.error('加载API统计数据失败:', error);
            return defaultStats;
        }
    }

    async saveStats() {
        try {
            await LocalStorageMgr.set(this.storageKey, this.stats);
        } catch (error) {
            logger.error('保存API统计数据失败:', error);
        }
    }

    async recordChatUsage(inputTokens, outputTokens) {
        this.stats.chat.calls += 1;
        this.stats.chat.inputTokens += inputTokens;
        this.stats.chat.outputTokens += outputTokens;
        await this.saveStats();
    }

    async recordEmbeddingUsage(tokens) {
        this.stats.embedding.calls += 1;
        this.stats.embedding.tokens += tokens;
        await this.saveStats();
    }
}

const statsManager = new APIStatsManager();