// 图标/颜色选择器独立组件
// 依赖: lib/lucide-icons.js（提供 LUCIDE_ICONS）
class IconPicker {
    constructor(triggerEl, options = {}) {
        this.triggerEl = triggerEl;
        this.onSelect = options.onSelect || null;
        this.selectedIcon = null;
        this.selectedColor = null;
        this.panel = null;

        this._buildPanel();
        this._bindTrigger();
        this._bindGlobalEvents();
    }

    // 通过自定义 key 查找图标数据（兼容直接传入 Lucide key）
    static resolveIconData(key) {
        if (!key) return null;
        const lucideKey = IconPicker.ICON_REGISTRY[key] || key;
        return LUCIDE_ICONS[lucideKey] || null;
    }

    static iconDataToInnerHtml(iconData) {
        if (!iconData) return '';
        return iconData.map(([tag, attrs]) => {
            const attrStr = Object.entries(attrs)
                .map(([k, v]) => `${k}="${v}"`)
                .join(' ');
            return `<${tag} ${attrStr}/>`;
        }).join('');
    }

    static getIconSvg(iconKey, size = 16, color = null) {
        const data = IconPicker.resolveIconData(iconKey);
        if (!data) return '';
        const inner = IconPicker.iconDataToInnerHtml(data);
        const colorAttr = color ? ` style="color:${color}"` : '';
        return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" ${IconPicker.SVG_ATTRS}${colorAttr}>${inner}</svg>`;
    }

    _buildPanel() {
        this.panel = document.createElement('div');
        this.panel.className = 'icon-picker-panel';
        this.panel.style.display = 'none';

        // 颜色区域
        const colorsWrap = document.createElement('div');
        colorsWrap.className = 'icon-picker-colors';

        const noneColor = document.createElement('div');
        noneColor.className = 'icon-picker-color-none selected';
        noneColor.dataset.color = '';
        noneColor.innerHTML = `<svg viewBox="0 0 24 24" width="14" height="14" ${IconPicker.SVG_ATTRS}><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>`;
        noneColor.addEventListener('click', () => this._selectColor(null));
        colorsWrap.appendChild(noneColor);

        for (const color of IconPicker.PRESET_COLORS) {
            const dot = document.createElement('div');
            dot.className = 'icon-picker-color';
            dot.dataset.color = color;
            dot.style.backgroundColor = color;
            dot.addEventListener('click', () => this._selectColor(color));
            colorsWrap.appendChild(dot);
        }

        // 分隔线
        const divider = document.createElement('div');
        divider.className = 'icon-picker-divider';

        // 图标区域
        const iconsWrap = document.createElement('div');
        iconsWrap.className = 'icon-picker-icons';

        const defaultData = IconPicker.resolveIconData(IconPicker.DEFAULT_ICON);
        const defaultInner = IconPicker.iconDataToInnerHtml(defaultData);

        const noneIcon = document.createElement('div');
        noneIcon.className = 'icon-picker-icon icon-picker-icon-default selected';
        noneIcon.dataset.icon = '';
        noneIcon.innerHTML = `<svg viewBox="0 0 24 24" ${IconPicker.SVG_ATTRS}>${defaultInner}</svg>`;
        noneIcon.addEventListener('click', () => this._selectIcon(null));
        iconsWrap.appendChild(noneIcon);

        for (const key of IconPicker.PICKER_ICONS) {
            const data = IconPicker.resolveIconData(key);
            if (!data) continue;
            const inner = IconPicker.iconDataToInnerHtml(data);
            const cell = document.createElement('div');
            cell.className = 'icon-picker-icon';
            cell.dataset.icon = key;
            cell.innerHTML = `<svg viewBox="0 0 24 24" ${IconPicker.SVG_ATTRS}>${inner}</svg>`;
            cell.addEventListener('click', () => this._selectIcon(key));
            iconsWrap.appendChild(cell);
        }

        this.panel.appendChild(colorsWrap);
        this.panel.appendChild(divider);
        this.panel.appendChild(iconsWrap);
        document.body.appendChild(this.panel);
    }

