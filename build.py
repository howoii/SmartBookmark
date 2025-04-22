import json
import sys
import re
from datetime import datetime

def update_version_info():
    """更新 version.js 中的版本信息"""
    # 读取 manifest.json 获取版本号
    with open('manifest.json', 'r', encoding='utf-8') as f:
        manifest = json.load(f)
        version = manifest.get('version', '1.0.0')
    
    # 获取当前日期
    today = datetime.now().strftime('%Y-%m-%d')
    
    # 生成版本信息
    version_content = f'''// 此文件由构建脚本自动生成，请勿手动修改
const VERSION_INFO = {{
    version: '{version}',
    lastUpdate: '{today}'  // 由构建脚本自动更新
}};'''
    
    # 写入 version.js
    with open('version.js', 'w', encoding='utf-8') as f:
        f.write(version_content)

def update_env_js(env):
    """更新 env.js 中的当前环境"""
    with open('env.js', 'r', encoding='utf-8') as f:
        content = f.read()
    
    # 更新环境设置
    content = re.sub(
        r"current:\s*'[^']*'",
        f"current: '{env}'",
        content
    )
    
    with open('env.js', 'w', encoding='utf-8') as f:
        f.write(content)

def update_manifest(env):
    # 读取环境配置
    with open('env.json', 'r', encoding='utf-8') as f:
        env_config = json.load(f)
    
    # 读取并更新 manifest.json
    with open('manifest.json', 'r', encoding='utf-8') as f:
        manifest = json.load(f)
    
    # 从环境配置中更新 manifest 相关配置
    manifest_updates = env_config[env]['manifest']
    manifest.update(manifest_updates)
    
    # 写回 manifest
    with open('manifest.json', 'w', encoding='utf-8') as f:
        json.dump(manifest, f, indent=4, ensure_ascii=False)

if __name__ == '__main__':
    env = sys.argv[1] if len(sys.argv) > 1 else 'development'
    if env not in ['development', 'production']:
        print(f'错误: 无效的环境 "{env}"，请使用 development 或 production')
        sys.exit(1)
    
    try:
        update_env_js(env)
        update_manifest(env)
        update_version_info()
        print(f'已成功更新配置为{env}环境')
    except Exception as e:
        print(f'更新配置失败: {str(e)}')
        sys.exit(1)