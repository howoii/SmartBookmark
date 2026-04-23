/**
 * 国际化（i18n）管理工具类
 */
class I18nManager {
    constructor() {
        this.M = this.getMessage;
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
            
            const tagName = element.tagName.toLowerCase();
            if ((tagName === 'input' && (element.type === 'text' || element.type === 'search')) ||
                tagName === 'textarea') {
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

        document.querySelectorAll('[data-i18n-tooltip]').forEach(element => {
            const messageName = element.getAttribute('data-i18n-tooltip');
            const text = this.getMessage(messageName);
            element.setAttribute('data-tooltip', text);
        });

        document.querySelectorAll('[data-i18n-alt]').forEach(element => {
            const messageName = element.getAttribute('data-i18n-alt');
            const text = this.getMessage(messageName);
            element.alt = text;
        });

        document.querySelectorAll('[data-i18n-aria-label]').forEach(element => {
            const messageName = element.getAttribute('data-i18n-aria-label');
            const text = this.getMessage(messageName);
            element.setAttribute('aria-label', text);
        });

        document.querySelectorAll('[data-i18n-placeholder]').forEach(element => {
            const messageName = element.getAttribute('data-i18n-placeholder');
            const text = this.getMessage(messageName);
            element.placeholder = text;
        });
    }

    updateNodeText(node) {
        if (!node) {
            return;
        }

        node.querySelectorAll('[data-i18n]').forEach(element => {
            const messageName = element.getAttribute('data-i18n');
            const text = this.getMessage(messageName);
            
            const tagName = element.tagName.toLowerCase();
            if ((tagName === 'input' && (element.type === 'text' || element.type === 'search')) ||
                tagName === 'textarea') {
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

        node.querySelectorAll('[data-i18n-tooltip]').forEach(element => {
            const messageName = element.getAttribute('data-i18n-tooltip');
            const text = this.getMessage(messageName);
            element.setAttribute('data-tooltip', text);
        });

        node.querySelectorAll('[data-i18n-alt]').forEach(element => {
            const messageName = element.getAttribute('data-i18n-alt');
            const text = this.getMessage(messageName);
            element.alt = text;
        });

        node.querySelectorAll('[data-i18n-aria-label]').forEach(element => {
            const messageName = element.getAttribute('data-i18n-aria-label');
            const text = this.getMessage(messageName);
            element.setAttribute('aria-label', text);
        });

        node.querySelectorAll('[data-i18n-placeholder]').forEach(element => {
            const messageName = element.getAttribute('data-i18n-placeholder');
            const text = this.getMessage(messageName);
            element.placeholder = text;
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
