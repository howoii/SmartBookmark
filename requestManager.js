/**
 * 请求管理器
 * 用于创建和管理可取消的HTTP请求
 */
class RequestManager {
  constructor() {
    // 存储所有活跃的请求控制器
    this.controllers = new Map();
  }

  /**
   * 创建一个可取消的请求
   * @param {string} requestId - 请求的唯一标识符，如果不提供则自动生成
   * @returns {Object} 包含signal和控制该请求的方法
   */
  create(requestId = null) {
    // 如果未提供ID，则生成一个唯一ID
    const id = requestId || `request_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
    
    // 创建新的AbortController
    const controller = new AbortController();
    
    // 存储controller以便后续引用
    this.controllers.set(id, controller);
    
    return {
      id,
      signal: controller.signal,
      
      // 取消这个请求的方法
      abort: (reason) => this.abort(id, reason),
      
      // 当请求完成时，从管理器中移除
      done: () => this.remove(id)
    };
  }
  
  /**
   * 取消特定请求
   * @param {string} requestId - 要取消的请求ID
   * @param {any} reason - 取消原因（可选）
   * @returns {boolean} 是否成功取消
   */
  abort(requestId, reason = 'UserCanceled') {
    const controller = this.controllers.get(requestId);
    if (!controller) return false;
    
    try {
      controller.abort(reason);
      return true;
    } catch (error) {
      console.error(`取消请求 ${requestId} 失败:`, error);
      return false;
    } finally {
      this.remove(requestId);
    }
  }
  
  /**
   * 从管理器中移除请求
   * @param {string} requestId - 要移除的请求ID
   */
  remove(requestId) {
    this.controllers.delete(requestId);
  }
  
  /**
   * 取消所有活跃的请求
   * @param {string} reason - 取消原因
   */
  abortAll(reason = '批量取消') {
    this.controllers.forEach((controller, id) => {
      try {
        controller.abort(reason);
      } catch (error) {
        console.error(`取消请求 ${id} 失败:`, error);
      }
    });
    
    // 清空所有控制器
    this.controllers.clear();
  }
  
  /**
   * 获取活跃请求数量
   * @returns {number} 活跃请求数
   */
  get activeCount() {
    return this.controllers.size;
  }
  
  /**
   * 检查特定请求是否活跃
   * @param {string} requestId - 请求ID
   * @returns {boolean} 请求是否活跃
   */
  isActive(requestId) {
    return this.controllers.has(requestId);
  }
}

// 创建全局单例
const requestManager = new RequestManager();
