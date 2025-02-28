/**
 * 国际化（i18n）管理工具类
 */
class I18nManager {
    constructor() {
        this.defaultLocale = 'zh_CN';
        this.currentLocale = this.getCurrentLocale();
        this.M = this.getMessage;
    }

    /**
     * 获取当前语言设置
     * @returns {string} 当前语言代码
     */
    getCurrentLocale() {
        return chrome.i18n.getUILanguage() || this.defaultLocale;
    }

    /**
     * 获取翻译文本
     * @param {string} messageName - 消息名称
     * @param {Array} substitutions - 替换参数
     * @returns {string} 翻译后的文本
     */
    getMessage(messageName, substitutions = []) {
        return chrome.i18n.getMessage(messageName, substitutions) || messageName;
    }

    /**
     * 更新页面上所有带有 data-i18n 属性的元素的文本
     */
    updatePageText() {
        document.querySelectorAll('[data-i18n]').forEach(element => {
            const messageName = element.getAttribute('data-i18n');
            const text = this.getMessage(messageName);
            
            if (element.tagName.toLowerCase() === 'input' && 
                (element.type === 'text' || element.type === 'search')) {
                element.placeholder = text;
            } else {
                element.textContent = text;
            }
        });

        document.querySelectorAll('[data-i18n-title]').forEach(element => {
            const messageName = element.getAttribute('data-i18n-title');
            const text = this.getMessage(messageName);
            element.title = text;
        });
    }

    updateNodeText(node) {
        if (!node) {
            return;
        }

        node.querySelectorAll('[data-i18n]').forEach(element => {
            const messageName = element.getAttribute('data-i18n');
            const text = this.getMessage(messageName);
            
            if (element.tagName.toLowerCase() === 'input' && 
                (element.type === 'text' || element.type === 'search')) {
                element.placeholder = text;
            } else {
                element.textContent = text;
            }
        });

        node.querySelectorAll('[data-i18n-title]').forEach(element => {
            const messageName = element.getAttribute('data-i18n-title');
            const text = this.getMessage(messageName);
            element.title = text;
        });
    }

    /**
     * 初始化页面国际化
     */
    initializeI18n() {
        // 更新页面文本
        this.updatePageText();
    }
}

// 创建全局实例
const i18n = new I18nManager();

// 只在网页环境中初始化
if (typeof window !== 'undefined' && typeof document !== 'undefined') {
    i18n.initializeI18n();
}
