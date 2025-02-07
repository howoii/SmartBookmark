class APIStatsManager {
    constructor() {
        this.storageKey = 'api_stats';
        this.currentMonth = new Date().getMonth();
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

    async saveStats(stats) {
        try {
            await LocalStorageMgr.set(this.storageKey, stats);
        } catch (error) {
            logger.error('保存API统计数据失败:', error);
        }
    }

    async recordChatUsage(inputTokens, outputTokens) {
        const stats = await this.loadStats();
        stats.chat.calls += 1;
        stats.chat.inputTokens += inputTokens;
        stats.chat.outputTokens += outputTokens;
        await this.saveStats(stats);
    }

    async recordEmbeddingUsage(tokens) {
        const stats = await this.loadStats();
        stats.embedding.calls += 1;
        stats.embedding.tokens += tokens;
        await this.saveStats(stats);
    }
}

const statsManager = new APIStatsManager();