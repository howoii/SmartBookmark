const LOG_LEVELS = {
    TRACE: 0,
    DEBUG: 1,
    INFO: 2,
    WARN: 3,
    ERROR: 4
};

const ENV = {
    // 通过修改这个值来切换环境
    current: 'development', // 或 'production'
    
    development: {
        SERVER_URL: 'http://localhost:8080',
        LOG_LEVEL: LOG_LEVELS.DEBUG,
        DEBUG: true,
    },
    
    production: {
        SERVER_URL: 'https://smartbookmarks.cloud',
        LOG_LEVEL: LOG_LEVELS.INFO,
        DEBUG: false,
    }
};

const SERVER_URL = ENV[ENV.current].SERVER_URL;
const LOG_LEVEL = ENV[ENV.current].LOG_LEVEL;
const DEBUG = ENV[ENV.current].DEBUG;
