// API 服务配置
const API_SERVICES = {
    OPENAI: {
        id: 'openai',
        name: i18n.getMessage('config_services_openai_name'),
        description: i18n.getMessage('config_services_openai_description'),
        baseUrl: 'https://api.openai.com/v1/',
        defaultEmbedModel: 'text-embedding-3-small',
        defaultChatModel: 'gpt-3.5-turbo',
        embedModel: 'text-embedding-3-small',
        chatModel: 'gpt-3.5-turbo',
        logo: 'logo-openai.svg',
        similarityThreshold: {
            MAX: 0.7,
            HIGH: 0.50,
            MEDIUM: 0.35,
            LOW: 0.2
        },
        getKeyUrl: 'https://platform.openai.com/api-keys',
        pricingUrl: 'https://openai.com/api/pricing/',
        recommendTags: [],
        thinkingParam: { key: 'reasoning_effort', disabledValue: 'none' }
    },
    OPENROUTER: {
        id: 'openrouter',
        name: i18n.getMessage('config_services_openrouter_name'),
        description: i18n.getMessage('config_services_openrouter_description'),
        baseUrl: 'https://openrouter.ai/api/v1/',
        defaultEmbedModel: 'openai/text-embedding-3-small',
        defaultChatModel: 'deepseek/deepseek-v3.2',
        embedModel: 'openai/text-embedding-3-small',
        chatModel: 'deepseek/deepseek-v3.2',
        logo: 'logo-openrouter.svg',
        similarityThreshold: {
            MAX: 0.7,
            HIGH: 0.50,
            MEDIUM: 0.35,
            LOW: 0.2
        },
        getKeyUrl: 'https://openrouter.ai/keys',
        pricingUrl: 'https://openrouter.ai/models',
        recommendTags: [i18n.getMessage('config_services_tag_rich_models')],
        thinkingParam: { key: 'reasoning_effort', disabledValue: 'none' }
    },
    DASHSCOPE: {
        id: 'dashscope',
        name: i18n.getMessage('config_services_dashscope_name'),
        description: i18n.getMessage('config_services_dashscope_description'),
        baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1/',
        defaultEmbedModel: 'text-embedding-v3',
        defaultChatModel: 'qwen3.5-plus',
        embedModel: 'text-embedding-v3',
        chatModel: 'qwen3.5-plus',
        logo: 'logo-dashscope.svg',
        similarityThreshold: {
            MAX: 0.85,
            HIGH: 0.65,
            MEDIUM: 0.50,
            LOW: 0.4
        },
        getKeyUrl: 'https://bailian.console.aliyun.com/cn-beijing/?apiKey=1&tab=model#/api-key',
        pricingUrl: 'https://help.aliyun.com/zh/model-studio/getting-started/models',
        recommendTags: [i18n.getMessage('config_services_tag_rich_models'), i18n.getMessage('config_services_tag_stable'), i18n.getMessage('config_services_tag_free_tokens')],
        thinkingParam: { key: 'enable_thinking', disabledValue: false }
    },
    SILICONFLOW: {
        id: 'siliconflow',
        name: i18n.getMessage('config_services_siliconflow_name'),
        description: i18n.getMessage('config_services_siliconflow_description'),
        baseUrl: 'https://api.siliconflow.cn/v1',
        defaultEmbedModel: 'BAAI/bge-m3',
        defaultChatModel: 'Qwen/Qwen2.5-32B-Instruct',
        embedModel: 'BAAI/bge-m3',
        chatModel: 'Qwen/Qwen2.5-32B-Instruct',
        logo: 'logo-siliconflow.svg',
        similarityThreshold: {
            MAX: 0.85,
            HIGH: 0.60,
            MEDIUM: 0.50,
            LOW: 0.4
        },
        getKeyUrl: 'https://cloud.siliconflow.cn/account/ak',
        pricingUrl: 'https://cloud.siliconflow.cn/models',
        recommendTags: [i18n.getMessage('config_services_tag_free_model'), i18n.getMessage('config_services_tag_rich_models')],
        thinkingParam: { key: 'enable_thinking', disabledValue: false }
    },
    GLM: {
        id: 'glm',
        name: i18n.getMessage('config_services_glm_name'),
        description: i18n.getMessage('config_services_glm_description'),
        baseUrl: 'https://open.bigmodel.cn/api/paas/v4/',
        defaultEmbedModel: 'embedding-2',
        defaultChatModel: 'glm-4-flash',
        embedModel: 'embedding-2',
        chatModel: 'glm-4-flash',
        logo: 'logo-glm.svg',
        similarityThreshold: {
            MAX: 0.7,
            HIGH: 0.55,
            MEDIUM: 0.30,
            LOW: 0.2
        },
        getKeyUrl: 'https://open.bigmodel.cn/usercenter/apikeys',
        pricingUrl: 'https://open.bigmodel.cn/pricing',
        recommendTags: [i18n.getMessage('config_services_tag_free_model')],
        thinkingParam: { key: 'thinking', disabledValue: { type: 'disabled' } }
    },
    HUNYUAN: {
        id: 'hunyuan',
        name: i18n.getMessage('config_services_hunyuan_name'),
        description: i18n.getMessage('config_services_hunyuan_description'),
        baseUrl: 'https://api.hunyuan.cloud.tencent.com/v1',
        defaultEmbedModel: 'hunyuan-embedding',
        defaultChatModel: 'hunyuan-standard-256K',
        embedModel: 'hunyuan-embedding',
        chatModel: 'hunyuan-standard-256K',
        logo: 'logo-hunyuan.svg',
        similarityThreshold: {
            MAX: 0.85,
            HIGH: 0.60,
            MEDIUM: 0.40,
            LOW: 0.35
        },
        getKeyUrl: 'https://console.cloud.tencent.com/hunyuan/api-key',
        pricingUrl: 'https://cloud.tencent.com/document/product/1729/97731',
        recommendTags: []
    }
};

