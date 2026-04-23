(() => {
    const INIT_FLAG = Symbol('contentScriptInitialized');
    if (window[INIT_FLAG]) {
        return;
    }
    window[INIT_FLAG] = true;
    // ... 其余代码

    const SB_DEBUG = false;

    const logger = {
        log: (...args) => {
            if (SB_DEBUG) {
                console.log('%c[Content Script]', 'color: blue; font-weight: bold;', ...args);
            }
        },
        error: (...args) => {l
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
            .replace(/[ \t\f\r]*[\r\n]+[ \t\f\r]*/g, '\n')  // 删除换行之间的空白符，并将换行统一为 \n
            .replace(/\n{2,}/g, '\n')                        // 将多个换行替换为单个换行
            .replace(/ +/g, ' ')                             // 将多个连续空格替换为单个空格
            .trim();                                         // 去除首尾空白
    }

    async function extractContent() {
        try {
            logger.info('开始提取页面内容...');

            const documentClone = document.cloneNode(true);
            logger.log('文档克隆完成');

            // const isReaderable = isProbablyReaderable(documentClone);
            const isReaderable = true; // 关闭readerable检查, 优先保证内容准确性，牺牲token使用量
            logger.log('isReaderable:', isReaderable);

            // 配置 Readability 选项
            const readabilityOptions = {
                debug: false, 
                charThreshold: 300,  // 降低字符阈值，适应更多文章
                nbTopCandidates: 7,  // 增加候选元素数量
                linkDensityModifier: 0.1,  // 稍微放宽链接密度限制
                classesToPreserve: ['page', 'content', 'article', 'main'],  // 保留常见的内容类名
                keepClasses: false  // 不保留所有类名，保持清理
            };

            const article = new Readability(documentClone, readabilityOptions).parse();
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
