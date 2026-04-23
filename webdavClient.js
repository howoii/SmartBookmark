/**
 * WebDAV API 操作工具类
 * 提供WebDAV服务器的基本操作
 */
class WebDAVClient {
    /**
     * 创建WebDAV客户端
     * @param {string} url - WebDAV服务器URL
     * @param {string} username - 用户名
     * @param {string} password - 密码
     */
    constructor(url, username, password) {
        this.baseUrl = url.endsWith('/') ? url : `${url}/`;
        this.username = username;
        this.password = password;
        this.authHeader = 'Basic ' + btoa(`${username}:${password}`);
    }

    /**
     * 获取完整URL
     * @param {string} path - 相对路径
     * @returns {string} 完整URL
     */
    getFullUrl(path) {
        const relativePath = path.startsWith('/') ? path.substring(1) : path;
        return new URL(relativePath, this.baseUrl).toString();
    }

    /**
     * 发送WebDAV请求
     * @param {string} method - HTTP方法
     * @param {string} path - 相对路径
     * @param {Object} options - 请求选项
     * @returns {Promise<Response>} Fetch响应
     */
    async request(method, path, options = {}) {
        const url = this.getFullUrl(path);
        const headers = {
            'Authorization': this.authHeader,
            ...options.headers
        };

        return fetch(url, {
            method,
            headers,
            body: options.body,
            credentials: 'omit'
        });
    }

    /**
     * 生成标准错误信息
     * @param {number} status - HTTP状态码
     * @param {string} statusText - HTTP状态描述
     * @param {string} operation - 操作名称
     * @param {string} [customMessage] - 自定义错误信息
     * @returns {string} 格式化的错误信息
     */
    formatErrorMessage(status, statusText, operation, customMessage = null) {
        const operationKey = operation || 'webdav_operation';
        let message = i18n.getMessage('webdav_error_operation_failed', [operation, status]);
        
        // 添加状态码特定的错误描述
        if (customMessage) {
            message += `: ${customMessage}`;
        } else {
            let statusErrorKey = null;
            switch (status) {
                case 401:
                    statusErrorKey = 'webdav_error_401';
                    break;
                case 403:
                    statusErrorKey = 'webdav_error_403';
                    break;
                case 404:
                    statusErrorKey = 'webdav_error_404';
                    break;
                case 405:
                    statusErrorKey = 'webdav_error_405';
                    break;
                case 409:
                    statusErrorKey = 'webdav_error_409';
                    break;
                case 500:
                    statusErrorKey = 'webdav_error_500';
                    break;
                case 501:
                    statusErrorKey = 'webdav_error_501';
                    break;
                case 507:
                    statusErrorKey = 'webdav_error_507';
                    break;
                default:
                    if (statusText) {
                        message += `: ${statusText}`;
                    }
                    break;
            }
            if (statusErrorKey) {
                message += `: ${i18n.getMessage(statusErrorKey)}`;
            }
        }
        
        // 添加通用解决建议
        message += i18n.getMessage('webdav_error_suggestion');
        
        return message;
    }

    /**
     * 测试WebDAV连接
     * @param {string} path - 要测试的文件夹路径
     * @returns {Promise<boolean>} 连接是否成功
     * @throws {Error} 如果连接测试失败
     */
    async testConnection(path = '') {
        try {
            // 发送PROPFIND请求检查目录
            const response = await this.request('PROPFIND', path, {
                headers: {
                    'Depth': '0',
                    'Content-Type': 'application/xml'
                }
            });
            
            // 检查响应状态
            if (!response.ok) {
                switch (response.status) {
                    case 401:
                        throw new Error(this.formatErrorMessage(response.status, response.statusText, i18n.getMessage('webdav_operation_test_connection'), i18n.getMessage('webdav_error_401_test')));
                    case 403:
                        throw new Error(this.formatErrorMessage(response.status, response.statusText, i18n.getMessage('webdav_operation_test_connection'), i18n.getMessage('webdav_error_403_test')));
                    case 404:
                        // 文件夹不存在，尝试创建
                        return await this.createFolder(path);
                    case 405:
                        throw new Error(this.formatErrorMessage(response.status, response.statusText, i18n.getMessage('webdav_operation_test_connection'), i18n.getMessage('webdav_error_405_test')));
                    case 500:
                        throw new Error(this.formatErrorMessage(response.status, response.statusText, i18n.getMessage('webdav_operation_test_connection'), i18n.getMessage('webdav_error_500')));
                    default:
                        throw new Error(this.formatErrorMessage(response.status, response.statusText, i18n.getMessage('webdav_operation_test_connection')));
                }
            }
            
            // 尝试解析返回的XML，确认是WebDAV服务器
            const text = await response.text();
            if (!text.includes('DAV:') && !text.includes('<d:')) {
                throw new Error(i18n.getMessage('webdav_error_invalid_response'));
            }
            
            return true;
        } catch (error) {
            // 处理网络错误
            if (error.name === 'TypeError' && error.message.includes('Failed to fetch')) {
                throw new Error(i18n.getMessage('webdav_error_connection_failed'));
            }
            
            // 重新抛出其他错误
            throw error;
        }
    }

