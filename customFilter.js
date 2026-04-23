// 筛选规则管理器
class CustomFilter {
    constructor() {
        this.STORAGE_KEY = 'customFilters';
        this.STORAGE_KEY_ORDER = 'customFiltersOrder';
        this.STORAGE_KEY_HIDDEN = 'customFiltersHidden';
        this.ARCHIVE_KEY = 'customFiltersArchive';
        this.MAX_ARCHIVES = 10;
        this.rules = [];
        this.orderedIds = [];
        this.hiddenIds = [];
        this.initialized = false;
        // 内置的筛选规则
        this.builtInRules = [
            {
                id: 'recent-bookmarks',
                name: i18n.getMessage('settings_filters_built_in_rule_today_added'),
                isBuiltIn: true,
                conditions: [
                    {
                        field: 'create',
                        operator: '=',
                        value: 1
                    }
                ]
            },
            {
                id: 'today-used',
                name: i18n.getMessage('settings_filters_built_in_rule_today_used'),
                isBuiltIn: true,
                conditions: [
                    {
                        field: 'lastUse',
                        operator: '=',
                        value: 1
                    }
                ]
            }
        ];
    }

    async init() {
        if (this.initialized) return;
        
        try {
            const stored = await chrome.storage.sync.get(this.STORAGE_KEY);
            this.rules = stored[this.STORAGE_KEY] || [];
            const storedOrder = await chrome.storage.sync.get(this.STORAGE_KEY_ORDER);
            this.orderedIds = storedOrder[this.STORAGE_KEY_ORDER] || [];
            const storedHidden = await chrome.storage.sync.get(this.STORAGE_KEY_HIDDEN);
            this.hiddenIds = storedHidden[this.STORAGE_KEY_HIDDEN] || [];
            this.initialized = true;
        } catch (error) {
            logger.error('初始化筛选规则失败:', error);
        }
    }

    async saveFilterOrder(orderedIds) {
        // 检查顺序是否变化
        if (JSON.stringify(orderedIds) === JSON.stringify(this.orderedIds)) {
            logger.debug('筛选规则顺序未发生变化');
            return;
        }
        logger.debug('筛选规则顺序发生变化');
        // 保存新的顺序
        try {
            await chrome.storage.sync.set({
                [this.STORAGE_KEY_ORDER]: orderedIds
            });
            this.orderedIds = orderedIds;
            await this.archiveCurrentState('reorder');
        } catch (error) {
            logger.error('保存筛选规则顺序失败:', error);
        }
    }

    // 保存规则到存储
    async saveRule(rule) {
        try {
            // 检查是否存在相同ID的规则
            const existingIndex = this.rules.findIndex(r => r.id === rule.id);
            if (existingIndex !== -1) {
                // 更新现有规则
                this.rules[existingIndex] = rule;
            } else {
                // 添加新规则
                this.rules.push(rule);
            }

            await chrome.storage.sync.set({
                [this.STORAGE_KEY]: this.rules
            });
            await this.archiveCurrentState('save_rule');
            return true;
        } catch (error) {
            logger.error('保存筛选规则失败:', error);
            return false;
        }
    }

    // 删除规则（同步清理 hiddenIds 和 groupSort 中的孤立数据）
    async deleteRule(ruleId) {
        try {
            this.rules = this.rules.filter(r => r.id !== ruleId);
            this.hiddenIds = this.hiddenIds.filter(id => id !== ruleId);
            await chrome.storage.sync.set({
                [this.STORAGE_KEY]: this.rules,
                [this.STORAGE_KEY_HIDDEN]: this.hiddenIds
            });
            await this.archiveCurrentState('delete_rule');

            return true;
        } catch (error) {
            logger.error('删除筛选规则失败:', error);
            return false;
        }
    }

    async toggleHidden(ruleId) {
        const idx = this.hiddenIds.indexOf(ruleId);
        if (idx === -1) {
            this.hiddenIds.push(ruleId);
        } else {
            this.hiddenIds.splice(idx, 1);
        }
        try {
            await chrome.storage.sync.set({
                [this.STORAGE_KEY_HIDDEN]: this.hiddenIds
            });
            await this.archiveCurrentState('toggle_hidden');
        } catch (error) {
            logger.error('保存隐藏状态失败:', error);
        }
    }

    isHidden(ruleId) {
        return this.hiddenIds.includes(ruleId);
    }

    getVisibleRules() {
        return this.getRules().filter(rule => !this.hiddenIds.includes(rule.id));
    }