// 自定义服务默认使用 OpenAI 兼容的 reasoning_effort 参数探测推理模型
const DEFAULT_THINKING_PARAM = { key: 'reasoning_effort', disabledValue: 'none' };

function getHeaders(key) {
    return {
        'Authorization': `Bearer ${key}`,
        'Content-Type': 'application/json'
    };
}

function joinUrl(baseUrl, path) {
    if (baseUrl.endsWith('/')) {
        return baseUrl + path;
    }
    return baseUrl + '/' + path;
}

const MAX_CUSTOM_SERVICES = 11;

class ConfigManager {
    static STORAGE = chrome.storage.sync;
    
    static STORAGE_KEYS = {
        ACTIVE_SERVICE: 'activeService',
        API_KEYS: 'apiKeys',
        BUILTIN_SERVICES_SETTINGS: 'builtinServicesSettings',
        CUSTOM_SERVICES: 'customServices',
        PINNED_SITES: 'pinnedSites',
        SERVICE_TYPES: 'serviceTypes'
    };

    static async getServiceExportData() {
        const exportKeys = [
            this.STORAGE_KEYS.ACTIVE_SERVICE,
            this.STORAGE_KEYS.API_KEYS,
            this.STORAGE_KEYS.BUILTIN_SERVICES_SETTINGS,
            this.STORAGE_KEYS.CUSTOM_SERVICES,
            this.STORAGE_KEYS.SERVICE_TYPES
        ];
        try {
            const data = await this.STORAGE.get(exportKeys);
            logger.debug('获取服务导出数据:', data);
            return data;
        } catch (error) {
            logger.error('获取服务导出数据失败:', error);
            return {};
        }
    }

    static async getConfigExportData() {
        const exportKeys = [
            this.STORAGE_KEYS.PINNED_SITES
        ];
        try {
            const data = await this.STORAGE.get(exportKeys);
            logger.debug('获取配置导出数据:', data);
            return data;
        } catch (error) {
            logger.error('获取配置导出数据失败:', error);
            return {};
        }
    }

    // 通过API_SERVICES的id获取服务对象
    static findBuiltinServiceById(serviceId) {
        return Object.values(API_SERVICES).find(s => s.id === serviceId);
    }

