/**
 * 主题管理器
 * 负责处理主题的切换、系统主题的监听等功能
 */
class ThemeManager {
    static #instance = null;
    #currentTheme = null;
    #systemThemeMediaQuery = null;

    constructor() {
        if (ThemeManager.#instance) {
            return ThemeManager.#instance;
        }
        ThemeManager.#instance = this;
        this.init();
    }

    /**
     * 初始化主题管理器
     */
    async init() {
        // 初始化系统主题监听
        this.#systemThemeMediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
        this.#systemThemeMediaQuery.addEventListener('change', () => this.handleSystemThemeChange());
        
        // 监听设置变化
        chrome.runtime.onMessage.addListener(this.handleMessage.bind(this));
        
        // 获取当前主题设置
        await this.loadAndApplyTheme();
    }

    /**
     * 处理消息
     * @param {Object} message - 消息
     * @param {Object} sender - 发送者
     * @param {Function} sendResponse - 发送响应
     */
    async handleMessage(message, sender, sendResponse) {
        if (message.type === MessageType.THEME_CHANGED) {
            await this.loadAndApplyTheme();
        }
    }

    /**
     * 加载并应用主题
     */
    async loadAndApplyTheme() {
        try {
            const settings = await SettingsManager.get('display.theme');
            this.#currentTheme = settings.mode;
            logger.info('加载主题设置成功, 应用主题:', settings.mode);
            this.applyTheme(settings.mode);
        } catch (error) {
            logger.error('加载主题设置失败:', error);
            // 默认使用系统主题
            this.applyTheme('system');
        }
    }

    /**
     * 应用指定的主题
     * @param {string} theme - 主题模式：'light' | 'dark' | 'system'
     */
    applyTheme(theme) {
        const root = document.documentElement;
        
        // 移除所有主题相关的属性
        root.removeAttribute('data-theme');
        
        // 设置新的主题
        if (theme === 'system') {
            root.setAttribute('data-theme', 'system');
        } else {
            root.setAttribute('data-theme', theme);
        }
        
        this.#currentTheme = theme;
    }

    /**
     * 处理系统主题变化
     */
    handleSystemThemeChange() {
        if (this.#currentTheme === 'system') {
            this.applyTheme('system');
        }
    }

    /**
     * 获取当前主题
     * @returns {string} 当前主题模式
     */
    getCurrentTheme() {
        return this.#currentTheme;
    }

    /**
     * 更新主题设置
     * @param {Object} themeSettings - 新的主题设置
     */
    async updateTheme(themeSettings) {
        try {
            await updateSettingsWithSync({
                display: {
                    theme: themeSettings
                }
            });
            sendMessageSafely({
                type: MessageType.THEME_CHANGED
            });
            await this.loadAndApplyTheme();
        } catch (error) {
            logger.error('更新主题设置失败:', error);
            throw error;
        }
    }
}

// 导出单例实例
const themeManager = new ThemeManager(); 