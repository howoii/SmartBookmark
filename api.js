function joinUrl(baseUrl, path) {
    if (baseUrl.endsWith('/')) {
        return baseUrl + path;
    }
    return baseUrl + '/' + path;
}

function makeEmbeddingText(bookmarkInfo) {
    if (!bookmarkInfo) {
        return '';
    }
    let title = bookmarkInfo.title;
    let tags = bookmarkInfo.tags;
    let excerpt = bookmarkInfo.excerpt;

    let text = "";
    text += title ? `title: ${title};` : '';
    text += tags && tags.length > 0 ? `tags: ${tags.join(',')};` : '';
    text += excerpt ? `excerpt: ${smartTruncate(excerpt, 200)};` : '';
    
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

/**
 * 估算文本的 token 数量
 * 根据不同语言类型使用不同的估算策略
 * @param {string} text - 文本内容
 * @returns {number} 估算的 token 数量
 */
function estimateTokens(text) {
    if (!text) return 0;
    
    const textType = detectTextType(text);
    
    // 根据不同语言类型使用不同的估算系数
    // 这些系数基于实际观察和 tokenizer 的特性
    let tokensPerChar;
    
    switch (textType) {
        case 'latin':
        case 'cyrillic':
        case 'arabic':
            // 拉丁字母、西里尔字母、阿拉伯文：按单词计算更准确
            // 平均每个单词约 4-5 个字符，每个单词约 1 token
            // 因此约 0.2-0.25 tokens/字符
            const words = text.split(/\s+/).filter(word => word.length > 0);
            // 每个单词算 1 token，加上标点符号等
            return Math.ceil(words.length * 1.1);
            
        case 'cjk':
            // 中日韩文字：通常 1 个字符 = 1-2 tokens
            // 对于中文，常用字约 1.5 tokens/字符
            tokensPerChar = 1.5;
            return Math.ceil(text.length * tokensPerChar);
            
        case 'mixed':
        default:
            // 混合文本：使用保守估算
            // 统计拉丁字母单词数和 CJK 字符数
            const latinWords = (text.match(/[a-zA-Z]+/g) || []).length;
            const cjkChars = (text.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu) || []).length;
            const otherChars = text.length - cjkChars;
            
            // 混合计算
            return Math.ceil(latinWords * 1.1 + cjkChars * 1.5 + (otherChars - latinWords * 5) * 0.3);
    }
}

/**
 * 将文本数组分批，确保每批不超过最大数量和 token 限制
 * @param {string[]} texts - 文本数组
 * @returns {string[][]} 分批后的文本数组
 */