    static async findServiceById(serviceId) {
        if (!serviceId) {
            return null;
        }
        // 检查是否是内置服务
        const builtInService = this.findBuiltinServiceById(serviceId);
        if (builtInService) {
            builtInService.apiKey = await this.getBuiltinAPIKey(serviceId);
            const setting = await this.getBuiltinServiceSettingByServiceId(serviceId);
            builtInService.chatModel = setting?.chatModel || builtInService.defaultChatModel;
            builtInService.supportsThinkingParam = setting?.supportsThinkingParam || false;
            return builtInService;
        }

        // 检查是否是自定义服务
        const customServices = await this.getCustomServices();
        const customService = customServices[serviceId] || null;
        if (customService) {
            customService.thinkingParam = customService.thinkingParam || DEFAULT_THINKING_PARAM;
        }
        return customService;
    }

    // 获取当前激活的服务
    static async getActiveService() {
        try {
            const data = await this.STORAGE.get(this.STORAGE_KEYS.ACTIVE_SERVICE);
            let activeServiceId = data[this.STORAGE_KEYS.ACTIVE_SERVICE];

            let service = await this.findServiceById(activeServiceId);
            if (service) {
                return service;
            }

            activeServiceId = API_SERVICES.OPENAI.id;
            service = await this.findServiceById(activeServiceId);
            return service;
        } catch (error) {
            logger.error('获取当前服务失败:', error);
            return API_SERVICES.OPENAI;
        }
    }

    // 新增：获取服务类型配置
    static async getServiceTypeConfig() {
        try {
            const data = await this.STORAGE.get(this.STORAGE_KEYS.SERVICE_TYPES);
            const serviceTypes = data[this.STORAGE_KEYS.SERVICE_TYPES] || {
                chat: null, // 默认为null，表示使用activeService
                embedding: null // 默认为null，表示使用activeService
            };
            return serviceTypes;
        } catch (error) {
            logger.error('获取服务类型配置失败:', error);
            return { chat: null, embedding: null };
        }
    }

    // 新增：设置特定类型的服务
    static async setServiceType(type, serviceId) {
        if (!['chat', 'embedding'].includes(type)) {
            throw new Error(i18n.getMessage('config_error_invalid_service_type'));
        }
        
        if (serviceId !== null) {
            const service = await this.findServiceById(serviceId);
            if (!service) {
                logger.warn(`设置${type}服务时服务ID无效，可能已被删除:`, serviceId);
                return null;
            }
        }
        
        try {
            const serviceTypes = await this.getServiceTypeConfig();
            serviceTypes[type] = serviceId;
            
            await this.STORAGE.set({
                [this.STORAGE_KEYS.SERVICE_TYPES]: serviceTypes
            });
            
            return serviceTypes;
        } catch (error) {
            logger.error(`设置${type}服务失败:`, error);
            throw error;
        }
    }

    // 新增：获取特定类型的服务
    static async getServiceByType(type) {
        if (!['chat', 'embedding'].includes(type)) {
            throw new Error(i18n.getMessage('config_error_invalid_service_type'));
        }
        
        try {
            const serviceTypes = await this.getServiceTypeConfig();
            const serviceId = serviceTypes[type];
            
            // 如果没有为该类型设置特定服务，则使用活跃服务
            if (serviceId === null) {
                return await this.getActiveService();
            }
            
            const service = await this.findServiceById(serviceId);
            if (!service) {
                // 如果找不到服务，回退到活跃服务
                return await this.getActiveService();
            }
            
            return service;
        } catch (error) {
            logger.error(`获取${type}服务失败:`, error);
            // 出错时回退到活跃服务
            return await this.getActiveService();
        }
    }

    // 新增：获取Chat服务
    static async getChatService() {
        return await this.getServiceByType('chat');
    }

    // 新增：获取Embedding服务
    static async getEmbeddingService() {
        return await this.getServiceByType('embedding');
    }

    // 新增：根据服务类型获取API Key
    static async getAPIKeyByType(type) {
        try {
            const service = await this.getServiceByType(type);
            return service.apiKey;
        } catch (error) {
            logger.error(`获取${type}服务API Key失败:`, error);
            return null;
        }
    }
    
    // 新增：获取Chat服务的API Key
    static async getChatAPIKey() {
        return await this.getAPIKeyByType('chat');
    }
    
    // 新增：获取Embedding服务的API Key
    static async getEmbeddingAPIKey() {
        return await this.getAPIKeyByType('embedding');
    }

