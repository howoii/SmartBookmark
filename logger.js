// 定义日志级别常量
const LOG_LEVELS = {
    TRACE: 0,
    DEBUG: 1,
    INFO: 2,
    WARN: 3,
    ERROR: 4
};

// 格式化时间戳的辅助函数
const formatTimestamp = () => {
    const now = new Date();
    const pad = (n) => n.toString().padStart(2, '0');
    return `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}.${now.getMilliseconds().toString().padStart(3, '0')}`;
};

const logger = {
    info: (...args) => {
        if (LOG_LEVEL <= LOG_LEVELS.INFO) {
            console.log(
                '%c[INFO]%c[%s]%c[%s]', 
                'color: #2ecc71; font-weight: bold;',
                'color: #666; font-weight: normal;',
                formatTimestamp(),
                'color: #888; font-weight: normal;',
                EnvIdentifier,
                ...args
            );
        }
    },
    
    warn: (...args) => {
        if (LOG_LEVEL <= LOG_LEVELS.WARN) {
            console.log(
                '%c[WARN]%c[%s]%c[%s]',
                'color: #f1c40f; font-weight: bold;',
                'color: #666; font-weight: normal;',
                formatTimestamp(),
                'color: #888; font-weight: normal;',
                EnvIdentifier,
                ...args
            );
        }
    },
    
    error: (...args) => {
        if (LOG_LEVEL <= LOG_LEVELS.ERROR) {
            console.log(
                '%c[ERROR]%c[%s]%c[%s]',
                'color: #e74c3c; font-weight: bold;',
                'color: #666; font-weight: normal;',
                formatTimestamp(),
                'color: #888; font-weight: normal;',
                EnvIdentifier,
                ...args
            );
        }
    },
    
    debug: (...args) => {
        if (LOG_LEVEL <= LOG_LEVELS.DEBUG) {
            console.log(
                '%c[DEBUG]%c[%s]%c[%s]',
                'color: #3498db; font-weight: bold;',
                'color: #666; font-weight: normal;',
                formatTimestamp(),
                'color: #888; font-weight: normal;',
                EnvIdentifier,
                ...args
            );
        }
    },
    
    trace: (...args) => {
        if (LOG_LEVEL <= LOG_LEVELS.TRACE) {
            console.log(
                '%c[TRACE]%c[%s]%c[%s]',
                'color: #95a5a6; font-weight: bold;',
                'color: #666; font-weight: normal;',
                formatTimestamp(),
                'color: #888; font-weight: normal;',
                EnvIdentifier,
                ...args
            );
        }
    }
};