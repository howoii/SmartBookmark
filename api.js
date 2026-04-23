function joinUrl(baseUrl, path) {
    if (baseUrl.endsWith('/')) {
        return baseUrl + path;
    }
    return baseUrl + '/' + path;
}

/**
 * 从 API 错误响应中提取错误信息
 * 兼容 OpenAI 格式 { error: { message } }、{ message }、字符串等
 * @param {Object|string|undefined} data - 解析后的响应体，解析失败时为 undefined
 * @param {Response} response - fetch 返回的 Response 对象
 * @returns {string} 错误信息
 */
function extractApiErrorMessage(data, response) {
    const fallback = response.statusText ||
        i18n.getMessage('api_error_status_code', [response.status.toString()]) ||
        i18n.getMessage('api_error_unknown');
    if (data == null) return fallback;
    if (typeof data === 'string') return data;
    return data.error?.message || data.message || fallback;
}

/**
 * 统一的 API 请求封装：fetch + 解析 JSON + 错误检查
 * 有错误则抛出异常，无错误则返回解析后的数据
 * @param {string} url - 请求 URL
 * @param {Object} options - fetch 选项（method, headers, body, signal 等）
 * @returns {Promise<Object>} 解析后的 JSON 数据，仅当 response.ok 时返回
 * @throws {Error} 当 fetch 失败、response 不 ok、或解析失败时抛出
 */