    static async getBuiltinAPIKey(serviceId) {
        try {
            const data = await this.STORAGE.get(this.STORAGE_KEYS.API_KEYS);
            const apiKeys = data[this.STORAGE_KEYS.API_KEYS] || {};
            return apiKeys[serviceId] || null;
        } catch (error) {
            logger.error('获取内置服务 API Key 失败:', error);
            return null;
        }
    }

    static async getBuiltinServiceSettings() {
        try {
            const data = await this.STORAGE.get(this.STORAGE_KEYS.BUILTIN_SERVICES_SETTINGS);
            return data[this.STORAGE_KEYS.BUILTIN_SERVICES_SETTINGS] || {};
        } catch (error) {
            logger.error('获取内置服务设置失败:', error);
            return {};
        }
    }

    static async getBuiltinServiceSettingByServiceId(serviceId) {
        const serviceSettings = await this.getBuiltinServiceSettings();
        return serviceSettings[serviceId] || null;
    }

    // 设置 API Key
    // @param {AbortSignal} signal - 可选的取消信号，用于中断验证请求
    static async saveBuiltinAPIKey(serviceId, apiKey, setting, signal = null) {
        try {
            const service = this.findBuiltinServiceById(serviceId);
            if (!service) {
                throw new Error(i18n.getMessage('config_error_invalid_service_id'));
            }

            // 验证 API Key 是否可用，同时探测推理参数支持
            const verifyResult = await this.verifyAPIKey(serviceId, apiKey, setting?.chatModel, signal);
            setting.supportsThinkingParam = verifyResult.supportsThinkingParam;

            // 获取现有的 API Keys
            const data = await this.STORAGE.get(this.STORAGE_KEYS.API_KEYS);
            const apiKeys = data[this.STORAGE_KEYS.API_KEYS] || {};

            // 更新数据
            apiKeys[serviceId] = apiKey;
            await this.STORAGE.set({
                [this.STORAGE_KEYS.API_KEYS]: apiKeys
            });

            // 更新service设置
            const serviceSettings = await this.getBuiltinServiceSettings();
            serviceSettings[serviceId] = setting;
            await this.STORAGE.set({
                [this.STORAGE_KEYS.BUILTIN_SERVICES_SETTINGS]: serviceSettings
            });
        } catch (error) {
            if (isUserCanceledError(error)) throw error;
            logger.error('保存 API Key 失败:', error);
            throw error;
        }
    }

    // 验证 API Key
    // @param {AbortSignal} signal - 可选的取消信号，用于中断 HTTP 请求
    // @returns {{ supportsThinkingParam: boolean }}
    static async verifyAPIKey(serviceId, apiKey, chatModel, signal = null) {
        const service = this.findBuiltinServiceById(serviceId);
        if (!service) {
            throw new Error('无效的服务ID');
        }

        try {
            const chatResult = await this.testChatAPI(
                service.baseUrl, apiKey, chatModel, signal, service.thinkingParam || null
            );
            await this.testEmbeddingAPI(service.baseUrl, apiKey, service.embedModel, signal);
            return { supportsThinkingParam: chatResult.supportsThinkingParam };
        } catch (error) {
            if (isUserCanceledError(error)) {
                logger.debug('[取消功能] API Key 验证请求已被用户取消');
                throw error;
            }
            logger.error('API Key 验证失败:', error);
            throw new Error(i18n.getMessage('config_error_verify_failed', [error.message]));
        }
    }

    // 添加新方法用于获取自定义服务配置
    static async getCustomServices() {
        try {
            const data = await this.STORAGE.get(this.STORAGE_KEYS.CUSTOM_SERVICES);
            const customServices = data[this.STORAGE_KEYS.CUSTOM_SERVICES] || {};
            for (const service of Object.values(customServices)) {
                service.isCustom = true;
            }
            return customServices;
        } catch (error) {
            logger.error('获取自定义服务配置失败:', error);
            return {};
        }
    }

    // 添加新方法用于保存自定义服务配置
    static async saveCustomService(config) {
        try {
            const customServices = await this.getCustomServices();
            if (customServices[config.id]) {
                customServices[config.id] = config;
            }else {
                if (Object.keys(customServices).length >= MAX_CUSTOM_SERVICES) {
                    throw new Error(i18n.getMessage('config_error_max_custom_services'));
                }
                customServices[config.id] = config;
            }

            await this.STORAGE.set({
                [this.STORAGE_KEYS.CUSTOM_SERVICES]: customServices
            });
        } catch (error) {
            logger.error('保存自定义服务配置失败:', error);
            throw error;
        }
    }

