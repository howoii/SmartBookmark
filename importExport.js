class ImportExportManager {
    constructor() {
        this.exportDialog = document.getElementById('export-dialog');
        this.importDialog = document.getElementById('import-dialog');
        this.fileInput = document.getElementById('import-file-input');
        this.dropZone = document.getElementById('file-drop-zone');
        
        // 导出相关元素
        this.exportBookmarksCheckbox = document.getElementById('export-bookmarks');
        this.exportSettingsCheckbox = document.getElementById('export-settings');
        this.exportFiltersCheckbox = document.getElementById('export-filters');
        this.exportApiServicesCheckbox = document.getElementById('export-api-services');
        this.exportCount = document.getElementById('export-count');
        this.confirmExportBtn = document.getElementById('confirm-export-btn');
        this.cancelExportBtn = document.getElementById('cancel-export-btn');
        this.closeExportDialogBtn = this.exportDialog.querySelector('.close-dialog-btn');
        
        // 导入相关元素
        this.importBookmarksCheckbox = document.getElementById('import-bookmarks');
        this.importSettingsCheckbox = document.getElementById('import-settings');
        this.importFiltersCheckbox = document.getElementById('import-filters');
        this.importApiServicesCheckbox = document.getElementById('import-api-services');
        this.importCount = document.getElementById('import-count');
        this.bookmarkCount = document.getElementById('bookmark-count');
        this.filterCount = document.getElementById('filter-count');
        this.apiServiceCount = document.getElementById('api-service-count');
        this.confirmImportBtn = document.getElementById('confirm-import-file-btn');
        this.cancelImportBtn = document.getElementById('cancel-import-file-btn');
        this.importOptions = this.importDialog.querySelector('.import-options-container');
        this.importSummary = this.importDialog.querySelector('.import-summary');
        this.closeImportDialogBtn = this.importDialog.querySelector('.close-dialog-btn');
        this.importCheckGroup = this.importOptions.querySelector('.checkbox-group');

        this.currentImportData = null;
        this.isImporting = false;

        // 绑定函数
        this.updateExportCount = this.updateExportCount.bind(this);
        this.updateImportCount = this.updateImportCount.bind(this);
        this.handleFileSelect = this.handleFileSelect.bind(this);
        this.handleExport = this.handleExport.bind(this);
        this.handleImport = this.handleImport.bind(this);
        this.hideExportDialog = this.hideExportDialog.bind(this);
        this.hideImportDialog = this.hideImportDialog.bind(this);
        this.handleEscKey = this.handleEscKey.bind(this);
        
        this.initialize();
    }
    
    initialize() {
        // 绑定导出相关事件
        this.exportBookmarksCheckbox.addEventListener('change', () => this.updateExportCount());
        this.confirmExportBtn.addEventListener('click', () => this.handleExport());
        this.cancelExportBtn.addEventListener('click', () => this.hideExportDialog());
        this.closeExportDialogBtn.addEventListener('click', () => this.hideExportDialog());
        
        // 绑定导入相关事件
        this.fileInput.addEventListener('change', (e) => this.handleFileSelect(e));
        this.confirmImportBtn.addEventListener('click', () => this.handleImport());
        this.cancelImportBtn.addEventListener('click', () => this.hideImportDialog());
        this.closeImportDialogBtn.addEventListener('click', () => this.hideImportDialog());
        
        // 绑定拖放相关事件
        this.dropZone.addEventListener('dragover', (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.dropZone.classList.add('drag-over');
        });
        
        this.dropZone.addEventListener('dragleave', (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.dropZone.classList.remove('drag-over');
        });
        
        this.dropZone.addEventListener('drop', (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.dropZone.classList.remove('drag-over');
            
            const file = e.dataTransfer.files[0];
            if (file) {
                this.fileInput.files = e.dataTransfer.files;
                this.handleFileSelect({ target: this.fileInput });
            }
        });
        
        // 绑定选择文件按钮
        document.querySelector('.select-file-btn').addEventListener('click', () => {
            this.fileInput.click();
        });
        
        // 绑定导入选项变化事件
        this.importCheckGroup.querySelectorAll('input[type="checkbox"]').forEach(checkbox => {   
            checkbox.addEventListener('change', () => this.updateImportCount());
        });
    }
    
    showExportDialog() {
        this.exportDialog.classList.add('show');
        this.resetExportDialog();
        this.updateExportCount();
    }

    resetExportDialog() {
        this.confirmExportBtn.disabled = false;
        this.confirmExportBtn.querySelector('.loading-spinner').classList.remove('show');
    }
    
    hideExportDialog() {
        this.exportDialog.classList.remove('show');
    }
    
    showImportDialog() {
        this.importDialog.classList.add('show');
        this.resetImportDialog();
    }
    
    hideImportDialog() {
        this.importDialog.classList.remove('show');
    }
    
    resetImportDialog() {
        this.fileInput.value = '';
        this.importOptions.classList.remove('show');
        this.importSummary.classList.remove('show');
        this.dropZone.classList.remove('file-selected');
        this.confirmImportBtn.disabled = true;
        this.confirmImportBtn.querySelector('.loading-spinner').classList.remove('show');
        this.importCount.textContent = 0;
        this.bookmarkCount.textContent = 0;
        this.filterCount.textContent = 0;
        this.apiServiceCount.textContent = 0;

        // 重置复选框状态
        this.importCheckGroup.querySelectorAll('input[type="checkbox"]').forEach(checkbox => {
            checkbox.disabled = false;
            checkbox.checked = false;
            checkbox.closest('.checkbox-container').classList.remove('disabled');
        });

        this.currentImportData = null;
        this.isImporting = false;
    }
    
    async updateExportCount() {
        const bookmarks = await LocalStorageMgr.getBookmarksList();
        const bookmarkCount = this.exportBookmarksCheckbox.checked ? 
            bookmarks.length : 0;
        this.exportCount.textContent = bookmarkCount;
    }
    
    updateImportCount() {
        if (!this.currentImportData) return;
        
        let count = 0;
        if (this.importBookmarksCheckbox.checked && this.currentImportData.data.bookmarks) {
            count += this.currentImportData.data.bookmarks.length;
        }
        if (this.importSettingsCheckbox.checked && this.currentImportData.data.settings) {
            count++;
        }
        if (this.importFiltersCheckbox.checked && this.currentImportData.data.filters) {
            count += this.currentImportData.data.filters.rules?.length || 0;
        }
        if (this.importApiServicesCheckbox.checked && this.currentImportData.data.apiServices) {
            count++;
        }
        
        this.importCount.textContent = count;
        this.confirmImportBtn.disabled = count === 0;
    }
    
    async handleFileSelect(event) {
        const file = event.target.files[0];
        if (!file) return;
        
        try {
            const text = await file.text();
            const data = JSON.parse(text);
            
            // 验证文件格式
            if (!this.validateImportData(data)) {
                throw new Error('无效的导入文件格式');
            }
            
            this.currentImportData = data;
            // 更新UI显示
            this.importOptions.classList.add('show');
            this.importSummary.classList.add('show');
            this.dropZone.classList.add('file-selected');
            
            // 更新统计信息和控制复选框状态
            const bookmarksExist = data.data.bookmarks && data.data.bookmarks.length > 0;
            const settingsExist = data.data.settings || data.data.configs;
            const filtersExist = data.data.filters && data.data.filters.rules;
            const apiServicesExist = data.data.apiServices && (
                Object.keys(data.data.apiServices.customServices || {}).length > 0 ||
                Object.keys(data.data.apiServices.apiKeys || {}).length > 0
            );

            // 更新复选框状态和统计数字
            this.importBookmarksCheckbox.disabled = !bookmarksExist;
            this.importBookmarksCheckbox.checked = bookmarksExist;
            this.importBookmarksCheckbox.closest('.checkbox-container').classList.toggle('disabled', !bookmarksExist);
            this.bookmarkCount.textContent = bookmarksExist ? data.data.bookmarks.length : 0;

            this.importSettingsCheckbox.disabled = !settingsExist;
            this.importSettingsCheckbox.checked = settingsExist;
            this.importSettingsCheckbox.closest('.checkbox-container').classList.toggle('disabled', !settingsExist);

            this.importFiltersCheckbox.disabled = !filtersExist;
            this.importFiltersCheckbox.checked = filtersExist;
            this.importFiltersCheckbox.closest('.checkbox-container').classList.toggle('disabled', !filtersExist);
            this.filterCount.textContent = filtersExist ? data.data.filters.rules.length : 0;

            this.importApiServicesCheckbox.disabled = !apiServicesExist;
            this.importApiServicesCheckbox.checked = apiServicesExist;
            this.importApiServicesCheckbox.closest('.checkbox-container').classList.toggle('disabled', !apiServicesExist);
            let apiServiceCount = 0;
            if (apiServicesExist) {
                const customServicesCount = Object.keys(data.data.apiServices.customServices || {}).length;
                const apiKeysCount = Object.keys(data.data.apiServices.apiKeys || {}).length;
                apiServiceCount = customServicesCount + apiKeysCount;
            }
            this.apiServiceCount.textContent = apiServiceCount;
            
            this.updateImportCount();
            
        } catch (error) {
            showToast('导入文件解析失败：' + error.message, true);
            this.resetImportDialog();
        }
    }
    
    validateImportData(data) {
        return data && 
               data.type === 'smart-bookmark-export' &&
               data.version &&
               data.data &&
               (data.data.bookmarks || data.data.settings || data.data.filters || data.data.apiServices);
    }

    getCurrentVersion() {
        const manifest = chrome.runtime.getManifest();
        return manifest.version;
    }
    
    async handleExport() {
        // 检查如果没有选择导出项，则提示
        const checkgroup = this.exportDialog.querySelector('.export-options-container .checkbox-group');
        const checkboxes = checkgroup.querySelectorAll('input[type="checkbox"]');
        const isChecked = Array.from(checkboxes).some(checkbox => checkbox.checked);
        if (!isChecked) {
            showToast('请选择导出项');
            return;
        }
        try {
            this.confirmExportBtn.disabled = true;
            this.confirmExportBtn.querySelector('.loading-spinner').classList.add('show');
            
            const version = this.getCurrentVersion();
            const exportData = {
                type: 'smart-bookmark-export',
                version: version,
                exportDate: new Date().toISOString(),
                data: {},
                meta: {}
            };
            
            // 导出书签数据
            if (this.exportBookmarksCheckbox.checked) {
                const bookmarks = await LocalStorageMgr.getBookmarksList();
                exportData.data.bookmarks = bookmarks;
                exportData.meta.bookmarkCount = bookmarks.length;
            }
            
            // 导出设置项
            if (this.exportSettingsCheckbox.checked) {
                const settings = await SettingsManager.getAll();
                exportData.data.settings = settings;
                exportData.data.configs = await ConfigManager.getConfigExportData();
            }
            
            // 导出过滤器
            if (this.exportFiltersCheckbox.checked) {
                const filters = await customFilter.getExportData();
                exportData.data.filters = filters;
                exportData.meta.filterCount = filters.rules.length;
            }

            // 导出API服务设置
            if (this.exportApiServicesCheckbox.checked) {
                exportData.data.apiServices = await ConfigManager.getServiceExportData();
            }
            
            // 生成文件并下载
            const jsonString = JSON.stringify(exportData);
            const blob = new Blob([jsonString], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;

            // 根据导出项生成文件名
            const now = new Date();
            const date = now.toISOString().split('T')[0];
            const secondsOfDay = now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds();
            const filename = `smart-bookmark-${date}-${secondsOfDay}.json`;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            
            showToast('导出成功');
            this.hideExportDialog();
            
        } catch (error) {
            showToast('导出失败：' + error.message, true);
        } finally {
            this.confirmExportBtn.disabled = false;
            this.confirmExportBtn.querySelector('.loading-spinner').classList.remove('show');
        }
    }
    
    async handleImport() {
        if (!this.currentImportData) return;
        if (this.isImporting) {
            showToast('导入中，请稍后...');
            return;
        }
        
        try {
            this.isImporting = true;
            this.confirmImportBtn.disabled = true;
            this.confirmImportBtn.querySelector('.loading-spinner').classList.add('show');
            
            const importMode = document.querySelector('input[name="import-mode"]:checked').value;
            const isOverwrite = importMode === 'overwrite';
            
            const data = this.currentImportData.data;
            let importedCount = 0;
            
            // 导入书签
            if (this.importBookmarksCheckbox.checked && data.bookmarks) {
                if (isOverwrite) {
                    const bookmarks = await LocalStorageMgr.getBookmarksList();
                    if (bookmarks.length > 0) {
                        await LocalStorageMgr.clearBookmarks();
                        await recordBookmarkChange(bookmarks, true, false);
                    }
                }
                await LocalStorageMgr.setBookmarks(data.bookmarks);
                await recordBookmarkChange(data.bookmarks, false, false);
                importedCount += data.bookmarks.length;
            }
            
            // 导入设置
            if (this.importSettingsCheckbox.checked && data.settings) {
                if (isOverwrite) {
                    await SettingsManager.reset();
                }
                await SettingsManager.update(data.settings);
                await ConfigManager.importConfigData(data.configs, isOverwrite);
                importedCount++;
            }
            
            // 导入过滤器
            if (this.importFiltersCheckbox.checked && data.filters) {
                await customFilter.importFilters(data.filters, isOverwrite);
                importedCount += data.filters.rules?.length || 0;
            }

            // 导入API服务设置
            if (this.importApiServicesCheckbox.checked && data.apiServices) {
                await ConfigManager.importServiceData(data.apiServices, isOverwrite);
                importedCount++;
            }
            
            // 显示导入结果
            if (importedCount > 0) {
                showToast(`成功导入 ${importedCount} 个项目，请刷新页面`);
            } else {
                showToast('导入成功，请刷新页面');
            }
            
            // 如果导入了书签，发送更新消息
            if (this.importBookmarksCheckbox.checked && data.bookmarks) {
                logger.info('导入书签成功，发送更新消息');
                sendMessageSafely({
                    type: MessageType.BOOKMARKS_UPDATED,
                    source: 'import_from_file'
                });
                sendMessageSafely({
                    type: MessageType.AUTO_SYNC_BOOKMARK,
                }, (response) => {
                    if (response && response.error) {
                        showToast('书签同步失败: ' + response.error, true);
                    }
                });
            }

            this.hideImportDialog();
        } catch (error) {
            showToast('导入失败：' + error.message, true);
        } finally {
            this.isImporting = false;
            this.confirmImportBtn.disabled = false;
            this.confirmImportBtn.querySelector('.loading-spinner').classList.remove('show');
        }
    }

    handleEscKey(e) {
        this.hideExportDialog();
        this.hideImportDialog();
    }
}

// 初始化导入导出管理器
const importExportManager = new ImportExportManager(); 