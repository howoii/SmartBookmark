(() => {
    const INIT_FLAG = Symbol('contentScriptInitialized');
    if (window[INIT_FLAG]) {
        return;
    }
    window[INIT_FLAG] = true;
    // ... 其余代码

    const SB_DEBUG = true;

    const logger = {
        log: (...args) => {
            if (SB_DEBUG) {
                console.log('%c[Content Script]', 'color: blue; font-weight: bold;', ...args);
            }
        },
        error: (...args) => {
            if (SB_DEBUG) {
                console.log('%c[Content Script]', 'color: red; font-weight: bold;', ...args);
            }
        },
        info: (...args) => {
            if (SB_DEBUG) {
                console.log('%c[Content Script]', 'color: green; font-weight: bold;', ...args);
            }
        }
    };

    // 确保消息监听器只添加一次
    if (!window.hasContentScriptListener) {
        window.hasContentScriptListener = true;

        chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
            if (request.action === "getContent") {
                logger.info('收到内容提取请求');

                // 使用 async/await 处理异步操作
                (async () => {
                    try {
                        const content = await extractContent();
                        logger.info('内容提取成功，准备发送响应');
                        sendResponse(content);
                    } catch (error) {
                        logger.error('内容提取失败:', error);
                        sendResponse(null);
                    }
                })();

                return true; // 保持消息通道开放
            }
        });
    }

    function cleanContent(content) {
        return content
            .replace(/\s+/g, ' ')           // 将多个空白字符替换为单个空格
            .replace(/[\r\n]+/g, ' ')       // 将换行符替换为空格
            .replace(/\t+/g, ' ')           // 将制表符替换为空格
            .trim();                        // 去除首尾空白
    }

    async function extractContent() {
        try {
            logger.info('开始提取页面内容...');

            const documentClone = document.cloneNode(true);
            logger.log('文档克隆完成');

            const isReaderable = isProbablyReaderable(documentClone);
            logger.log('isReaderable:', isReaderable);

            const article = new Readability(documentClone).parse();
            logger.log('Readability 解析结果:', article);

            const metadata = extractMetadata();
            logger.log('提取的元数据:', metadata);

            if (!article) {
                logger.info('Readability 解析结果为空');
                return {};
            } 

            const result = {
                title: article.title || document.title,
                content: cleanContent(article.textContent),
                excerpt: cleanContent(article.excerpt),
                siteName: article.siteName,
                isReaderable: isReaderable,
                metadata: metadata
            };

            logger.info('内容提取完成:', result);
            return result;

        } catch (error) {
            logger.error('Readability 解析失败， 使用 fallbackExtraction:', error);
            return fallbackExtraction();
        }
    }

    function extractMetadata() {
        const metadata = {};

        // 提取 meta 标签信息，不修改原标签
        const metaTags = {
            description: document.querySelector('meta[name="description"]')?.getAttribute('content'),
            keywords: document.querySelector('meta[name="keywords"]')?.getAttribute('content'),
            author: document.querySelector('meta[name="author"]')?.getAttribute('content'),
            'publish-date': document.querySelector('meta[property="article:published_time"]')?.getAttribute('content')
        };

        // 只添加存在的元数据
        Object.entries(metaTags).forEach(([key, value]) => {
            if (value) {
                metadata[key] = value;
            }
        });

        // 提取 Schema.org 结构化数据
        const schemaScripts = document.querySelectorAll('script[type="application/ld+json"]');
        if (schemaScripts.length > 0) {
            try {
                metadata.schema = Array.from(schemaScripts)
                    .map(script => JSON.parse(script.textContent))
                    .filter(Boolean);
            } catch (e) {
                logger.error('解析 Schema.org 数据失败:', e);
            }
        }

        return metadata;
    }

    function fallbackExtraction() {
        logger.info('fallbackExtraction');
        // 创建一个新的容器来存放内容
        const tempContainer = document.createElement('div');

        // 获取主要内容区域（不修改原内容）
        const mainContent = document.querySelector('main') ||
            document.querySelector('article') ||
            document.querySelector('.content');

        if (mainContent) {
            tempContainer.innerHTML = mainContent.innerHTML;
        } else {
            tempContainer.innerHTML = document.body.innerHTML;
        }

        // 在临时容器中移除不需要的元素
        const selectorsToRemove = [
            'script',
            'style',
            'iframe',
            'nav',
            'header',
            'footer',
            '.ads',
            '.advertisement',
            '.social-share',
            '.comments',
            '[role="complementary"]'
        ];

        selectorsToRemove.forEach(selector => {
            tempContainer.querySelectorAll(selector).forEach(el => el.remove());
        });

        // 获取清理后的文本
        const cleanText = tempContainer.textContent
            .replace(/[\r\n]+/g, '\n')
            .replace(/\s+/g, ' ')
            .trim();

        return {
            title: document.title,
            content: cleanText,
            excerpt: cleanText.slice(0, 200) + '...',
            metadata: extractMetadata()
        };
    }
})();