    static async deleteCustomService(serviceId) {
        try {
            const customServices = await this.getCustomServices();
            
            // 检查服务是否存在
            if (!customServices[serviceId]) {
                throw new Error(i18n.getMessage('config_error_service_not_found'));
            }

            // 如果是当前激活的服务，需要切换到默认服务
            const serviceTypes = await this.getServiceTypeConfig();
            if (serviceTypes.chat === serviceId) {
                await this.setServiceType('chat', API_SERVICES.OPENAI.id);
            }
            if (serviceTypes.embedding === serviceId) {
                await this.setServiceType('embedding', API_SERVICES.OPENAI.id);
            }

            // 删除服务
            delete customServices[serviceId];
            await this.STORAGE.set({
                [this.STORAGE_KEYS.CUSTOM_SERVICES]: customServices
            });
        } catch (error) {
            logger.error('删除自定义服务失败:', error);
            throw error;
        }
    }

    // 测试自定义服务的chat接口
    // @param {AbortSignal} signal - 可选的取消信号，用于中断 HTTP 请求
    // @param {Object} thinkingParam - 可选的推理参数配置，用于探测模型是否支持关闭推理
    // @returns {{ success: boolean, supportsThinkingParam: boolean }}
    static async testChatAPI(baseUrl, apiKey, chatModel, signal = null, thinkingParam = null) {
        try {
            try {
                new URL(baseUrl);
            } catch (error) {
                throw new Error(i18n.getMessage('config_error_invalid_api_url'));
            }
            if (!apiKey) {
                throw new Error(i18n.getMessage('config_error_api_key_empty'));
            }
            if (!chatModel) {
                throw new Error(i18n.getMessage('config_error_chat_model_empty'));
            }

            const baseBody = {
                model: chatModel,
                messages: [{ role: "user", content: "Hello" }]
            };
            const url = joinUrl(baseUrl, 'chat/completions');

            if (thinkingParam) {
                const bodyWithThinking = { ...baseBody, [thinkingParam.key]: thinkingParam.disabledValue };
                const fetchOptions = {
                    method: 'POST',
                    headers: getHeaders(apiKey),
                    body: JSON.stringify(bodyWithThinking)
                };
                if (signal) fetchOptions.signal = signal;

                try {
                    const data = await fetchApi(url, fetchOptions);
                    if (!data.choices?.[0]?.message?.content) {
                        logger.debug('Chat接口数据格式错误:', { data });
                        throw new Error(i18n.getMessage('config_error_api_data_format'));
                    }
                    logger.debug('Chat模型支持关闭推理参数:', { chatModel, thinkingParam: thinkingParam.key });
                    return { success: true, supportsThinkingParam: true };
                } catch (error) {
                    if (isAbortError(error)) {
                        logger.debug('[取消功能] Chat 接口测试请求已被用户取消');
                        throw new Error(USER_CANCELED);
                    }
                    // 带推理参数失败，去掉参数重试
                    logger.debug('带推理参数请求失败，尝试不带参数:', error.message);
                }
            }

            const fetchOptions = {
                method: 'POST',
                headers: getHeaders(apiKey),
                body: JSON.stringify(baseBody)
            };
            if (signal) fetchOptions.signal = signal;

            const data = await fetchApi(url, fetchOptions);
            if (!data.choices?.[0]?.message?.content) {
                logger.debug('Chat接口数据格式错误:', { data });
                throw new Error(i18n.getMessage('config_error_api_data_format'));
            }
            return { success: true, supportsThinkingParam: false };
        } catch (error) {
            if (isAbortError(error)) {
                logger.debug('[取消功能] Chat 接口测试请求已被用户取消');
                throw new Error(USER_CANCELED);
            }
            throw new Error(`${error.message}`);
        }
    }