    async reloadRules() {
        this.initialized = false;
        await this.init();
    }

    async archiveCurrentState(trigger) {
        try {
            if (!this.initialized) {
                await this.init();
            }
            const archives = await this.getArchives();
            const now = Date.now();
            archives.unshift({
                id: now.toString(),
                timestamp: now,
                trigger,
                snapshot: {
                    rules: JSON.parse(JSON.stringify(this.rules)),
                    orderedIds: [...this.orderedIds],
                    hiddenIds: [...this.hiddenIds]
                }
            });
            if (archives.length > this.MAX_ARCHIVES) {
                archives.splice(this.MAX_ARCHIVES);
            }
            await LocalStorageMgr.set(this.ARCHIVE_KEY, archives);
        } catch (error) {
            logger.error('存档筛选规则失败:', error);
        }
    }

    async getArchives() {
        try {
            const archives = await LocalStorageMgr.get(this.ARCHIVE_KEY);
            return archives || [];
        } catch (error) {
            logger.error('获取筛选规则存档失败:', error);
            return [];
        }
    }

    async restoreFromArchive(archiveId) {
        try {
            const archives = await this.getArchives();
            const archive = archives.find(a => a.id === archiveId);
            if (!archive) {
                logger.error('未找到指定存档:', archiveId);
                return false;
            }
            this.rules = archive.snapshot.rules;
            this.orderedIds = archive.snapshot.orderedIds;
            this.hiddenIds = archive.snapshot.hiddenIds || [];
            await chrome.storage.sync.set({
                [this.STORAGE_KEY]: this.rules,
                [this.STORAGE_KEY_ORDER]: this.orderedIds,
                [this.STORAGE_KEY_HIDDEN]: this.hiddenIds
            });
            await this.archiveCurrentState('restore');
            return true;
        } catch (error) {
            logger.error('恢复筛选规则存档失败:', error);
            return false;
        }
    }

    // 获取所有规则
    getRules() {
        const rules = [...this.builtInRules, ...this.rules];
        if (this.orderedIds.length > 0) {
            return rules.sort((a, b) => {
                const indexA = this.orderedIds.indexOf(a.id);
                const indexB = this.orderedIds.indexOf(b.id);
                // 如果两个都不在orderedIds中，保持原有顺序
                if (indexA === -1 && indexB === -1) return 0;
                // 如果其中一个不在orderedIds中，将其排在后面
                if (indexA === -1) return 1;
                if (indexB === -1) return -1;
                // 都在orderedIds中，按照索引排序
                return indexA - indexB;
            });
        }
        return rules;
    }

    async getExportData() {
        await this.reloadRules();
        return {
            rules: this.rules || [],
            orderedIds: this.orderedIds || [],
            hiddenIds: this.hiddenIds || []
        };
    }

    async importFilters(filters, overwrite = false) {
        try {
            // 确保初始化完成
            if (!this.initialized) {
                await this.init();
            }

            // 验证导入的数据格式
            if (!Array.isArray(filters.rules) || !Array.isArray(filters.orderedIds)) {
                logger.error('导入的筛选规则格式无效');
                return;
            }
    
            const newRules = filters.rules.filter(rule => {
                // 验证规则格式
                if (!rule.id || !rule.name || !Array.isArray(rule.conditions)) {
                    logger.warn(`跳过无效的规则: ${rule}`);
                    return false;
                }
                return true;
            });
            if (!overwrite) {
                const existingIds = new Set(this.rules.map(rule => rule.id));
                const filteredRules = newRules.filter(rule => {
                    return !existingIds.has(rule.id);
                });
                
                this.rules = [...this.rules, ...filteredRules];
                this.orderedIds = filters.orderedIds || [];
                // 合并模式：保留本地隐藏状态，合并远端新增的
                if (Array.isArray(filters.hiddenIds)) {
                    const mergedHidden = new Set([...this.hiddenIds, ...filters.hiddenIds]);
                    this.hiddenIds = [...mergedHidden];
                }
            } else {
                this.rules = newRules;
                this.orderedIds = filters.orderedIds || [];
                this.hiddenIds = Array.isArray(filters.hiddenIds) ? filters.hiddenIds : [];
            }
    
            await chrome.storage.sync.set({
                [this.STORAGE_KEY]: this.rules,
                [this.STORAGE_KEY_ORDER]: this.orderedIds,
                [this.STORAGE_KEY_HIDDEN]: this.hiddenIds
            });
            await this.archiveCurrentState('import');
    
        } catch (error) {
            logger.error('导入筛选规则失败:', error);
            throw error;
        }
    }