    /**
     * 创建文件夹
     * @param {string} path - 文件夹路径
     * @returns {Promise<boolean>} 创建是否成功
     * @throws {Error} 如果创建失败
     */
    async createFolder(path) {
        try {
            if (!path) {
                return true; // 如果是根目录，则不需要创建
            }
            
            const response = await this.request('MKCOL', path);
            
            if (!response.ok) {
                switch (response.status) {
                    case 401:
                        throw new Error(this.formatErrorMessage(response.status, response.statusText, i18n.getMessage('webdav_operation_create_folder'), i18n.getMessage('webdav_error_401')));
                    case 403:
                        throw new Error(this.formatErrorMessage(response.status, response.statusText, i18n.getMessage('webdav_operation_create_folder'), i18n.getMessage('webdav_error_403')));
                    case 405:
                        throw new Error(this.formatErrorMessage(response.status, response.statusText, i18n.getMessage('webdav_operation_create_folder'), i18n.getMessage('webdav_error_405_create')));
                    case 409:
                        throw new Error(this.formatErrorMessage(response.status, response.statusText, i18n.getMessage('webdav_operation_create_folder'), i18n.getMessage('webdav_error_409')));
                    default:
                        throw new Error(this.formatErrorMessage(response.status, response.statusText, i18n.getMessage('webdav_operation_create_folder')));
                }
            }
            
            return true;
        } catch (error) {
            throw error;
        }
    }

    /**
     * 上传文件
     * @param {string} path - 文件路径
     * @param {string|Blob} content - 文件内容
     * @returns {Promise<boolean>} 上传是否成功
     * @throws {Error} 如果上传失败
     */
    async uploadFile(path, content, headers = {}) {
        try {
            const response = await this.request('PUT', path, {
                body: content,
                headers: headers
            });
            
            if (!response.ok) {
                switch (response.status) {
                    case 401:
                        throw new Error(this.formatErrorMessage(response.status, response.statusText, i18n.getMessage('webdav_operation_upload_file'), i18n.getMessage('webdav_error_401')));
                    case 403:
                        throw new Error(this.formatErrorMessage(response.status, response.statusText, i18n.getMessage('webdav_operation_upload_file'), i18n.getMessage('webdav_error_403')));
                    case 409:
                        throw new Error(this.formatErrorMessage(response.status, response.statusText, i18n.getMessage('webdav_operation_upload_file'), i18n.getMessage('webdav_error_409_upload')));
                    case 507:
                        throw new Error(this.formatErrorMessage(response.status, response.statusText, i18n.getMessage('webdav_operation_upload_file'), i18n.getMessage('webdav_error_507')));
                    default:
                        throw new Error(this.formatErrorMessage(response.status, response.statusText, i18n.getMessage('webdav_operation_upload_file')));
                }
            }
            
            return true;
        } catch (error) {
            throw error;
        }
    }

    /**
     * 下载文件
     * @param {string} path - 文件路径
     * @returns {Promise<string|Blob>} 文件内容
     * @throws {Error} 如果下载失败
     */
    async downloadFile(path, compressed = false) {
        try {
            const response = await this.request('GET', path);
            
            if (!response.ok) {
                switch (response.status) {
                    case 401:
                        throw new Error(this.formatErrorMessage(response.status, response.statusText, i18n.getMessage('webdav_operation_download_file'), i18n.getMessage('webdav_error_401')));
                    case 403:
                        throw new Error(this.formatErrorMessage(response.status, response.statusText, i18n.getMessage('webdav_operation_download_file'), i18n.getMessage('webdav_error_403')));
                    case 404:
                        throw new Error(this.formatErrorMessage(response.status, response.statusText, i18n.getMessage('webdav_operation_download_file'), i18n.getMessage('webdav_error_404_file')));
                    default:
                        throw new Error(this.formatErrorMessage(response.status, response.statusText, i18n.getMessage('webdav_operation_download_file')));
                }
            }
            
            // 根据format参数处理响应
            if (compressed) {
                // 返回二进制数据
                const arrayBuffer = await response.arrayBuffer();
                return new Uint8Array(arrayBuffer);
            } else {
                // 返回文本数据
                return await response.text();
            }
        } catch (error) {
            throw error;
        }
    }

