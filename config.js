// API 服务配置
const API_SERVICES = {
    OPENAI: {
        id: 'openai',
        name: 'OpenAI',
        baseUrl: 'https://api.openai.com/v1/',
        embedModel: 'text-embedding-3-small',
        chatModel: 'gpt-3.5-turbo',
        logo: 'logo-openai.svg',
        validateKeyPattern: key => /^sk-[A-Za-z0-9-_]{32,}$/.test(key) || /^sk-proj-[A-Za-z0-9-_]{80,}$/.test(key),
        headers: key => ({
            'Authorization': `Bearer ${key}`,
            'Content-Type': 'application/json'
        }),
        placeholder: 'sk-...',
        similarityThreshold: {
            MAX: 0.7,
            HIGH: 0.50,
            MEDIUM: 0.35,
            LOW: 0.2
        },
        getKeyUrl: 'https://platform.openai.com/api-keys',
        pricingUrl: 'https://openai.com/api/pricing/'
    },
    DASHSCOPE: {
        id: 'dashscope',
        name: '通义千问',
        baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1/',
        embedModel: 'text-embedding-v3',
        chatModel: 'qwen-plus',
        logo: 'logo-dashscope.svg',
        validateKeyPattern: key => /^sk-[A-Za-z0-9]{32,}$/.test(key),
        headers: key => ({
            'Authorization': `Bearer ${key}`,
            'Content-Type': 'application/json'
        }),
        placeholder: 'sk-...',
        similarityThreshold: {
            MAX: 0.85,
            HIGH: 0.65,
            MEDIUM: 0.50,
            LOW: 0.4
        },
        getKeyUrl: 'https://bailian.console.aliyun.com/?apiKey=1',
        pricingUrl: 'https://help.aliyun.com/zh/model-studio/getting-started/models'
    },
    GLM: {
        id: 'glm',
        name: '智谱GLM',
        baseUrl: 'https://open.bigmodel.cn/api/paas/v4/',
        embedModel: 'embedding-2',
        chatModel: 'glm-4-flash',
        logo: 'logo-glm.png',
        validateKeyPattern: key => /^[a-f0-9]{32}\.[A-Za-z0-9]+$/.test(key),
        headers: key => ({
            'Authorization': `Bearer ${key}`,
            'Content-Type': 'application/json'
        }),
        placeholder: '',
        similarityThreshold: {
            MAX: 0.7,
            HIGH: 0.55,
            MEDIUM: 0.30,
            LOW: 0.2
        },
        getKeyUrl: 'https://open.bigmodel.cn/usercenter/apikeys',
        pricingUrl: 'https://open.bigmodel.cn/pricing'
    },
};

class ConfigManager {
    static STORAGE = chrome.storage.sync;
    
    static STORAGE_KEYS = {
        ACTIVE_SERVICE: 'activeService',
        API_KEYS: 'apiKeys'
    };

    // 通过API_SERVICES的id获取服务对象
    static findServiceById(serviceId) {
        return Object.values(API_SERVICES).find(s => s.id === serviceId);
    }

    // 获取当前激活的服务
    static async getActiveService() {
        try {
            const data = await this.STORAGE.get(this.STORAGE_KEYS.ACTIVE_SERVICE);
            const activeServiceId = data[this.STORAGE_KEYS.ACTIVE_SERVICE];
            return this.findServiceById(activeServiceId) || API_SERVICES.OPENAI; // 默认使用 OpenAI
        } catch (error) {
            logger.error('获取当前服务失败:', error);
            return API_SERVICES.OPENAI;
        }
    }

    // 设置当前激活的服务
    static async setActiveService(serviceId) {
        const service = this.findServiceById(serviceId);
        if (!service) {
            throw new Error('无效的服务ID');
        }
        await this.STORAGE.set({
            [this.STORAGE_KEYS.ACTIVE_SERVICE]: service.id
        });
    }

    // 获取指定服务的 API Key
    static async getAPIKey(serviceId = null) {
        try {
            if (!serviceId) {
                const activeService = await this.getActiveService();
                serviceId = activeService.id;
            }

            const data = await this.STORAGE.get(this.STORAGE_KEYS.API_KEYS);
            const apiKeys = data[this.STORAGE_KEYS.API_KEYS] || {};
            return apiKeys[serviceId] || null;
        } catch (error) {
            logger.error('获取 API Key 失败:', error);
            return null;
        }
    }

    // 设置 API Key
    static async setAPIKey(serviceId, apiKey) {
        try {
            const service = this.findServiceById(serviceId);
            if (!service) {
                throw new Error('无效的服务ID');
            }

            // 验证 API Key 格式
            if (!service.validateKeyPattern(apiKey)) {
                throw new Error(`无效的 ${service.name} API Key 格式`);
            }

            // 验证 API Key 是否可用
            await this.verifyAPIKey(serviceId, apiKey);

            // 获取现有的 API Keys
            const data = await this.STORAGE.get(this.STORAGE_KEYS.API_KEYS);
            const apiKeys = data[this.STORAGE_KEYS.API_KEYS] || {};

            // 更新数据
            apiKeys[serviceId] = apiKey;
            await this.STORAGE.set({
                [this.STORAGE_KEYS.API_KEYS]: apiKeys
            });

            return true;
        } catch (error) {
            logger.error('保存 API Key 失败:', error);
            throw error;
        }
    }

    // 验证 API Key
    static async verifyAPIKey(serviceId, apiKey) {
        const service = this.findServiceById(serviceId);
        if (!service) {
            throw new Error('无效的服务ID');
        }

        // 验证 API Key 格式
        if (!service.validateKeyPattern(apiKey)) {
            throw new Error(`无效的 ${service.name} API Key 格式`);
        }

        try {
            const response = await fetch(`${service.baseUrl}embeddings`, {
                method: 'POST',
                headers: service.headers(apiKey),
                body: JSON.stringify({
                    model: service.embedModel,
                    input: 'test'
                })
            });

            const data = await response.json();
            if (!response.ok) {
                throw new Error(`${data.error.message}`);
            }

            return true;
        } catch (error) {
            logger.error('API Key 验证失败:', error);
            throw new Error(`验证失败: ${error.message}`);
        }
    }
}