    // 根据规则筛选书签
    async filterBookmarks(bookmarks, rule) {
        if (!rule) return bookmarks;

        const filteredBookmarks = bookmarks.filter(bookmark => {
            return this.evaluateBookmark(bookmark, rule.conditions);
        });
        return filteredBookmarks;
    }

    // 评估单个条件
    evaluateCondition(bookmark, condition) {
        const { field, operator, value } = condition;

        const isValid = CustomFilterConditions.validateCondition(condition);
        if (!isValid) {
            logger.warn(`跳过无效的条件: ${condition}`);
            return true;
        }
        
        switch (field) {
            case 'title':
                return this.evaluateTextCondition(bookmark.title, condition);
                
            case 'domain':
                const domain = new URL(bookmark.url).hostname;
                return this.evaluateTextCondition(domain, condition);
            
            case 'url':
                return this.evaluateTextCondition(bookmark.url, condition);
                
            case 'tag':
                return this.evaluateTagCondition(bookmark.tags, condition);
                
            case 'create':
                const createDays = this.getDaysDifference(new Date(bookmark.savedAt));
                return this.evaluateNumberCondition(createDays, operator, value);
                
            case 'lastUse':
                const lastUse = bookmark.lastUsed ? new Date(bookmark.lastUsed) : new Date(bookmark.savedAt);
                const lastUseDays = this.getDaysDifference(lastUse);
                return this.evaluateNumberCondition(lastUseDays, operator, value);
                
            case 'use':
                return this.evaluateNumberCondition(bookmark.useCount || 0, operator, value);
                
            default:
                return true;
        }
    }

    // 评估文本条件
    evaluateTextCondition(text, condition) {
        if (!text) return false;
        text = text.toLowerCase();

        const values = CustomFilterConditions.getConditionArrayValue(condition);
        if (!values) return false;

        const { operator } = condition;  
        switch (operator) {
            case 'is':
                return values.some(v => text === v.toLowerCase());
            case 'isNot':
                return !values.some(v => text === v.toLowerCase());
            case 'has':
                return values.some(v => text.includes(v.toLowerCase()));
            case 'notHas':
                return !values.some(v => text.includes(v.toLowerCase()));
            default:
                return false;
        }
    }

    // 评估标签条件
    evaluateTagCondition(tags, condition) {
        if (!tags || !Array.isArray(tags)) return false;
        const lowerTags = tags.map(t => t.toLowerCase());

        const values = CustomFilterConditions.getConditionArrayValue(condition);
        if (!values) return false;
        
        const { operator } = condition;
        switch (operator) {
            case 'is':
                return values.some(v => lowerTags.some(tag => tag === v.toLowerCase()));
            case 'isNot':
                return !values.some(v => lowerTags.some(tag => tag === v.toLowerCase()));
            case 'has':
                return values.some(v => lowerTags.some(tag => tag.includes(v.toLowerCase())));
            case 'notHas':
                return !values.some(v => lowerTags.some(tag => tag.includes(v.toLowerCase())));
            default:
                return false;
        }
    }

    // 评估数字条件
    evaluateNumberCondition(number, operator, value) {
        const numValue = parseInt(value);
        if (isNaN(numValue)) return false;
        
        switch (operator) {
            case '>':
                return number > numValue;
            case '<':
                return number < numValue;
            case '=':
                return number === numValue;
            default:
                return false;
        }
    }

    // 计算天数差异
    getDaysDifference(date) {
        const now = new Date();
        // 将两个日期都设置为当天的 00:00:00
        const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const startOfTargetDay = new Date(date.getFullYear(), date.getMonth(), date.getDate());
        // 计算天数差
        const diffTime = Math.abs(startOfToday - startOfTargetDay);
        return Math.floor(diffTime / (1000 * 60 * 60 * 24)) + 1;
    }

    // 评估书签是否匹配规则条件
    evaluateBookmark(bookmark, conditions) {
        // 如果没有条件，返回 true
        if (!conditions || conditions.length === 0) {
            return true;
        }
        
        // 遍历所有条件
        return conditions.every(condition => {
            // 如果是条件组（数组），则组内条件是"或"关系
            if (Array.isArray(condition)) {
                return condition.some(groupCondition => 
                    this.evaluateCondition(bookmark, groupCondition)
                );
            }
            // 单个条件直接评估
            return this.evaluateCondition(bookmark, condition);
        });
    }
}