async function fetchApi(url, options = {}) {
    const response = await fetch(url, options);
    let data;
    try {
        data = await response.json();
    } catch (error) {
        throwIfAbortError(error);
        throw new Error(extractApiErrorMessage(undefined, response));
    }
    if (!response.ok) {
        throw new Error(extractApiErrorMessage(data, response));
    }
    return data;
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
            // 平均每个单词约 4-5 个字符，每个单词约 1.33 token
            const words = text.split(/\s+/).filter(word => word.length > 0);
            return Math.ceil(words.length * 1.33);
            
        case 'cjk':
            // 对于中文，常用字约 0.75 tokens/字符
            tokensPerChar = 0.75;
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
        const apiService = await ConfigManager.getEmbeddingService();
        const apiKey = apiService.apiKey;
        if (!apiKey || !apiService.embedModel) {
            throw new Error(i18n.getMessage('api_error_embedding_model_not_configured'));
        }
        const data = await fetchApi(joinUrl(apiService.baseUrl, 'embeddings'), {
            method: 'POST',
            headers: getHeaders(apiKey),
            body: JSON.stringify({
                model: apiService.embedModel,
                input: text,
                dimensions: 1024
            })
        });
        if (!data.data?.[0]?.embedding) {
            throw new Error(i18n.getMessage('api_error_invalid_response_format'));
        }
        await statsManager.recordEmbeddingUsage(data.usage?.total_tokens || 0);
        return data.data[0].embedding;
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
            throw new Error(i18n.getMessage('api_error_embedding_model_not_configured'));
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
                const data = await fetchApi(joinUrl(apiService.baseUrl, 'embeddings'), {
                    method: 'POST',
                    headers: getHeaders(apiKey),
                    body: JSON.stringify({
                        model: apiService.embedModel,
                        input: batch,
                        dimensions: 1024
                    })
                });
                logger.debug(`批次 ${batchIndex + 1} 响应:`, {
                    dataCount: data.data?.length,
                    usage: data.usage
                });
                if (!data.data || !Array.isArray(data.data)) {
                    throw new Error(i18n.getMessage('api_error_invalid_response_format'));
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
                            error: i18n.getMessage('api_error_no_embedding_data')
                        });
                    }
                }
                
            } catch (error) {
                const errorMessage = error.message || i18n.getMessage('api_error_unknown');
                logger.error(`批次 ${batchIndex + 1} 处理失败:`, error);
                for (const text of batch) {
                    allResults.push({
                        text: text,
                        embedding: null,
                        error: errorMessage
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

async function getChatCompletion(systemPrompt, userPrompt, signal = null, maxTokens = null) {
    try {
        // 使用专门用于Chat的服务
        const apiService = await ConfigManager.getChatService();
        const apiKey = apiService.apiKey;
        if (!apiKey || !apiService.chatModel) {
            throw new Error(i18n.getMessage('api_error_chat_model_not_configured'));
        }   
        // 构建请求体
        const requestBody = {
            model: apiService.chatModel,
            messages: [{
                role: "system",
                content: systemPrompt
            }, {
                role: "user",
                content: userPrompt
            }],
            temperature: 0.2
        };

        // 如果平台支持且当前模型经探测确认支持关闭推理，添加对应参数
        if (apiService.supportsThinkingParam && apiService.thinkingParam) {
            requestBody[apiService.thinkingParam.key] = apiService.thinkingParam.disabledValue;
        }
        
        // 只有当 maxTokens 有值时才设置 max_tokens
        if (maxTokens != null) {
            requestBody.max_tokens = maxTokens;
        }
        
        // 调用 API 生成标签
        const options = {
            method: 'POST',
            headers: getHeaders(apiKey),
            body: JSON.stringify(requestBody)
        };
        
        // 如果提供了signal，添加到请求选项中
        if (signal) {
            options.signal = signal;
        }
        
        const data = await fetchApi(joinUrl(apiService.baseUrl, 'chat/completions'), options);
        logger.debug('completion response:', data);
        if (!data.choices?.[0]?.message?.content) {
            throw new Error(i18n.getMessage('api_error_invalid_response_format'));
        }
        await statsManager.recordChatUsage(
            data.usage?.prompt_tokens || 0,
            data.usage?.completion_tokens || 0
        );
        return data.choices[0].message.content.trim();
    } catch (error) {
        if (isAbortError(error) || isUserCanceledError(error)) {
            throw new Error(USER_CANCELED);
        }
        logger.error(`Chat Completion 失败: ${error}`);
    }
    return null;
}

// ==================== AI 提示词统一管理 ====================

/**
 * 标签生成的系统提示词
 */
const SYSTEM_PROMPT_TAGS = '你是一个专业的网页内容分析专家，擅长提取文章和网页的核心主题和关键信息并生成准确的标签。';

/**
 * 标签生成的用户提示词模板
 * 注意：需要在调用时替换 {{content}} 和 {{targetLanguage}}
 */
const USER_PROMPT_TAGS_TEMPLATE = `请根据以下网页内容提取2-5个简短、具有区分度的关键词，用于分类和查找。
##关键词应符合以下要求：
1. 简洁：简短明了，去除无实质意义的修饰词。
2. 输出语言：所有关键词必须使用{{targetLanguage}}，除专有名词、人名及习惯用法外。
3. 准确性：需精准反映网页的核心主题和关键信息，忽略无关信息，如广告、导航栏文本、评论列表等。
4. 多样性：要有辨识度，且必须涵盖以下四类信息（如有）：
   - 网站名称或品牌信息。
   - 网站标题核心内容。
   - 网站涉及的领域（如科技、教育、金融等）。
   - 页面具体内容的关键词（如技术名词、专业术语）。
5. 避免重复：同义或重复的关键词只保留一个。
6. 输出格式：仅返回关键词列表，关键词之间用竖线"|"分隔，无需其他说明或标点符号。
例如：小红书|AI生成|内容分析|关键词优化|提示词设计
##网页内容如下：
{{content}}`;

/**
 * 摘要生成的系统提示词模板
 * 注意：需要在调用时替换 {{targetLanguage}}、{{lengthLimit}} 和 {{lengthUnit}}
 */
const SYSTEM_PROMPT_EXCERPT_TEMPLATE = `你是"书签摘要生成助手"，负责根据网页内容用{{targetLanguage}}为其生成一句话的摘要。
请严格遵守：
1. 清洗掉无关信息，如广告、导航栏文本、评论列表等。
2. 请保持中立和准确性，避免主观评价。
3. 内容长度精确控制在{{lengthLimit}}{{lengthUnit}}以内，超出则自动删减到{{lengthLimit}}{{lengthUnit}}以内。`;

/**
 * 摘要生成的用户提示词模板
 * 注意：需要在调用时替换 {{content}}、{{targetLanguage}}、{{lengthLimit}} 和 {{lengthUnit}}
 */
const USER_PROMPT_EXCERPT_TEMPLATE = `下面是网页正文内容，请基于此生成一句话的{{targetLanguage}}的摘要：
{{content}}`;

/**
 * 翻译文本的系统提示词
 */
const SYSTEM_PROMPT_TRANSLATE = `你是一个专业的翻译助手，负责将文本准确、流畅地翻译成目标语言。
请严格遵守：
1. 只输出翻译后的文本，不要包含任何多余说明、引号或格式标记。
2. 保持原文的语气和风格。
3. 确保翻译准确、自然、流畅。`;

// ==================== 辅助函数 ====================

function makeChatPrompt(pageContent, tab, prompt) {
    const { content, excerpt, isReaderable, metadata } = pageContent;
    const cleanUrl = tab.url.replace(/\?.+$/, '').replace(/[#&].*$/, '').replace(/\/+$/, '');
    const formatContent =`title: ${tab.title}
url:${cleanUrl}
${excerpt ? `excerpt: ${smartTruncate(excerpt, 300)}` : ''}
${metadata?.keywords ? `keywords: ${metadata.keywords.slice(0, 300)}` : ''}
${content && isReaderable ? `content: ${smartTruncate(content, 8000)}` : ''}
`;

    return prompt.replace('{{content}}', formatContent);
}

// 用 ChatGPT API 生成标签
async function generateTags(pageContent, tab, signal = null) {
    // 获取目标语言设置
    const targetLanguage = await SettingsManager.get('ai.targetLanguage') || AI_DEFAULT_TARGET_LANGUAGE;
    const targetLanguageName = AI_SUPPORTED_LANGUAGES[targetLanguage] || targetLanguage;
    
    // 使用统一的中文提示词，并在提示词中明确要求输出目标语言
    const systemPrompt = SYSTEM_PROMPT_TAGS;
    let userPrompt = USER_PROMPT_TAGS_TEMPLATE.replace(/\{\{targetLanguage\}\}/g, targetLanguageName);
    
    const prompt = makeChatPrompt(pageContent, tab, userPrompt);
    logger.debug('生成标签的prompt:\n ', prompt);
    const tagsText = await getChatCompletion(systemPrompt, prompt, signal, 100) || '';

    // 处理返回的标签
    let tags = tagsText
        .split('|')
        .map(tag => tag.trim())
        .filter(tag => {
            if (!tag) return false;
            const cjkChars = (tag.match(/[\u4e00-\u9fa5\u3040-\u30ff\u3400-\u4dbf\uac00-\ud7af]/g) || []).length;
            const isCJK = cjkChars / tag.length > 0.5;
            if (isCJK) {
                // CJK 标签：按字数计，最少 1 字，最多 10 字
                if (cjkChars < 1 || cjkChars > 10) return false;
            } else {
                // 非 CJK 标签：按单词数计，最少 1 词，最多 4 词；视觉长度最短 2
                const wordCount = tag.trim().split(/\s+/).filter(Boolean).length;
                const visualLen = getStringVisualLength(tag);
                if (visualLen < 2 || wordCount > 3) return false;
            }
            logger.debug('标签长度校验:', {
                tag,
                isCJK,
                cjkChars,
                wordCount: isCJK ? null : tag.trim().split(/\s+/).filter(Boolean).length
            });
            return /^[^\,\/#!$%\^\*;:{}=\_`~()]+$/.test(tag);
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
async function generateExcerpt(pageContent, tab, signal = null) {
    // 获取目标语言设置
    const targetLanguage = await SettingsManager.get('ai.targetLanguage') || AI_DEFAULT_TARGET_LANGUAGE;
    const targetLanguageName = AI_SUPPORTED_LANGUAGES[targetLanguage] || targetLanguage;
    
    // 根据目标语言确定长度单位和限制
    // 对于 CJK 语言（中文、日文、韩文），使用"字"作为单位；对于其他语言，使用"词"作为单位
    const isCJK = ['zh', 'ja', 'ko'].includes(targetLanguage);
    const lengthUnit = isCJK ? '字' : '词';
    const lengthLimit = isCJK ? 100 : 50; // 非 CJK 语言使用词数限制
    
    // 使用统一的中文提示词模板，替换目标语言和长度参数
    let systemPrompt = SYSTEM_PROMPT_EXCERPT_TEMPLATE
        .replace(/\{\{targetLanguage\}\}/g, targetLanguageName)
        .replace(/\{\{lengthLimit\}\}/g, lengthLimit)
        .replace(/\{\{lengthUnit\}\}/g, lengthUnit);
    
    let userPrompt = USER_PROMPT_EXCERPT_TEMPLATE
        .replace(/\{\{targetLanguage\}\}/g, targetLanguageName)
        .replace(/\{\{lengthLimit\}\}/g, lengthLimit)
        .replace(/\{\{lengthUnit\}\}/g, lengthUnit);
    
    const prompt = makeChatPrompt(pageContent, tab, userPrompt);
    logger.debug('生成摘要的prompt:\n ', prompt);

    const excerptText = await getChatCompletion(systemPrompt, prompt, signal, 100) || '';
    return excerptText;
}

/**
 * 翻译文本
 * @param {string} text - 要翻译的文本
 * @param {AbortSignal} signal - 可选的取消信号
 * @returns {Promise<string>} 翻译后的文本
 */
async function translateText(text, signal = null) {
    if (!text || !text.trim()) {
        throw new Error(i18n.getMessage('api_error_text_empty'));
    }

    // 获取目标语言设置
    const targetLanguage = await SettingsManager.get('ai.targetLanguage') || AI_DEFAULT_TARGET_LANGUAGE;
    const targetLanguageName = AI_SUPPORTED_LANGUAGES[targetLanguage] || targetLanguage;
    
    const userPrompt = `请将以下文本翻译成${targetLanguageName}。如果原文已经是${targetLanguageName}，不需要翻译，直接返回原文。

${text}`;

    logger.debug('翻译文本的prompt:\n ', userPrompt);

    const translatedText = await getChatCompletion(SYSTEM_PROMPT_TRANSLATE, userPrompt, signal) || '';
    return translatedText.trim();
}