    // 测试自定义服务的embedding接口
    // @param {AbortSignal} signal - 可选的取消信号，用于中断 HTTP 请求
    static async testEmbeddingAPI(baseUrl, apiKey, embedModel, signal = null) {
        try {
            try {
                new URL(baseUrl);
            } catch (error) {
                throw new Error('无效的API服务URL');
            }
            if (!apiKey) {
                throw new Error('API Key 不能为空');
            }
            if (!embedModel) {
                throw new Error(i18n.getMessage('config_error_embedding_model_empty'));
            }
            const fetchOptions = {
                method: 'POST',
                headers: getHeaders(apiKey),
                body: JSON.stringify({
                    model: embedModel,
                    input: "test"
                })
            };
            if (signal) {
                fetchOptions.signal = signal;
            }
            const data = await fetchApi(joinUrl(baseUrl, 'embeddings'), fetchOptions);
            if (!data.data?.[0]?.embedding) {
                logger.debug('Embedding接口数据格式错误:', { data });
                throw new Error(i18n.getMessage('config_error_api_data_format'));
            }
            return true;
        } catch (error) {
            if (isAbortError(error)) {
                logger.debug('[取消功能] Embedding 接口测试请求已被用户取消');
                throw new Error(USER_CANCELED);
            }
            throw new Error(`${error.message}`);
        }
    }

    static isNeedUpdateEmbedding(bookmark, activeService) {
        if (!bookmark.embedding) {
            return true;
        }

        if (bookmark.apiService !== activeService.id) {
            return true;
        }

        const oldEmbedModel = bookmark.embedModel ? bookmark.embedModel : activeService.defaultEmbedModel;
        const newEmbedModel = activeService.embedModel;
        if (oldEmbedModel !== newEmbedModel) {
            return true;
        }

        return false;
    }

    // 新增：使用当前embedding服务检查是否需要更新embedding
    static async isNeedUpdateEmbeddingWithCurrentService(bookmark) {
        if (!bookmark) {
            return false;
        }
        
        try {
            const embeddingService = await this.getEmbeddingService();
            if (!embeddingService || !embeddingService.apiKey) {
                return false;
            }
            return this.isNeedUpdateEmbedding(bookmark, embeddingService);
        } catch (error) {
            logger.error('检查是否需要更新embedding失败:', error);
            return false; // 安全起见，返回false以确保不更新
        }
    }

    // 获取常用网站列表
    static async getPinnedSites() {
        try {
            const data = await this.STORAGE.get(this.STORAGE_KEYS.PINNED_SITES);
            return data[this.STORAGE_KEYS.PINNED_SITES] || [];
        } catch (error) {
            logger.error('获取常用网站失败:', error);
            return [];
        }
    }

    // 保存常用网站列表
    static async savePinnedSites(sites) {
        try {
            if (sites.length > MAX_PINNED_SITES) {
                throw new Error(i18n.getMessage('config_error_max_pinned_sites', [MAX_PINNED_SITES]));
            }
            await this.STORAGE.set({
                [this.STORAGE_KEYS.PINNED_SITES]: sites
            });
        } catch (error) {
            logger.error('保存常用网站失败:', error);
            throw error;
        }
    }

    // 添加常用网站
    static async addPinnedSite(site) {
        try {
            const sites = await this.getPinnedSites();
            if (sites.length >= MAX_PINNED_SITES) {
                throw new Error(`最多只能固定 ${MAX_PINNED_SITES} 个网站`);
            }
            if (!sites.some(s => s.url === site.url)) {
                sites.push(site);
                await this.savePinnedSites(sites);
            }
            return sites;
        } catch (error) {
            logger.error('添加常用网站失败:', error);
            throw error;
        }
    }

    // 移除常用网站
    static async removePinnedSite(url) {
        try {
            const sites = await this.getPinnedSites();
            const index = sites.findIndex(site => site.url === url);
            if (index !== -1) {
                sites.splice(index, 1);
                await this.savePinnedSites(sites);
            }
            return sites;
        } catch (error) {
            logger.error('移除常用网站失败:', error);
            throw error;
        }
    }

    // 检查网站是否已固定
    static async isPinnedSite(url) {
        try {
            const sites = await this.getPinnedSites();
            return sites.some(site => site.url === url);
        } catch (error) {
            logger.error('检查常用网站状态失败:', error);
            return false;
        }
    }

