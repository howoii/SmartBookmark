// 添加书签数据源枚举
const BookmarkSource = {
    EXTENSION: 'extension',
    CHROME: 'chrome'
};

// 统一的书签数据结构
class UnifiedBookmark {
    constructor(data, source) {
        this.url = data.url;
        this.title = data.title;
        this.source = source;
        
        if (source === BookmarkSource.EXTENSION) {
            this.tags = data.tags;
            this.excerpt = data.excerpt;
            this.embedding = data.embedding;
            // 这里需要确保日期格式的一致性
            this.savedAt = data.savedAt ? new Date(data.savedAt).toISOString() : new Date().toISOString();
            this.useCount = data.useCount;
            this.lastUsed = data.lastUsed ? new Date(data.lastUsed).toISOString() : null;
            this.apiService = data.apiService;
            this.embedModel = data.embedModel;
            this.isCached = data.isCached;
        } else {
            this.tags = [...data.folderTags || []];
            this.excerpt = '';
            this.embedding = null;
            // Chrome书签的日期是时间戳（毫秒）
            this.savedAt = new Date(data.dateAdded).toISOString();
            this.useCount = 0;
            this.lastUsed = data.dateLastUsed ? new Date(data.dateLastUsed).toISOString() : null;
            this.chromeId = data.id;
        }
    }
}