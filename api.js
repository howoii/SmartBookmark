function joinUrl(baseUrl, path) {
    if (baseUrl.endsWith('/')) {
        return baseUrl + path;
    }
    return baseUrl + '/' + path;
}

function makeEmbeddingText(pageContent, tab, tags) {
    let text = "";
    if (pageContent && pageContent.title) {
        text += pageContent.title ? `title: ${pageContent.title};` : '';
        text += tags.length > 0 ? `tags: ${tags.join(',')};` : '';
        text += pageContent.excerpt ? `excerpt: ${smartTruncate(pageContent.excerpt, 200)};` : '';
    } else {
        const cleanUrl = tab.url.replace(/\?.+$/, '').replace(/[#&].*$/, '').replace(/\/+$/, '');
        text += `title: ${tab.title};`;
        text += tags.length > 0 ? `tags: ${tags.join(',')};` : '';
        text += `url: ${cleanUrl};`;
    }
    
    // 优化的文本清理
    text = text
        .replace(/[\r\n]+/g, ' ')        // 将所有换行符替换为空格
        .replace(/\s+/g, ' ')            // 将连续空白字符替换为单个空格
        .replace(/[\t\f\v]+/g, ' ')      // 替换制表符等特殊空白字符
        .trim();                         // 去除首尾空格
    
    // 限制总长度（考虑token限制）
    const maxLength = 4096;
    if (text.length > maxLength) {
        // 尝试在词边界处截断
        const truncated = text.slice(0, maxLength);
        // 找到最后一个完整词的位置
        const lastSpace = truncated.lastIndexOf(' ');
        if (lastSpace > maxLength * 0.8) { // 如果找到的位置会损失太多内容
            text = truncated.slice(0, lastSpace);
        } else {
            text = truncated;
        }
    }
    
    return text;
}

// 嵌入向量生成函数
async function getEmbedding(text) {
    logger.debug('生成嵌入向量:', text);
    try {
        // 使用专门用于embedding的服务
        const apiService = await ConfigManager.getEmbeddingService();
        const apiKey = apiService.apiKey;
        if (!apiKey || !apiService.embedModel) {
            throw new Error('未配置有效的向量模型');
        }
        const response = await fetch(joinUrl(apiService.baseUrl, 'embeddings'), {
            method: 'POST',
            headers: getHeaders(apiKey),
            body: JSON.stringify({
                model: apiService.embedModel,
                input: text,
                dimensions: 1024
            })
        });

        // 检查错误码
        if (!response.ok) {
            let errorMessage = response.statusText || `API 返回状态码: ${response.status}` || '未知错误';
            try {
                const errorData = await response.json();
                if (typeof errorData === 'string') {
                    errorMessage = errorData;
                } else {
                    errorMessage = errorData.error?.message || errorData.message || errorMessage;
                }
            } catch (error) {
                logger.debug('获取错误信息失败:', error);
            }
            throw new Error(`${errorMessage}`);
        }

        // 获取嵌入向量
        try {
            const data = await response.json();
            logger.debug('embedding response:', data);
            if (!data.data?.[0]?.embedding) {
                throw new Error('无效的API响应格式');
            }
             // 记录使用统计    
            await statsManager.recordEmbeddingUsage(data.usage?.total_tokens || 0);
            return data.data[0].embedding;
        } catch (error) {
            throw new Error(`${error.message}`);
        }
    } catch (error) {
        logger.error(`获取嵌入向量失败: ${error.message}`);
    }
    return null;
}

async function getChatCompletion(systemPrompt, userPrompt, signal = null) {
    try {
        // 使用专门用于Chat的服务
        const apiService = await ConfigManager.getChatService();
        const apiKey = apiService.apiKey;
        if (!apiKey || !apiService.chatModel) {
            throw new Error('未配置有效的对话模型');
        }   
        // 调用 API 生成标签
        const options = {
            method: 'POST',
            headers: getHeaders(apiKey),
            body: JSON.stringify({
                model: apiService.chatModel,
                messages: [{
                    role: "system",
                    content: systemPrompt
                }, {
                    role: "user",
                    content: userPrompt
                }],
                temperature: 0.3, // 降低温度以获得更稳定的输出
                max_tokens: 100,
            })
        };
        
        // 如果提供了signal，添加到请求选项中
        if (signal) {
            options.signal = signal;
        }
        
        const response = await fetch(joinUrl(apiService.baseUrl, 'chat/completions'), options);

        // 检查错误码
        if (!response.ok) {
            let errorMessage = response.statusText || `API 返回状态码: ${response.status}` || '未知错误';
            try {
                const errorData = await response.json();
                if (typeof errorData === 'string') {
                    errorMessage = errorData;
                } else {
                    errorMessage = errorData.error?.message || errorData.message || errorMessage;
                }
            } catch (error) {
                logger.debug('获取错误信息失败:', error);
            }
            throw new Error(`${errorMessage}`);
        }
        
        try {
            const data = await response.json();
            logger.debug('completion response:', data);
            if (!data.choices?.[0]?.message?.content) {
                throw new Error('无效的API响应格式');
            }
            // 记录使用统计
            await statsManager.recordChatUsage(
                data.usage?.prompt_tokens || 0,
                data.usage?.completion_tokens || 0
            );
            return data.choices[0].message.content.trim();
        } catch (error) {
            throw error;
        }
    } catch (error) {
        if(typeof error === 'string' && error.includes('UserCanceled')){
            throw new Error('UserCanceled');
        }
        logger.error(`Chat Completion 失败: ${error.message}`);
    }
    return null;
}

const SYSTEM_PROMPT_TAGS = i18n.M('prompt_generate_tags_sys');
const USER_PROMPT_TAGS = i18n.M('prompt_generate_tags_user');

function makeChatPrompt(pageContent, tab, prompt) {
    const { content, excerpt, isReaderable, metadata } = pageContent;
    const cleanUrl = tab.url.replace(/\?.+$/, '').replace(/[#&].*$/, '').replace(/\/+$/, '');
    const formatContent =` title: ${tab.title}
url:${cleanUrl}
${excerpt ? `excerpt: ${smartTruncate(excerpt, 300)}` : ''}
${metadata?.keywords ? `keywords: ${metadata.keywords.slice(0, 300)}` : ''}
${content && isReaderable ? `content: ${smartTruncate(content, 500)}` : ''}
`;

    return prompt.replace('{{content}}', formatContent);
}

// 用 ChatGPT API 生成标签
async function generateTags(pageContent, tab) {
    const prompt = makeChatPrompt(pageContent, tab, USER_PROMPT_TAGS);
    logger.debug('生成标签的prompt:\n ', prompt);
    const tagsText = await getChatCompletion(SYSTEM_PROMPT_TAGS, prompt) || '';

    // 处理返回的标签
    let tags = tagsText
        .split('|')
        .map(tag => tag.trim())
        .filter(tag => {
            if (!tag) return false;
            const tagLength = getStringVisualLength(tag);
            logger.debug('标签长度:', {
                tag: tag,
                length: tagLength
            });
            if (tagLength < 2 || tagLength > 20) {
                return false;
            }
            return /^[^\.,\/#!$%\^&\*;:{}=\-_`~()]+$/.test(tag);
        })
        // 添加去重逻辑
        .filter((tag, index, self) => self.indexOf(tag) === index)
        // 限制最多5个标签
        .slice(0, 5);
    logger.debug('AI生成的标签:', tags);

    // 如果没有生成有效标签，使用备选方案
    if (tags.length === 0) {
        tags = getFallbackTags(tab.title, pageContent?.metadata);
    }

    tags = cleanTags(tags);
    return tags.length > 0 ? tags : [i18n.M('ui_tag_unclassified')];
}

// 用 ChatGPT API 生成摘要
const SYSTEM_PROMPT_EXCERPT = `
你是"书签摘要生成助手"，负责从完整的网页内容中提取客观、简洁的要点，生成一段不超过100字的中文摘要。
请严格遵守：
1. 只输出摘要本身，不要包含任何多余说明、引号或标点符号之外的格式。
2. 摘要中不得出现"我"、"我们"等主观评价词，只陈述页面的核心信息。
3. 精确控制在100字以内，超出则自动删减到100字以内。
`;

const USER_PROMPT_EXCERPT = `
下面是网页正文内容，请基于此生成不超过100字的摘要，仅输出摘要，不要添加其他文字：
{{content}}
`;

async function generateExcerpt(pageContent, tab, signal = null) {
    const prompt = makeChatPrompt(pageContent, tab, USER_PROMPT_EXCERPT);
    logger.debug('生成摘要的prompt:\n ', prompt);

    const excerptText = await getChatCompletion(SYSTEM_PROMPT_EXCERPT, prompt, signal) || '';
    return excerptText;
}