class CustomFilterConditions {
    static fields = [
        { value: 'title', label: i18n.getMessage('settings_filters_field_title'), isNumber: false, operatorGroup: 'text'},
        { value: 'domain', label: i18n.getMessage('settings_filters_field_domain'), isNumber: false, operatorGroup: 'text' },
        { value: 'url', label: i18n.getMessage('settings_filters_field_url'), isNumber: false, operatorGroup: 'text' },
        { value: 'tag', label: i18n.getMessage('settings_filters_field_tag'), isNumber: false, operatorGroup: 'textArray' },
        { value: 'create', label: i18n.getMessage('settings_filters_field_create'), isNumber: true, unit: i18n.getMessage('settings_filters_unit_days'), operatorGroup: 'number' },
        { value: 'lastUse', label: i18n.getMessage('settings_filters_field_last_use'), isNumber: true, unit: i18n.getMessage('settings_filters_unit_days'), operatorGroup: 'number' },
        { value: 'use', label: i18n.getMessage('settings_filters_field_use'), isNumber: true, unit: i18n.getMessage('settings_filters_unit_times'), operatorGroup: 'number' }
    ];
        
    static operators = {
        text: [
            { value: 'is', label: i18n.getMessage('settings_filters_operator_is')},
            { value: 'isNot', label: i18n.getMessage('settings_filters_operator_is_not') },
            { value: 'has', label: i18n.getMessage('settings_filters_operator_has'), isArray: true },
            { value: 'notHas', label: i18n.getMessage('settings_filters_operator_not_has'), isArray: true }
        ],
        number: [
            { value: '>', label: i18n.getMessage('settings_filters_operator_greater') },
            { value: '<', label: i18n.getMessage('settings_filters_operator_less') },
            { value: '=', label: i18n.getMessage('settings_filters_operator_equal') }
        ],
        textArray: [
            { value: 'is', label: i18n.getMessage('settings_filters_operator_is'), isArray: true },
            { value: 'isNot', label: i18n.getMessage('settings_filters_operator_is_not'), isArray: true },
            { value: 'has', label: i18n.getMessage('settings_filters_operator_has'), isArray: true },
            { value: 'notHas', label: i18n.getMessage('settings_filters_operator_not_has'), isArray: true }
        ],
    };

    static getFields() {
        // 返回字段副本
        return this.fields.map(field => ({ ...field }));
    }
    
    static getFieldSettings(field) {
        const fieldDef = this.fields.find(f => f.value === field);
        if (!fieldDef) return null;
        
        // 返回字段设置的副本
        return { ...fieldDef };
    }

    static getOperators(operatorGroup) {
        if (!operatorGroup) {
            // 返回所有操作符组
            const result = {};
            for (const [key, ops] of Object.entries(this.operators)) {
                result[key] = ops.map(op => ({ ...op }));
            }
            return result;
        }
        const ops = this.operators[operatorGroup];
        if (!ops) return null;
        // 返回操作符副本
        return ops.map(op => ({ ...op }));
    }

    static getOperatorSetting(operatorGroup, operator) {
        const ops = this.getOperators(operatorGroup);
        if (!ops) {
            return null;
        } else {
            return ops.find(o => o.value === operator);
        }
    }

    static validateCondition(condition) {
        const { field, operator, value, arrayValue } = condition;
        const fieldSetting = this.getFieldSettings(field);
        if (!fieldSetting) {
            return false;
        }
        const operatorGroup = fieldSetting.operatorGroup;
        const opSetting = this.getOperatorSetting(operatorGroup, operator);
        if (!opSetting) {
            return false;
        }
        // 检查值是否为空
        if (value === '' || value === null || value === undefined) {
            return false;
        }
        // 如果是数组（标签），检查是否为空数组
        if (arrayValue && Array.isArray(arrayValue) && arrayValue.length === 0) {
            return false;
        }
        // 检查是否为数字
        const isNumber = fieldSetting?.isNumber;
        if (isNumber) {
            const num = parseInt(value);
            if (isNaN(num) || num < 0) {
                return false;
            }
        }
        
        return true;
    }

    static getConditionArrayValue(condition) {
        if (condition.arrayValue) {
            return condition.arrayValue;
        }
        if (Array.isArray(condition.value)) {
            return condition.value;
        }
        return [condition.value];
    }
}

// 导出单例实例
const customFilter = new CustomFilter();
