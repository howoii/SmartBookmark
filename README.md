# SmartBookmark
Smart Bookmark 是一款基于 AI 的智能书签管理插件，专注于解决书签收藏和搜索的痛点。插件简洁高效，让书签管理变得更加智能和省心！

### **Chrome 商店链接**  
[🔗 Smart Bookmark - 点击体验](https://chromewebstore.google.com/detail/smart-bookmark/nlboajobccgidfcdoedphgfaklelifoa)  

### **功能亮点**  
- **AI 自动生成标签**：收藏网页时，智能生成相关标签，无需手动归类，彻底告别繁琐的文件夹！  
- **语义化搜索**：记不住关键词也不用担心，用自然语言描述内容即可快速找到目标书签。  
- **自定义筛选规则**：支持按标题、标签、网址等筛选规则，轻松实现书签自动归类，管理更加高效。  

### **插件截图**  
![view-4](pic/view-4.png)  
![view-3](pic/view-3.png)  

### **使用成本**  
插件完全免费！用户只需提供自己的模型 API Key（目前支持 OpenAI、通义千问、智谱 GLM）。经过实际测试，**1 元的 Token 足够使用一个多月**，高效又实惠，轻松享受 AI 的强大能力！  

### **开发计划**  
- [x] 支持更多API，增加自定义API支持
- [x] 支持导入浏览器书签
- [x] 支持书签收藏、搜索快捷键
- [x] 增加深色模式
- [x] 支持书签导入导出功能  
- [x] 支持Ollama本地模型
- [x] 增加webdav同步功能
- [ ] 支持AI生成书签摘要
- [ ] 支持智能推荐标签
- [ ] 支持自定义提示词
- [ ] 支持AI自动分类
- [ ] 增加多语言支持
- [ ] 上架Edge浏览器商店

### FAQ
#### 如何接入Ollama本地模型？
<details>
<summary>点击查看</summary>

1. 安装 [Ollama](https://ollama.com/)
2. 设置允许跨域并启动</br>
    macOS：命令行执行 `launchctl setenv OLLAMA_ORIGINS "*"`，再启动 App。</br>
    Windows：控制面板 - 系统属性 - 环境变量 - 用户环境变量新建 2 个环境变量：变量名`OLLAMA_HOST`变量值`0.0.0.0`，变量名`OLLAMA_ORIGINS`变量值`*`，再启动 App。</br>
    Linux：命令行执行 `OLLAMA_ORIGINS="*" ollama serve`。
3. API 自定义服务配置<br>
    API 接口地址：`http://localhost:11434/v1`<br>
    API Key：`ollama`<br>
    模型：你本地安装的模型<br>
</details>

### **反馈交流群** 
<img width="256" src="pic/wechat.jpg?v=20250228" />

### **感谢**  
本项目使用Cursor开发，感谢 [Cursor](https://www.cursor.com/) 提供的强大AI能力！

### **License**
本项目基于 [MIT 协议](LICENSE) 开源，请遵守协议内容。