    static async importServiceData(data, isOverwrite = false) {
        try {
            // 验证数据
            const validKeys = [
                this.STORAGE_KEYS.ACTIVE_SERVICE,
                this.STORAGE_KEYS.API_KEYS,
                this.STORAGE_KEYS.BUILTIN_SERVICES_SETTINGS,
                this.STORAGE_KEYS.CUSTOM_SERVICES,
                this.STORAGE_KEYS.SERVICE_TYPES
            ];
            const importData = {};

            // 检查并处理每个key
            for (const key of validKeys) {
                if (data[key]) {
                    if (key === this.STORAGE_KEYS.CUSTOM_SERVICES) {
                        // 处理自定义服务
                        const customServices = data[key];
                        if (!isOverwrite) {
                            // 合并模式：获取现有服务
                            const currentServices = await this.getCustomServices();
                            importData[key] = { ...currentServices, ...customServices };
                        } else {
                            importData[key] = customServices;
                        }
                        
                        // 检查数量限制
                        const serviceEntries = Object.entries(importData[key]);
                        if (serviceEntries.length > MAX_CUSTOM_SERVICES) {
                            logger.warn(`自定义服务数量超过限制(${MAX_CUSTOM_SERVICES})，仅导入前${MAX_CUSTOM_SERVICES}个`);
                            importData[key] = Object.fromEntries(serviceEntries.slice(0, MAX_CUSTOM_SERVICES));
                        }
                    } else if (key === this.STORAGE_KEYS.API_KEYS) {
                        // 处理API Keys
                        if (!isOverwrite) {
                            // 合并模式：获取现有API Keys
                            const currentData = await this.STORAGE.get(key);
                            const currentApiKeys = currentData[key] || {};
                            importData[key] = { ...currentApiKeys, ...data[key] };
                        } else {
                            importData[key] = data[key];
                        }
                    } else if (key === this.STORAGE_KEYS.BUILTIN_SERVICES_SETTINGS) {
                        // 处理内置服务设置
                        if (!isOverwrite) {
                            // 合并模式：获取现有设置
                            const currentSettings = await this.getBuiltinServiceSettings();
                            importData[key] = { ...currentSettings, ...data[key] };
                        } else {
                            importData[key] = data[key];
                        }
                    } else if (key === this.STORAGE_KEYS.SERVICE_TYPES) {
                        // 处理服务类型设置
                        if (!isOverwrite) {
                            // 合并模式：获取现有服务类型设置
                            const currentServiceTypes = await this.getServiceTypeConfig();
                            importData[key] = { ...currentServiceTypes, ...data[key] };
                        } else {
                            importData[key] = data[key];
                        }
                    } else if (key === this.STORAGE_KEYS.ACTIVE_SERVICE) {
                        importData[key] = data[key];
                    }
                }
            }

            // 保存数据
            if (Object.keys(importData).length > 0) {
                await this.STORAGE.set(importData);
                return true;
            }
            return false;
        } catch (error) {
            logger.error('导入服务数据失败:', error);
            throw error;
        }
    }

    static async importConfigData(data, isOverwrite = false) {
        if (!data) {
            return;
        }
        try {
            const validKeys = [
                this.STORAGE_KEYS.PINNED_SITES
            ];
            const importData = {};

            for (const key of validKeys) {
                if (data[key]) {
                    if (key === this.STORAGE_KEYS.PINNED_SITES) {
                        // 验证并处理固定网站数据
                        let sites = data[key];
                        if (!Array.isArray(sites)) {
                            continue;
                        }
                        // 验证每个网站对象的格式
                        sites = sites.filter(site => site && typeof site === 'object' && site.url && site.title);
                        if (!isOverwrite) {
                            // 合并模式：获取现有网站
                            const currentSites = await this.getPinnedSites();
                            // 去重合并
                            const urlSet = new Set(currentSites.map(site => site.url));
                            sites = [...currentSites, ...sites.filter(site => !urlSet.has(site.url))];
                        }
                        // 确保不超过最大限制
                        if (sites.length > MAX_PINNED_SITES) {
                            logger.warn(`固定网站数量超过限制(${MAX_PINNED_SITES})，仅保留前${MAX_PINNED_SITES}个`);
                            sites = sites.slice(0, MAX_PINNED_SITES);
                        }
                        importData[key] = sites;
                    }
                }
            }

            // 保存数据
            if (Object.keys(importData).length > 0) {
                await this.STORAGE.set(importData);
                return true;
            }
            return false;
        } catch (error) {
            logger.error('导入配置数据失败:', error);
            throw error;
        }
    }
}