    /**
     * 删除文件或文件夹
     * @param {string} path - 文件或文件夹路径
     * @returns {Promise<boolean>} 删除是否成功
     * @throws {Error} 如果删除失败
     */
    async delete(path) {
        try {
            const response = await this.request('DELETE', path);
            
            if (!response.ok) {
                switch (response.status) {
                    case 401:
                        throw new Error(this.formatErrorMessage(response.status, response.statusText, i18n.getMessage('webdav_operation_delete'), i18n.getMessage('webdav_error_401')));
                    case 403:
                        throw new Error(this.formatErrorMessage(response.status, response.statusText, i18n.getMessage('webdav_operation_delete'), i18n.getMessage('webdav_error_403')));
                    case 404:
                        throw new Error(this.formatErrorMessage(response.status, response.statusText, i18n.getMessage('webdav_operation_delete'), i18n.getMessage('webdav_error_404_delete')));
                    case 423:
                        throw new Error(this.formatErrorMessage(response.status, response.statusText, i18n.getMessage('webdav_operation_delete'), i18n.getMessage('webdav_error_423')));
                    default:
                        throw new Error(this.formatErrorMessage(response.status, response.statusText, i18n.getMessage('webdav_operation_delete')));
                }
            }
            
            return true;
        } catch (error) {
            throw error;
        }
    }

    /**
     * 检查文件是否存在
     * @param {string} path - 文件路径
     * @returns {Promise<boolean>} 文件是否存在
     */
    async fileExists(path) {
        try {
            const response = await this.request('HEAD', path);
            if (!response.ok) {
                switch (response.status) {
                    case 401:
                        throw new Error(this.formatErrorMessage(response.status, response.statusText, i18n.getMessage('webdav_operation_access_file'), i18n.getMessage('webdav_error_401')));
                    case 403:
                        throw new Error(this.formatErrorMessage(response.status, response.statusText, i18n.getMessage('webdav_operation_access_file'), i18n.getMessage('webdav_error_403')));
                    case 404:
                        return false;
                    default:
                        throw new Error(this.formatErrorMessage(response.status, response.statusText, i18n.getMessage('webdav_operation_access_file')));
                }
            }
            return true;
        } catch (error) {
            throw error;
        }
    }
    
    /**
     * 获取文件信息
     * @param {string} path - 文件路径
     * @returns {Promise<Object>} 文件信息对象
     */
    async getFileInfo(path) {
        try {
            const response = await this.request('PROPFIND', path, {
                headers: {
                    'Depth': '0',
                    'Content-Type': 'application/xml'
                }
            });
            
            if (!response.ok) {
                throw new Error(this.formatErrorMessage(response.status, response.statusText, i18n.getMessage('webdav_operation_get_file_info')));
            }
            
            const text = await response.text();
            // 解析XML获取文件信息
            const parser = new DOMParser();
            const xmlDoc = parser.parseFromString(text, "text/xml");
            
            // 获取最后修改时间
            const lastModified = xmlDoc.querySelector('d\\:getlastmodified, getlastmodified')?.textContent ||
                                xmlDoc.querySelector('getlastmodified')?.textContent;
            
            // 获取文件大小
            const contentLength = xmlDoc.querySelector('d\\:getcontentlength, getcontentlength')?.textContent ||
                                 xmlDoc.querySelector('getcontentlength')?.textContent;
            
            return {
                exists: true,
                lastModified: lastModified ? new Date(lastModified) : null,
                size: contentLength ? parseInt(contentLength) : 0
            };
        } catch (error) {
            return {
                exists: false,
                lastModified: null,
                size: 0
            };
        }
    }

    /**
     * 列出目录内容
     * @param {string} path - 目录路径
     * @returns {Promise<Array>} 目录内容列表
     * @throws {Error} 如果获取失败
     */
    async listDirectory(path = '') {
        try {
            const response = await this.request('PROPFIND', path, {
                headers: {
                    'Depth': '1',
                    'Content-Type': 'application/xml'
                }
            });
            
            if (!response.ok) {
                switch (response.status) {
                    case 401:
                        throw new Error(this.formatErrorMessage(response.status, response.statusText, i18n.getMessage('webdav_operation_list_directory'), i18n.getMessage('webdav_error_401')));
                    case 403:
                        throw new Error(this.formatErrorMessage(response.status, response.statusText, i18n.getMessage('webdav_operation_list_directory'), i18n.getMessage('webdav_error_403')));
                    case 404:
                        throw new Error(this.formatErrorMessage(response.status, response.statusText, i18n.getMessage('webdav_operation_list_directory'), i18n.getMessage('webdav_error_404_directory')));
                    default:
                        throw new Error(this.formatErrorMessage(response.status, response.statusText, i18n.getMessage('webdav_operation_list_directory')));
                }
            }
            
            const text = await response.text();
            // 这里需要解析XML，简单示例
            // 实际实现可能需要更复杂的XML解析
            const files = [];
            const parser = new DOMParser();
            const xmlDoc = parser.parseFromString(text, "text/xml");
            
            // 查找所有响应
            const responses = xmlDoc.getElementsByTagName('d:response') || xmlDoc.getElementsByTagName('response');
            
            for (let i = 0; i < responses.length; i++) {
                const href = responses[i].getElementsByTagName('d:href')[0]?.textContent || 
                            responses[i].getElementsByTagName('href')[0]?.textContent;
                
                if (href) {
                    files.push({
                        path: href,
                        name: href.split('/').filter(p => p).pop() || '/'
                    });
                }
            }
            
            return files;
        } catch (error) {
            throw error;
        }
    }
}