    _bindTrigger() {
        this.triggerEl.addEventListener('click', (e) => {
            e.stopPropagation();
            if (this.isOpen()) {
                this.close();
            } else {
                this.open();
            }
        });
    }

    _bindGlobalEvents() {
        this._onDocClick = (e) => {
            if (this.isOpen() &&
                !this.panel.contains(e.target) &&
                !this.triggerEl.contains(e.target)) {
                this.close();
            }
        };
        this._onKeyDown = (e) => {
            if (e.key === 'Escape' && this.isOpen()) {
                this.close();
            }
        };
        document.addEventListener('click', this._onDocClick);
        document.addEventListener('keydown', this._onKeyDown);
    }

    _selectColor(color) {
        this.selectedColor = color;
        this._updateSelection();
        this._updateTrigger();
        if (this.onSelect) this.onSelect(this.selectedIcon, this.selectedColor);
    }

    _selectIcon(iconKey) {
        this.selectedIcon = iconKey;
        this._updateSelection();
        this._updateTrigger();
        if (this.onSelect) this.onSelect(this.selectedIcon, this.selectedColor);
    }

    _updateSelection() {
        this.panel.querySelectorAll('.icon-picker-color, .icon-picker-color-none').forEach(el => {
            if (el.classList.contains('icon-picker-color-none')) {
                el.classList.toggle('selected', !this.selectedColor);
            } else {
                el.classList.toggle('selected', el.dataset.color === this.selectedColor);
            }
        });
        const iconColor = this.selectedColor || '';
        this.panel.querySelectorAll('.icon-picker-icon').forEach(el => {
            const isDefault = el.classList.contains('icon-picker-icon-default');
            if (isDefault) {
                el.classList.toggle('selected', !this.selectedIcon);
            } else {
                el.classList.toggle('selected', el.dataset.icon === this.selectedIcon);
            }
            el.style.color = iconColor || '';
        });
    }

    _updateTrigger() {
        const data = IconPicker.resolveIconData(this.selectedIcon || IconPicker.DEFAULT_ICON);
        const inner = IconPicker.iconDataToInnerHtml(data);
        const oldSvg = this.triggerEl.querySelector('svg');
        if (oldSvg) {
            const newSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
            newSvg.setAttribute('viewBox', '0 0 24 24');
            newSvg.setAttribute('width', oldSvg.getAttribute('width') || '16');
            newSvg.setAttribute('height', oldSvg.getAttribute('height') || '16');
            newSvg.setAttribute('fill', 'none');
            newSvg.setAttribute('stroke', 'currentColor');
            newSvg.setAttribute('stroke-width', '2');
            newSvg.setAttribute('stroke-linecap', 'round');
            newSvg.setAttribute('stroke-linejoin', 'round');
            newSvg.innerHTML = inner;
            oldSvg.replaceWith(newSvg);
        }
        this.triggerEl.style.color = this.selectedColor || '';
    }

    isOpen() {
        return this.panel.style.display !== 'none';
    }

    open() {
        const rect = this.triggerEl.getBoundingClientRect();
        this.panel.style.left = rect.left + 'px';
        this.panel.style.top = (rect.bottom + 6) + 'px';
        this.panel.style.display = '';

        requestAnimationFrame(() => {
            const panelRect = this.panel.getBoundingClientRect();
            if (panelRect.bottom > window.innerHeight - 8) {
                this.panel.style.top = (rect.top - panelRect.height - 6) + 'px';
            }
        });
    }

    close() {
        this.panel.style.display = 'none';
    }

    getValue() {
        return { icon: this.selectedIcon, color: this.selectedColor };
    }

    setValue(icon, color) {
        this.selectedIcon = icon || null;
        this.selectedColor = color || null;
        this._updateSelection();
        this._updateTrigger();
    }

    destroy() {
        document.removeEventListener('click', this._onDocClick);
        document.removeEventListener('keydown', this._onKeyDown);
        if (this.panel && this.panel.parentNode) {
            this.panel.parentNode.removeChild(this.panel);
        }
    }
}

