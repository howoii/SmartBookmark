// 获取插件版本并发送给登录页面
function sendVersionToPage() {
    const manifest = chrome.runtime.getManifest();
    window.postMessage({
        type: 'EXTENSION_VERSION',
        version: manifest.version
    }, '*');
}

// 页面加载完成后执行
sendVersionToPage(); 