function splitTextsToBatches(texts) {
    const batches = [];
    let currentBatch = [];
    let currentTokens = 0;
    
    for (const text of texts) {
        const tokens = estimateTokens(text);
        
        // 检查是否需要开始新批次
        if (currentBatch.length >= BATCH_EMBEDDING_CONFIG.MAX_BATCH_SIZE ||
            (currentBatch.length > 0 && currentTokens + tokens > BATCH_EMBEDDING_CONFIG.MAX_TOTAL_TOKENS)) {
            batches.push(currentBatch);
            currentBatch = [];
            currentTokens = 0;
        }
        
        currentBatch.push(text);
        currentTokens += tokens;
    }
    
    // 添加最后一批
    if (currentBatch.length > 0) {
        batches.push(currentBatch);
    }
    
    return batches;
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

/**
 * 批量生成嵌入向量
 * @param {string[]} texts - 文本数组
 * @returns {Promise<Array<{text: string, embedding: number[]|null, error: string|null}>>} 
 *          返回结果数组，每个元素包含原文本、embedding向量（成功时）或错误信息（失败时）
 */
async function getBatchEmbeddings(texts) {
    logger.debug(`批量生成嵌入向量，共 ${texts.length} 个文本`);
    
    // 参数验证
    if (!Array.isArray(texts) || texts.length === 0) {
        logger.error('getBatchEmbeddings: 参数必须是非空数组');
        return [];
    }
    
    try {
        // 使用专门用于embedding的服务
        const apiService = await ConfigManager.getEmbeddingService();
        const apiKey = apiService.apiKey;
        if (!apiKey || !apiService.embedModel) {
            throw new Error('未配置有效的向量模型');
        }
        
        // 将文本分批
        const batches = splitTextsToBatches(texts);
        logger.debug(`文本已分为 ${batches.length} 批次处理`);
        
        // 存储所有结果
        const allResults = [];
        let totalTokens = 0;
        
        // 逐批处理
        for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
            const batch = batches[batchIndex];
            logger.debug(`处理第 ${batchIndex + 1}/${batches.length} 批次，包含 ${batch.length} 个文本`);
            
            try {
                const response = await fetch(joinUrl(apiService.baseUrl, 'embeddings'), {
                    method: 'POST',
                    headers: getHeaders(apiKey),
                    body: JSON.stringify({
                        model: apiService.embedModel,
                        input: batch, // 传入文本数组
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
                    
                    // 当前批次失败，为该批次的所有文本添加错误结果
                    logger.error(`批次 ${batchIndex + 1} 请求失败: ${errorMessage}`);
                    for (const text of batch) {
                        allResults.push({
                            text: text,
                            embedding: null,
                            error: errorMessage
                        });
                    }
                    continue; // 继续处理下一批次
                }
                
                // 解析响应
                const data = await response.json();
                logger.debug(`批次 ${batchIndex + 1} 响应:`, {
                    dataCount: data.data?.length,
                    usage: data.usage
                });
                
                if (!data.data || !Array.isArray(data.data)) {
                    throw new Error('无效的API响应格式');
                }
                
                // 记录 token 使用量
                if (data.usage?.total_tokens) {
                    totalTokens += data.usage.total_tokens;
                }
                
                // 按索引匹配结果
                // API 返回的 data 数组中，每个元素都有 index 字段，对应输入数组的索引
                for (let i = 0; i < batch.length; i++) {
                    const embeddingData = data.data.find(item => item.index === i);
                    if (embeddingData && embeddingData.embedding) {
                        allResults.push({
                            text: batch[i],
                            embedding: embeddingData.embedding,
                            error: null
                        });
                    } else {
                        allResults.push({
                            text: batch[i],
                            embedding: null,
                            error: '未返回有效的embedding数据'
                        });
                    }
                }
                
            } catch (error) {
                logger.error(`批次 ${batchIndex + 1} 处理失败:`, error);
                // 为该批次的所有文本添加错误结果
                for (const text of batch) {
                    allResults.push({
                        text: text,
                        embedding: null,
                        error: error.message
                    });
                }
            }
        }
        
        // 记录总的使用统计
        if (totalTokens > 0) {
            await statsManager.recordEmbeddingUsage(totalTokens);
        }
        
        logger.debug(`批量生成嵌入向量完成，成功: ${allResults.filter(r => r.embedding).length}/${texts.length}`);
        return allResults;
        
    } catch (error) {
        logger.error(`批量生成嵌入向量失败: ${error.message}`);
        // 返回所有文本的错误结果
        return texts.map(text => ({
            text: text,
            embedding: null,
            error: error.message
        }));
    }
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
const SYSTEM_PROMPT_HIERARCHICAL_TAGS = i18n.M('prompt_generate_hierarchical_tags_sys');
const USER_PROMPT_HIERARCHICAL_TAGS = i18n.M('prompt_generate_hierarchical_tags_user');

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

// 用 ChatGPT API 生成层级标签
async function generateHierarchicalTags(pageContent, tab) {
    const prompt = makeChatPrompt(pageContent, tab, USER_PROMPT_HIERARCHICAL_TAGS);
    logger.debug('生成层级标签的prompt:\n ', prompt);
    const tagsText = await getChatCompletion(SYSTEM_PROMPT_HIERARCHICAL_TAGS, prompt) || '';

    // 处理返回的标签
    let tags = tagsText
        .split('|')
        .map(tag => tag.trim())
        .filter(tag => {
            if (!tag) return false;

            // 验证层级标签格式
            const parts = tag.split('/');

            // 最多3级
            if (parts.length > 3) {
                logger.debug('标签层级过多，已过滤:', tag);
                return false;
            }

            // 验证每级标签
            for (const part of parts) {
                const partTrimmed = part.trim();
                if (!partTrimmed) return false;

                const partLength = getStringVisualLength(partTrimmed);
                // 每级标签长度2-20字符
                if (partLength < 2 || partLength > 20) {
                    logger.debug('标签层级长度不符合要求，已过滤:', { tag, part: partTrimmed, length: partLength });
                    return false;
                }

                // 过滤特殊字符（允许斜杠）
                if (!/^[^\\.,#!$%\\^&\\*;:{}=\\-_`~()]+$/.test(partTrimmed)) {
                    logger.debug('标签包含特殊字符，已过滤:', partTrimmed);
                    return false;
                }
            }

            return true;
        })
        // 添加去重逻辑
        .filter((tag, index, self) => self.indexOf(tag) === index)
        // 限制最多5个标签
        .slice(0, 5);

    logger.debug('AI生成的层级标签:', tags);

    // 如果没有生成有效标签，使用备选方案
    if (tags.length === 0) {
        tags = getFallbackHierarchicalTags(tab.title, pageContent?.metadata);
    }

    tags = cleanTags(tags);
    return tags.length > 0 ? tags : [i18n.M('ui_tag_unclassified')];
}

/**
 * 从层级标签中提取扁平标签（用于向后兼容）
 * @param {Array<string>} hierarchicalTags - 层级标签数组
 * @returns {Array<string>} 扁平标签数组
 */
function extractFlatTags(hierarchicalTags) {
    const flatTags = new Set();

    for (const tag of hierarchicalTags) {
        const parts = tag.split('/');
        // 添加所有层级的标签
        for (const part of parts) {
            const trimmed = part.trim();
            if (trimmed) {
                flatTags.add(trimmed);
            }
        }
    }

    return Array.from(flatTags);
}

/**
 * 备选层级标签生成方案
 * @param {string} title - 页面标题
 * @param {Object} metadata - 页面元数据
 * @returns {Array<string>} 层级标签数组
 */
function getFallbackHierarchicalTags(title, metadata) {
    const flatTags = getFallbackTags(title, metadata);

    // 将扁平标签转换为简单的层级标签
    // 如果有多个标签，尝试构建简单的层级关系
    if (flatTags.length >= 2) {
        // 第一个标签作为一级分类，其他作为二级
        const hierarchicalTags = [];
        const firstTag = flatTags[0];

        for (let i = 1; i < flatTags.length && i < 4; i++) {
            hierarchicalTags.push(`${firstTag}/${flatTags[i]}`);
        }

        // 如果只生成了一个层级标签，添加第一个标签作为独立标签
        if (hierarchicalTags.length === 0) {
            hierarchicalTags.push(firstTag);
        }

        return hierarchicalTags;
    }

    // 如果标签太少，直接返回扁平标签
    return flatTags;
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