// 默认图标（未选择时显示，不出现在面板可选列表中）
IconPicker.DEFAULT_ICON = '_default';

// 图标注册表：自定义 key -> Lucide PascalCase key
// 用于 resolveIconData 等查找；存储层只保存自定义 key，与图标库解耦
IconPicker.ICON_REGISTRY = {
    // 通用
    folder:     'Folder',
    bookmark:   'Bookmark',
    star:       'Star',
    heart:      'Heart',
    flag:       'Flag',
    tag:        'Tag',
    pin:        'Pin',
    // 开发/技术
    code:       'Code',
    terminal:   'Terminal',
    laptop:     'Laptop',
    smartphone: 'Smartphone',
    database:   'Database',
    cloud:      'Cloud',
    cpu:        'Cpu',
    // 工作/商务
    briefcase:  'Briefcase',
    building:   'Building',
    chart:      'BarChart3',
    // 学习/知识
    book:       'BookOpen',
    graduation: 'GraduationCap',
    lightbulb:  'Lightbulb',
    pencil:     'Pencil',
    newspaper:  'Newspaper',
    rss:        'Rss',
    // 社交/通讯
    mail:       'Mail',
    message:    'MessageCircle',
    phone:      'Phone',
    users:      'Users',
    // 媒体/娱乐
    music:      'Music',
    camera:     'Camera',
    film:       'Film',
    video:      'Video',
    image:      'Image',
    headphones: 'Headphones',
    palette:    'Palette',
    gamepad:    'Gamepad',
    // 电商/金融
    home:       'Home',
    cart:       'ShoppingCart',
    store:      'Store',
    wallet:     'Wallet',
    creditcard: 'CreditCard',
    package:    'Package',
    // 生活/旅行
    food:       'Utensils',
    coffee:     'Coffee',
    dumbbell:   'Dumbbell',
    heartpulse: 'HeartPulse',
    plane:      'Plane',
    globe:      'Globe',
    car:        'Car',
    mappin:     'MapPin',
    compass:    'Compass',
    leaf:       'Leaf',
    pawprint:   'PawPrint',
    // 工具/安全
    wrench:     'Wrench',
    shield:     'Shield',
    lock:       'Lock',
    key:        'Key',
    eye:        'Eye',
    // 其他
    clock:      'Clock',
    search:     'Search',
    link:       'Link',
    sparkles:   'Sparkles',
    zap:        'Zap',
    _default:   'SmilePlus',
};

// 面板可选图标列表（有序），与 ICON_REGISTRY 解耦
// 仅控制 picker panel 中展示哪些图标及其顺序；每行 6 个
IconPicker.PICKER_ICONS = [
    // 通用
    'folder', 'bookmark', 'star', 'heart', 'flag', 'tag',
    // 开发/技术
    'pin', 'code', 'terminal', 'laptop', 'smartphone', 'database',
    'cloud', 'cpu', 'briefcase', 'building', 'chart', 'book',
    // 学习/资讯
    'graduation', 'lightbulb', 'pencil', 'newspaper', 'rss', 'mail',
    // 社交/通讯
    'message', 'phone', 'users', 'music', 'camera', 'film',
    // 媒体/娱乐
    'video', 'image', 'headphones', 'palette', 'gamepad', 'home',
    // 电商/金融
    'cart', 'store', 'wallet', 'creditcard', 'package', 'food',
    // 生活/旅行
    'coffee', 'dumbbell', 'heartpulse', 'plane', 'globe', 'car',
    'mappin', 'compass', 'leaf', 'pawprint', 'wrench', 'shield', 'lock',
    // 工具/安全/其他
    'key', 'eye', 'clock', 'search', 'link', 'sparkles',
    'zap',
];

// 预设颜色列表
IconPicker.PRESET_COLORS = [
    '#78909c', '#e53935', '#f4511e', '#fdd835',
    '#43a047', '#1e88e5', '#8e24aa', '#ec407a',
];

// Lucide SVG 公共属性
IconPicker.SVG_ATTRS = 'fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"';
