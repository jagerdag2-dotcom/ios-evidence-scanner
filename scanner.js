// ============================================
// iOS EVIDENCE SCANNER - VERSÃO COMPLETA 2.2.0
// ============================================

// ============================================
// 1. CONFIGURATION MANAGER
// ============================================

class ConfigManager {
    constructor() {
        this.config = {
            appName: 'iOS Evidence Scanner',
            version: '2.2.0',
            maxFileSize: 50 * 1024 * 1024,
            supportedExtensions: ['.plist', '.log', '.txt', '.json', '.ips', '.csv', '.xml', '.tracev3', '.ndjson', '.ndj', '.jsonl'],
            debug: false,
            cacheEnabled: true,
            maxCacheSize: 100,
            timeout: 30000,
            confidenceThresholds: {
                critical: 4,
                high: 3,
                medium: 2,
                low: 1
            },
            scoreWeights: {
                critical: 100,
                high: 50,
                medium: 25,
                low: 10
            }
        };
    }

    get(key) { return this.config[key]; }
    set(key, value) { this.config[key] = value; }
    getSupportedExtensions() { return this.config.supportedExtensions; }
    getMaxFileSize() { return this.config.maxFileSize; }
}

// ============================================
// 2. LOGGER
// ============================================

class Logger {
    static log(message, level = 'INFO') {
        const timestamp = new Date().toISOString();
        console.log(`[${timestamp}] [${level}] ${message}`);
    }
    static info(message) { this.log(message, 'INFO'); }
    static error(message) { this.log(message, 'ERROR'); }
    static warn(message) { this.log(message, 'WARN'); }
    static debug(message) { this.log(message, 'DEBUG'); }
}

// ============================================
// 3. DATE UTILITIES
// ============================================

class DateUtils {
    static parseTimestamp(value) {
        if (!value) return null;
        
        const formats = [
            (v) => new Date(v),
            (v) => new Date(parseInt(v)),
            (v) => {
                const match = v.match(/(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})/);
                if (match) return new Date(v);
                return null;
            },
            (v) => {
                const match = v.match(/(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2}):(\d{2})/);
                if (match) return new Date(match[3], match[2]-1, match[1], match[4], match[5], match[6]);
                return null;
            },
            (v) => {
                const match = v.match(/(\d{4})-(\d{2})-(\d{2})/);
                if (match) return new Date(match[1], match[2]-1, match[3]);
                return null;
            }
        ];

        for (const format of formats) {
            try {
                const result = format(value);
                if (result && !isNaN(result.getTime())) {
                    return result;
                }
            } catch (e) {}
        }
        return null;
    }

    static format(date) {
        if (!date) return 'Data não disponível';
        return date.toLocaleString('pt-BR', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit'
        });
    }
}

// ============================================
// 4. EVENT MODEL
// ============================================

class EventModel {
    constructor(data) {
        this.id = this.generateId();
        this.timestamp = data.timestamp || new Date();
        this.source = data.source || 'unknown';
        this.category = data.category || 'System';
        this.type = data.type || 'unknown';
        this.description = data.description || '';
        this.data = data.data || {};
        this.metadata = data.metadata || {};
        this.confidence = data.confidence || 'medium';
        this.tags = data.tags || [];
        this.relatedEvents = data.relatedEvents || [];
        this.processed = false;
        this.raw = data.raw || null;
    }

    generateId() {
        return 'evt_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    }

    toJSON() {
        return {
            id: this.id,
            timestamp: this.timestamp,
            source: this.source,
            category: this.category,
            type: this.type,
            description: this.description,
            data: this.data,
            metadata: this.metadata,
            confidence: this.confidence,
            tags: this.tags,
            relatedEvents: this.relatedEvents
        };
    }
}

// ============================================
// 5. CACHE MANAGER
// ============================================

class CacheManager {
    constructor(configManager) {
        this.configManager = configManager;
        this.cache = new Map();
        this.maxSize = configManager.get('maxCacheSize') || 100;
    }

    get(key) {
        if (this.cache.has(key)) {
            const item = this.cache.get(key);
            item.accessCount = (item.accessCount || 0) + 1;
            return item.data;
        }
        return null;
    }

    set(key, data) {
        if (this.cache.size >= this.maxSize) {
            this.evict();
        }
        this.cache.set(key, {
            data: data,
            timestamp: Date.now(),
            accessCount: 0
        });
    }

    evict() {
        let oldest = null;
        let minAccess = Infinity;
        for (const [key, item] of this.cache) {
            if (item.accessCount < minAccess) {
                minAccess = item.accessCount;
                oldest = key;
            }
        }
        if (oldest) {
            this.cache.delete(oldest);
            Logger.debug(`Cache evict: ${oldest}`);
        }
    }

    clear() { this.cache.clear(); }
    getSize() { return this.cache.size; }
}

// ============================================
// 6. SCRIPTABLE FILE LOADER
// ============================================

class ScriptableFileLoader {
    constructor(configManager) {
        this.configManager = configManager;
        this.supportedExtensions = configManager.getSupportedExtensions();
        this.maxFileSize = configManager.getMaxFileSize();
        this.cacheManager = new CacheManager(configManager);
        this.selectedFiles = [];
        this.fileInfo = [];
    }

    async selectFiles(allowMultiple = true) {
        try {
            Logger.info('Abrindo seletor de arquivos...');
            
            try {
                if (typeof DocumentPicker !== 'undefined') {
                    try {
                        const result = await DocumentPicker.open();
                        if (result && result.length > 0) {
                            const files = [];
                            for (const file of result) {
                                const loaded = await this.loadFileFromPath(file);
                                if (loaded) files.push(loaded);
                            }
                            if (files.length > 0) {
                                this.selectedFiles = files;
                                return files;
                            }
                        }
                    } catch (e) {
                        Logger.warn(`DocumentPicker falhou: ${e.message}`);
                    }
                }
            } catch (e) {
                Logger.warn(`DocumentPicker não disponível: ${e.message}`);
            }

            return await this.selectFilesFromiCloud(allowMultiple);

        } catch (error) {
            Logger.error(`Erro na seleção de arquivos: ${error.message}`);
            return await this.selectFilesFromiCloud(allowMultiple);
        }
    }

    async selectFilesFromiCloud(allowMultiple = true) {
        try {
            const fm = FileManager.iCloud();
            const docs = fm.documentsDirectory();
            
            const items = fm.listContents(docs);
            
            const supportedItems = items.filter(item => {
                const ext = this.getFileExtension(item);
                return this.supportedExtensions.includes(ext);
            });

            if (supportedItems.length === 0) {
                const alert = new Alert();
                alert.title = 'ℹ️ Nenhum arquivo encontrado';
                alert.message = `Nenhum arquivo suportado encontrado na pasta do Scriptable.\n\nFormatos aceitos:\n${this.supportedExtensions.join(', ')}\n\nColoque os arquivos em:\niCloud Drive → Scriptable`;
                alert.addAction('OK');
                await alert.presentAlert();
                return [];
            }

            const selection = new UITable();
            selection.title = '📂 Selecione o(s) arquivo(s) para análise';
            
            const fileInfos = [];
            for (const item of supportedItems) {
                const path = fm.joinPath(docs, item);
                const ext = this.getFileExtension(item);
                const icon = this.getFileIcon(ext);
                
                let fileSize = 0;
                try {
                    const content = fm.readString(path);
                    fileSize = content ? content.length : 0;
                } catch (e) {
                    try {
                        const data = fm.read(path);
                        fileSize = data ? data.length : 0;
                    } catch (e2) {}
                }
                
                const row = new UITableRow(`${icon} ${item}`);
                row.detailText = `${this.formatFileSize(fileSize)}`;
                row.dismissOnSelect = false;
                
                if (allowMultiple) {
                    row.addCheckbox();
                }
                
                fileInfos.push({ item, path, size: fileSize, row });
                selection.addRow(row);
            }

            if (allowMultiple) {
                selection.addAction('📂 Selecionar Todos', (table) => {
                    for (const row of table.rows) {
                        row.select();
                    }
                });
            }
            
            selection.addAction('📊 Analisar Selecionados', async (table) => {
                const selectedRows = table.selectedRows;
                if (selectedRows.length === 0) {
                    const alert = new Alert();
                    alert.title = '⚠️ Nenhum arquivo selecionado';
                    alert.message = 'Selecione pelo menos um arquivo para analisar.';
                    alert.addAction('OK');
                    await alert.presentAlert();
                    return [];
                }
                
                const files = [];
                for (const row of selectedRows) {
                    const fileInfo = fileInfos[row.index];
                    try {
                        const content = fm.readString(fileInfo.path);
                        if (content) {
                            files.push({
                                name: fileInfo.item,
                                path: fileInfo.path,
                                extension: this.getFileExtension(fileInfo.item),
                                size: content.length,
                                modified: new Date(),
                                content: content,
                                type: this.detectFileType({ name: fileInfo.item })
                            });
                        }
                    } catch (error) {
                        Logger.error(`Erro ao ler ${fileInfo.item}: ${error.message}`);
                    }
                }
                
                return files;
            });
            
            selection.addAction('❌ Cancelar', () => {
                return [];
            });

            const result = await selection.present();
            
            if (Array.isArray(result) && result.length > 0) {
                this.selectedFiles = result;
                return result;
            }
            
            const selectedRows = selection.selectedRows;
            if (selectedRows && selectedRows.length > 0) {
                const files = [];
                for (const row of selectedRows) {
                    const fileInfo = fileInfos[row.index];
                    try {
                        const content = fm.readString(fileInfo.path);
                        if (content) {
                            files.push({
                                name: fileInfo.item,
                                path: fileInfo.path,
                                extension: this.getFileExtension(fileInfo.item),
                                size: content.length,
                                modified: new Date(),
                                content: content,
                                type: this.detectFileType({ name: fileInfo.item })
                            });
                        }
                    } catch (error) {
                        Logger.error(`Erro ao ler ${fileInfo.item}: ${error.message}`);
                    }
                }
                this.selectedFiles = files;
                return files;
            }
            
            return [];

        } catch (error) {
            Logger.error(`Erro na seleção iCloud: ${error.message}`);
            
            const alert = new Alert();
            alert.title = '❌ Erro ao selecionar arquivos';
            alert.message = `${error.message}\n\nDica: Coloque os arquivos na pasta:\niCloud Drive → Scriptable`;
            alert.addAction('OK');
            await alert.presentAlert();
            
            return [];
        }
    }

    async loadFileFromPath(path) {
        try {
            const fm = FileManager.iCloud();
            
            if (typeof path === 'object' && path.path) {
                path = path.path;
            }
            
            const content = fm.readString(path);
            if (!content) {
                throw new Error(`Arquivo vazio ou não encontrado: ${path}`);
            }
            
            const file = {
                name: this.getFileName(path),
                path: path,
                extension: this.getFileExtension(path),
                size: content.length,
                modified: new Date(),
                content: content,
                type: this.detectFileType({ name: path })
            };
            
            const validation = this.validateFile(file);
            if (!validation.valid) {
                throw new Error(validation.error);
            }
            
            return file;
            
        } catch (error) {
            Logger.error(`Erro ao carregar arquivo: ${error.message}`);
            return null;
        }
    }

    async loadFile(file) {
        try {
            const fm = FileManager.iCloud();
            let loadedFile = null;

            if (typeof file === 'string') {
                const path = file;
                const content = fm.readString(path);
                if (!content) {
                    throw new Error(`Arquivo vazio ou não encontrado: ${path}`);
                }
                
                loadedFile = {
                    name: this.getFileName(path),
                    path: path,
                    extension: this.getFileExtension(path),
                    size: content.length,
                    modified: new Date(),
                    content: content,
                    type: this.detectFileType({ name: path })
                };
            } else if (file.content) {
                loadedFile = {
                    name: file.name || 'arquivo',
                    path: file.path || '',
                    extension: this.getFileExtension(file.name || ''),
                    size: file.content.length,
                    modified: file.modified || new Date(),
                    content: file.content,
                    type: this.detectFileType({ name: file.name || 'arquivo' })
                };
            } else {
                throw new Error('Formato de arquivo não suportado');
            }

            const validation = this.validateFile(loadedFile);
            if (!validation.valid) {
                throw new Error(validation.error);
            }

            if (this.configManager.get('cacheEnabled')) {
                this.cacheManager.set(loadedFile.path || loadedFile.name, loadedFile);
            }

            Logger.info(`Arquivo carregado: ${loadedFile.name} (${this.formatFileSize(loadedFile.size)})`);
            
            return loadedFile;

        } catch (error) {
            Logger.error(`Erro ao carregar arquivo: ${error.message}`);
            throw error;
        }
    }

    validateFile(file) {
        if (!file) return { valid: false, error: 'Arquivo inválido' };
        if (!file.name && !file.path) return { valid: false, error: 'Nome do arquivo não especificado' };

        const ext = this.getFileExtension(file.name || file.path || '');
        if (!this.supportedExtensions.includes(ext)) {
            return { 
                valid: false, 
                error: `Formato não suportado: ${ext || 'desconhecido'}\n\nFormatos aceitos:\n${this.supportedExtensions.join(', ')}`
            };
        }

        const size = file.size || 0;
        if (size > this.maxFileSize) {
            return { 
                valid: false, 
                error: `Arquivo muito grande: ${this.formatFileSize(size)}\n\nMáximo permitido: ${this.formatFileSize(this.maxFileSize)}`
            };
        }

        if (size === 0) return { valid: false, error: 'Arquivo vazio (0 bytes)' };

        return { valid: true };
    }

    detectFileType(file) {
        const ext = file.extension || this.getFileExtension(file.name || '');
        const typeMap = {
            '.plist': 'Property List',
            '.json': 'JSON',
            '.ndjson': 'NDJSON',
            '.ndj': 'NDJSON',
            '.jsonl': 'NDJSON',
            '.log': 'Log',
            '.txt': 'Texto',
            '.csv': 'CSV',
            '.xml': 'XML',
            '.ips': 'Crash Report',
            '.tracev3': 'Trace Log'
        };
        return typeMap[ext] || 'Desconhecido';
    }

    getFileExtension(filename) {
        if (!filename) return '';
        const lastDot = filename.lastIndexOf('.');
        return lastDot > 0 ? filename.substring(lastDot).toLowerCase() : '';
    }

    getFileName(path) {
        if (!path) return '';
        const parts = path.split('/');
        return parts[parts.length - 1];
    }

    formatFileSize(bytes) {
        if (bytes < 1024) return bytes + ' B';
        if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
        if (bytes < 1024 * 1024 * 1024) return (bytes / 1024 / 1024).toFixed(1) + ' MB';
        return (bytes / 1024 / 1024 / 1024).toFixed(1) + ' GB';
    }

    getFileIcon(extension) {
        const iconMap = {
            '.plist': '📋', '.json': '📊', '.ndjson': '📊', '.ndj': '📊', '.jsonl': '📊',
            '.log': '📝', '.txt': '📄', '.csv': '📈', '.xml': '📋',
            '.ips': '💥', '.tracev3': '🔍'
        };
        return iconMap[extension] || '📁';
    }

    getSelectedFiles() { return this.selectedFiles; }
    clearCache() { this.cacheManager.clear(); this.selectedFiles = []; }
}

// ============================================
// 7. MDM SETTINGS ANALYZER
// ============================================

class MDMSettingsAnalyzer {
    constructor() {
        this.patterns = {
            ipv4: /\b(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\b/g,
            ipv6: /(([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:)|fe80:(:[0-9a-fA-F]{0,4}){0,4}%[0-9a-zA-Z]{1,}|::(ffff(:0{1,4}){0,1}:){0,1}((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])|([0-9a-fA-F]{1,4}:){1,4}:((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9]))/g,
            domain: /\b([a-zA-Z0-9-]+\.)+[a-zA-Z]{2,}\b/g,
            url: /https?:\/\/[^\s"'<>]+/g,
            
            vpn: ['vpn', 'tunnel', 'wireguard', 'openvpn', 'ikev2', 'l2tp', 'pptp', 'ipsec', 'packettunnel', 'networkextension'],
            proxy: ['proxy', 'mitm', 'charles', 'burp', 'fiddler', 'proxyman', 'http catcher', 'surge', 'quantumult', 'shadowrocket'],
            dns: ['dns', 'nameserver', 'resolv', '8.8.8.8', '1.1.1.1', '9.9.9.9'],
            
            suspicious: [
                '3utools', 'altstore', 'trollstore', 'sidestore', 'scarlet', 'esign',
                'cydia', 'sileo', 'zebra', 'procursus', 'ellekit', 
                'frida', 'substrate', 'substitute', 'cycript',
                'adguard', 'surge', 'quantumult', 'shadowrocket', 'potatso', 'loon'
            ],
            
            mdmConfig: ['server', 'host', 'url', 'endpoint', 'certificate', 'cert', 'pem', 'crt', 'ca', 'identity', 'deviceid', 'udid', 'serial']
        };
        
        // Domínios comuns para ignorar
        this.commonDomains = [
            'apple.com', 'icloud.com', 'icloud.com.br', 'icloud',
            'google.com', 'googleapis.com', 'gstatic.com', 'google',
            'facebook.com', 'twitter.com', 'instagram.com',
            'localhost', 'example.com', 'test.com',
            'apple-dns.net', 'apple.co', 'apple.com.cn',
            'gmail.com', 'youtube.com', 'yahoo.com', 'bing.com',
            'amazon.com', 'netflix.com', 'spotify.com'
        ];
    }

    analyzePlist(obj, path = 'root', results = null) {
        if (results === null) {
            results = {
                evidences: [],
                network: { ips: [], domains: [], urls: [], vpnIndicators: [], proxyIndicators: [], dnsIndicators: [] },
                suspicious: [],
                mdmConfig: [],
                systemInfo: { apps: [], identifiers: [], certificates: [] }
            };
        }

        if (obj === null || obj === undefined) return results;

        if (typeof obj === 'string') {
            this.analyzeString(obj, path, results);
            return results;
        }

        if (Array.isArray(obj)) {
            for (let i = 0; i < obj.length; i++) {
                this.analyzePlist(obj[i], `${path}[${i}]`, results);
            }
            return results;
        }

        if (typeof obj === 'object') {
            for (const [key, value] of Object.entries(obj)) {
                this.analyzeKey(key, value, path, results);
                this.analyzePlist(value, `${path}.${key}`, results);
            }
        }

        return results;
    }

    analyzeString(str, path, results) {
        const lowerStr = str.toLowerCase();

        // IPv4
        const ipv4Matches = str.match(this.patterns.ipv4);
        if (ipv4Matches) {
            for (const ip of ipv4Matches) {
                if (!this.isPrivateIP(ip) && !this.isReservedIP(ip)) {
                    results.network.ips.push({
                        ip: ip,
                        path: path,
                        type: 'IPv4',
                        confidence: 'high',
                        raw: str.substring(0, 100)
                    });
                }
            }
        }

        // IPv6
        const ipv6Matches = str.match(this.patterns.ipv6);
        if (ipv6Matches) {
            for (const ip of ipv6Matches) {
                if (!this.isPrivateIP(ip)) {
                    results.network.ips.push({
                        ip: ip,
                        path: path,
                        type: 'IPv6',
                        confidence: 'high',
                        raw: str.substring(0, 100)
                    });
                }
            }
        }

        // Domínios
        const domainMatches = str.match(this.patterns.domain);
        if (domainMatches) {
            for (const domain of domainMatches) {
                if (!this.isCommonDomain(domain) && domain.length > 3) {
                    results.network.domains.push({
                        domain: domain,
                        path: path,
                        confidence: 'medium',
                        raw: str.substring(0, 100)
                    });
                }
            }
        }

        // URLs
        const urlMatches = str.match(this.patterns.url);
        if (urlMatches) {
            for (const url of urlMatches) {
                results.network.urls.push({
                    url: url,
                    path: path,
                    confidence: 'high',
                    raw: str.substring(0, 100)
                });
            }
        }

        // VPN Indicators
        for (const vpn of this.patterns.vpn) {
            if (lowerStr.includes(vpn)) {
                results.network.vpnIndicators.push({
                    indicator: vpn,
                    path: path,
                    confidence: 'high',
                    raw: str.substring(0, 100)
                });
            }
        }

        // Proxy Indicators
        for (const proxy of this.patterns.proxy) {
            if (lowerStr.includes(proxy)) {
                results.network.proxyIndicators.push({
                    indicator: proxy,
                    path: path,
                    confidence: 'high',
                    raw: str.substring(0, 100)
                });
            }
        }

        // DNS Indicators
        for (const dns of this.patterns.dns) {
            if (lowerStr.includes(dns)) {
                results.network.dnsIndicators.push({
                    indicator: dns,
                    path: path,
                    confidence: 'medium',
                    raw: str.substring(0, 100)
                });
            }
        }

        // Suspicious Tools
        for (const tool of this.patterns.suspicious) {
            if (lowerStr.includes(tool)) {
                results.suspicious.push({
                    tool: tool,
                    path: path,
                    confidence: 'critical',
                    raw: str.substring(0, 100)
                });
            }
        }
    }

    analyzeKey(key, value, path, results) {
        const lowerKey = key.toLowerCase();

        // Detects app bundle IDs
        if (lowerKey.includes('com.') || lowerKey.includes('org.') || lowerKey.includes('net.')) {
            if (key.length > 5 && key.length < 50) {
                results.systemInfo.apps.push({
                    bundleId: key,
                    path: path,
                    value: value,
                    confidence: 'medium'
                });
            }
        }

        // Detects identifiers
        if (lowerKey.includes('udid') || lowerKey.includes('serial') || 
            lowerKey.includes('deviceid') || lowerKey.includes('identifier') ||
            lowerKey.includes('uuid')) {
            results.systemInfo.identifiers.push({
                key: key,
                value: value,
                path: path,
                confidence: 'medium'
            });
        }

        // Detects certificate-related keys
        if (lowerKey.includes('cert') || lowerKey.includes('trust') || 
            lowerKey.includes('pem') || lowerKey.includes('crt') || lowerKey.includes('ca')) {
            results.systemInfo.certificates.push({
                key: key,
                value: typeof value === 'string' ? value.substring(0, 50) : value,
                path: path,
                confidence: 'medium'
            });
        }

        // Detects server/endpoint configurations
        for (const config of this.patterns.mdmConfig) {
            if (lowerKey.includes(config)) {
                results.mdmConfig.push({
                    key: key,
                    value: typeof value === 'string' ? value.substring(0, 100) : value,
                    path: path,
                    type: config,
                    confidence: 'medium'
                });
            }
        }

        // Detects suspicious keys
        for (const tool of this.patterns.suspicious) {
            if (lowerKey.includes(tool)) {
                results.suspicious.push({
                    tool: tool,
                    path: path,
                    confidence: 'critical',
                    raw: `${key}: ${typeof value === 'string' ? value.substring(0, 50) : '...'}`
                });
            }
        }
    }

    isPrivateIP(ip) {
        if (!ip) return false;
        const parts = ip.split('.').map(Number);
        if (parts.length === 4 && !parts.some(isNaN)) {
            if (parts[0] === 10) return true;
            if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
            if (parts[0] === 192 && parts[1] === 168) return true;
            if (parts[0] === 127) return true;
        }
        return false;
    }

    isReservedIP(ip) {
        if (!ip) return false;
        const parts = ip.split('.').map(Number);
        if (parts.length === 4 && !parts.some(isNaN)) {
            if (parts[0] === 0) return true;
            if (parts[0] === 224 && parts[1] >= 0 && parts[1] <= 239) return true;
            if (parts[0] === 240 && parts[1] >= 0 && parts[1] <= 255) return true;
            if (parts[0] === 255 && parts[1] === 255 && parts[2] === 255 && parts[3] === 255) return true;
        }
        return false;
    }

    isCommonDomain(domain) {
        if (!domain) return true;
        const d = domain.toLowerCase();
        for (const common of this.commonDomains) {
            if (d.includes(common) || common.includes(d)) return true;
        }
        if (d.endsWith('.local')) return true;
        if (d.match(/^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$/)) return true;
        return false;
    }

    generateReport(results) {
        const report = {
            summary: {
                totalEvidences: 0,
                ipsFound: results.network?.ips?.length || 0,
                domainsFound: results.network?.domains?.length || 0,
                urlsFound: results.network?.urls?.length || 0,
                suspiciousTools: results.suspicious?.length || 0,
                vpnIndicators: results.network?.vpnIndicators?.length || 0,
                proxyIndicators: results.network?.proxyIndicators?.length || 0,
                dnsIndicators: results.network?.dnsIndicators?.length || 0,
                appsFound: results.systemInfo?.apps?.length || 0,
                identifiersFound: results.systemInfo?.identifiers?.length || 0,
                certificatesFound: results.systemInfo?.certificates?.length || 0
            },
            network: {
                ips: results.network?.ips || [],
                domains: results.network?.domains || [],
                urls: results.network?.urls || [],
                vpnIndicators: results.network?.vpnIndicators || [],
                proxyIndicators: results.network?.proxyIndicators || [],
                dnsIndicators: results.network?.dnsIndicators || []
            },
            suspicious: results.suspicious || [],
            mdmConfig: results.mdmConfig || [],
            systemInfo: {
                apps: results.systemInfo?.apps || [],
                identifiers: results.systemInfo?.identifiers || [],
                certificates: results.systemInfo?.certificates || []
            },
            evidences: results.evidences || []
        };
        
        report.summary.totalEvidences = 
            report.network.ips.length +
            report.network.domains.length +
            report.network.urls.length +
            report.suspicious.length +
            report.network.vpnIndicators.length +
            report.network.proxyIndicators.length +
            report.network.dnsIndicators.length;
        
        return report;
    }
}

// ============================================
// 8. MDM PLIST DETECTOR
// ============================================

class MDMPlistsDetector extends BaseDetector {
    constructor() {
        super('MDM Plist Detector');
        this.analyzer = new MDMSettingsAnalyzer();
    }

    detect(events) {
        const results = [];
        
        for (const event of events) {
            const sourceLower = (event.source || '').toLowerCase();
            
            // Verifica se é um plist relacionado a MDM ou configurações
            if (sourceLower.includes('mcsettings') || 
                sourceLower.includes('settings') ||
                sourceLower.includes('configuration') ||
                sourceLower.includes('profile') ||
                (event.category === 'System' && event.type === 'plist')) {
                
                // Analisa os dados do evento
                const analysis = this.analyzer.analyzePlist(event.data);
                
                // Ferramentas suspeitas
                if (analysis.suspicious && analysis.suspicious.length > 0) {
                    for (const susp of analysis.suspicious) {
                        results.push(this.createResult(
                            'Suspicious MDM Tool',
                            {
                                source: event.source,
                                timestamp: event.timestamp,
                                tool: susp.tool,
                                path: susp.path,
                                raw: susp.raw
                            },
                            susp.confidence || 'critical'
                        ));
                    }
                }

                // IPs
                if (analysis.network && analysis.network.ips && analysis.network.ips.length > 0) {
                    for (const ip of analysis.network.ips) {
                        results.push(this.createResult(
                            'Network IP Found',
                            {
                                source: event.source,
                                timestamp: event.timestamp,
                                ip: ip.ip,
                                type: ip.type,
                                path: ip.path,
                                raw: ip.raw
                            },
                            ip.confidence || 'high'
                        ));
                    }
                }

                // Domínios
                if (analysis.network && analysis.network.domains && analysis.network.domains.length > 0) {
                    for (const domain of analysis.network.domains) {
                        results.push(this.createResult(
                            'Domain Found',
                            {
                                source: event.source,
                                timestamp: event.timestamp,
                                domain: domain.domain,
                                path: domain.path,
                                raw: domain.raw
                            },
                            domain.confidence || 'medium'
                        ));
                    }
                }

                // URLs
                if (analysis.network && analysis.network.urls && analysis.network.urls.length > 0) {
                    for (const url of analysis.network.urls) {
                        results.push(this.createResult(
                            'URL Found',
                            {
                                source: event.source,
                                timestamp: event.timestamp,
                                url: url.url,
                                path: url.path,
                                raw: url.raw
                            },
                            url.confidence || 'high'
                        ));
                    }
                }

                // VPN Indicators
                if (analysis.network && analysis.network.vpnIndicators && analysis.network.vpnIndicators.length > 0) {
                    for (const vpn of analysis.network.vpnIndicators) {
                        results.push(this.createResult(
                            'VPN Indicator',
                            {
                                source: event.source,
                                timestamp: event.timestamp,
                                indicator: vpn.indicator,
                                path: vpn.path,
                                raw: vpn.raw
                            },
                            vpn.confidence || 'high'
                        ));
                    }
                }

                // Proxy Indicators
                if (analysis.network && analysis.network.proxyIndicators && analysis.network.proxyIndicators.length > 0) {
                    for (const proxy of analysis.network.proxyIndicators) {
                        results.push(this.createResult(
                            'Proxy Indicator',
                            {
                                source: event.source,
                                timestamp: event.timestamp,
                                indicator: proxy.indicator,
                                path: proxy.path,
                                raw: proxy.raw
                            },
                            proxy.confidence || 'high'
                        ));
                    }
                }

                // DNS Indicators
                if (analysis.network && analysis.network.dnsIndicators && analysis.network.dnsIndicators.length > 0) {
                    for (const dns of analysis.network.dnsIndicators) {
                        results.push(this.createResult(
                            'DNS Indicator',
                            {
                                source: event.source,
                                timestamp: event.timestamp,
                                indicator: dns.indicator,
                                path: dns.path,
                                raw: dns.raw
                            },
                            dns.confidence || 'medium'
                        ));
                    }
                }

                // Certificates
                if (analysis.systemInfo && analysis.systemInfo.certificates && analysis.systemInfo.certificates.length > 0) {
                    for (const cert of analysis.systemInfo.certificates) {
                        results.push(this.createResult(
                            'Certificate Found',
                            {
                                source: event.source,
                                timestamp: event.timestamp,
                                key: cert.key,
                                value: cert.value,
                                path: cert.path
                            },
                            cert.confidence || 'medium'
                        ));
                    }
                }
            }
        }

        return results;
    }
}

// ============================================
// 9. ADVANCED PARSER
// ============================================

class AdvancedParser {
    constructor() {
        this.parsers = {
            json: this.parseJSON.bind(this),
            ndjson: this.parseNDJSON.bind(this),
            ndj: this.parseNDJSON.bind(this),
            jsonl: this.parseNDJSON.bind(this),
            plist: this.parsePlist.bind(this),
            log: this.parseLog.bind(this),
            txt: this.parseText.bind(this),
            xml: this.parseXML.bind(this),
            csv: this.parseCSV.bind(this),
            ips: this.parseIPS.bind(this)
        };
    }

    async parse(file) {
        const ext = file.extension.replace('.', '');
        const parser = this.parsers[ext];
        if (!parser) {
            Logger.warn(`Parser não encontrado para: ${file.extension}`);
            return this.parseText(file);
        }

        try {
            return await parser(file);
        } catch (error) {
            Logger.error(`Erro no parser ${file.extension}: ${error.message}`);
            return [];
        }
    }

    parseJSON(file) {
        const events = [];
        try {
            const data = JSON.parse(file.content);
            this.extractEventsFromJSON(data, file, events);
        } catch (error) {
            Logger.error(`Erro ao parsear JSON: ${error.message}`);
        }
        return events;
    }

    parseNDJSON(file) {
        const events = [];
        const lines = file.content.split('\n').filter(line => line.trim());
        
        Logger.info(`Analisando NDJSON com ${lines.length} linhas`);
        
        for (let i = 0; i < lines.length; i++) {
            try {
                const data = JSON.parse(lines[i]);
                const eventData = this.extractEventData(data);
                if (eventData) {
                    events.push(new EventModel({
                        timestamp: eventData.timestamp,
                        source: file.name,
                        category: this.detectCategory(data),
                        type: eventData.type || 'ndjson_event',
                        description: eventData.description || this.generateDescription(data),
                        data: data,
                        metadata: { line: i + 1, confidence: eventData.confidence || 'medium' },
                        raw: lines[i]
                    }));
                } else {
                    events.push(new EventModel({
                        timestamp: new Date(),
                        source: file.name,
                        category: 'NDJSON',
                        type: 'line',
                        description: `Linha ${i + 1} do NDJSON`,
                        data: data,
                        metadata: { line: i + 1 },
                        raw: lines[i]
                    }));
                }
            } catch (error) {
                Logger.warn(`Erro ao parsear linha ${i + 1}: ${error.message}`);
                events.push(new EventModel({
                    timestamp: new Date(),
                    source: file.name,
                    category: 'NDJSON',
                    type: 'error',
                    description: `Erro na linha ${i + 1}: ${error.message}`,
                    data: { raw: lines[i] },
                    metadata: { line: i + 1, error: true },
                    raw: lines[i]
                }));
            }
        }
        return events;
    }

    parsePlist(file) {
        const events = [];
        try {
            const content = file.content;
            
            // Tenta parsear XML plist
            if (content.includes('<?xml') && content.includes('plist')) {
                const matches = content.match(/<key>(.*?)<\/key>\s*<([a-z]+)>(.*?)<\/\2>/gs);
                if (matches) {
                    const data = {};
                    for (const match of matches) {
                        const keyMatch = match.match(/<key>(.*?)<\/key>/);
                        const valueMatch = match.match(/<([a-z]+)>(.*?)<\/\1>/);
                        if (keyMatch && valueMatch) {
                            const key = keyMatch[1];
                            const value = this.parsePlistValue(valueMatch[2], valueMatch[1]);
                            data[key] = value;
                        }
                    }
                    if (Object.keys(data).length > 0) {
                        this.extractEventsFromJSON(data, file, events);
                    }
                }
            } else {
                // Tenta parsear como binary plist (fallback)
                events.push(new EventModel({
                    timestamp: new Date(),
                    source: file.name,
                    category: 'System',
                    type: 'plist_binary',
                    description: 'Arquivo plist binário detectado',
                    data: { raw: content.substring(0, 1000) },
                    metadata: { confidence: 'low' },
                    raw: content.substring(0, 500)
                }));
            }
        } catch (error) {
            Logger.error(`Erro ao parsear plist: ${error.message}`);
        }
        return events;
    }

    parsePlistValue(value, type) {
        switch (type) {
            case 'integer': return parseInt(value);
            case 'real': return parseFloat(value);
            case 'true': return true;
            case 'false': return false;
            case 'date': return new Date(value);
            default: return value;
        }
    }

    parseIPS(file) {
        const events = [];
        const content = file.content;
        
        Logger.info(`Analisando IPS Crash Report`);
        
        // Cabeçalho
        const headerMatch = content.match(/(?:^|\n)([^\n]+?)(?:\n|$)/);
        if (headerMatch) {
            events.push(new EventModel({
                timestamp: new Date(),
                source: file.name,
                category: 'Crash',
                type: 'crash_header',
                description: `Crash Report: ${headerMatch[1]}`,
                data: { header: headerMatch[1] },
                metadata: { confidence: 'high' },
                raw: headerMatch[0]
            }));
        }

        // Data
        const dateMatch = content.match(/Date\/Time:\s*([^\n]+)/i);
        if (dateMatch) {
            const date = DateUtils.parseTimestamp(dateMatch[1]);
            if (date) {
                events.push(new EventModel({
                    timestamp: date,
                    source: file.name,
                    category: 'Crash',
                    type: 'crash_date',
                    description: `Data do crash: ${dateMatch[1]}`,
                    data: { date: dateMatch[1] },
                    metadata: { confidence: 'high' },
                    raw: dateMatch[0]
                }));
            }
        }

        // Aplicativo
        const appMatch = content.match(/Application Name:\s*([^\n]+)/i) || content.match(/Process:\s*([^\n]+)/i);
        if (appMatch) {
            events.push(new EventModel({
                timestamp: new Date(),
                source: file.name,
                category: 'Crash',
                type: 'crash_app',
                description: `Aplicativo: ${appMatch[1]}`,
                data: { app: appMatch[1] },
                metadata: { confidence: 'high' },
                raw: appMatch[0]
            }));
        }

        // Exceção
        const exceptionMatch = content.match(/Exception Type:\s*([^\n]+)/i) || content.match(/Exception:\s*([^\n]+)/i);
        if (exceptionMatch) {
            events.push(new EventModel({
                timestamp: new Date(),
                source: file.name,
                category: 'Crash',
                type: 'crash_exception',
                description: `Exceção: ${exceptionMatch[1]}`,
                data: { exception: exceptionMatch[1] },
                metadata: { confidence: 'high' },
                raw: exceptionMatch[0]
            }));
        }

        // Stack Trace
        const stackMatch = content.match(/Thread [0-9]+[^\n]+\n([^]*?)(?:\n{2,}|$)/i);
        if (stackMatch) {
            const stackLines = stackMatch[1].split('\n').filter(line => line.trim());
            if (stackLines.length > 0) {
                events.push(new EventModel({
                    timestamp: new Date(),
                    source: file.name,
                    category: 'Crash',
                    type: 'crash_stack',
                    description: `Stack Trace (${stackLines.length} linhas)`,
                    data: { stack: stackLines.slice(0, 20) },
                    metadata: { confidence: 'high', stackLines: stackLines.length },
                    raw: stackMatch[0]
                }));
            }
        }

        // Indicadores de jailbreak
        if (content.toLowerCase().includes('jailbreak') || 
            content.toLowerCase().includes('cydia') || 
            content.toLowerCase().includes('substrate')) {
            events.push(new EventModel({
                timestamp: new Date(),
                source: file.name,
                category: 'Jailbreak',
                type: 'crash_jailbreak_indicator',
                description: 'Indicador de jailbreak no crash report',
                data: { indicator: 'Jailbreak detection in crash' },
                metadata: { confidence: 'high' },
                raw: 'Jailbreak indicator found in crash report'
            }));
        }

        // Indicadores de tweaks
        if (content.toLowerCase().includes('tweak') || 
            content.toLowerCase().includes('inject') || 
            content.toLowerCase().includes('hook') ||
            content.toLowerCase().includes('frida')) {
            events.push(new EventModel({
                timestamp: new Date(),
                source: file.name,
                category: 'Hook',
                type: 'crash_tweak_indicator',
                description: 'Indicador de tweak/hook no crash report',
                data: { indicator: 'Tweak/hook detection in crash' },
                metadata: { confidence: 'high' },
                raw: 'Tweak/hook indicator found in crash report'
            }));
        }

        // Evidências de proxy no crash
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            if (!line.trim()) continue;
            const lowerLine = line.toLowerCase();
            if (lowerLine.includes('proxy') || lowerLine.includes('mitm') || 
                lowerLine.includes('charles') || lowerLine.includes('burp')) {
                events.push(new EventModel({
                    timestamp: new Date(),
                    source: file.name,
                    category: 'Proxy',
                    type: 'proxy_evidence',
                    description: `Evidência de proxy no crash: ${line.substring(0, 100)}`,
                    data: { line: line },
                    metadata: { confidence: 'medium', line_number: i + 1 },
                    raw: line
                }));
            }
        }

        return events;
    }

    parseLog(file) {
        const events = [];
        const lines = file.content.split('\n');
        for (const line of lines) {
            if (!line.trim()) continue;
            const parsed = this.parseLogLine(line);
            if (parsed) {
                events.push(new EventModel({
                    timestamp: parsed.timestamp || new Date(),
                    source: file.name,
                    category: parsed.category || 'Log',
                    type: parsed.type || 'log',
                    description: parsed.description || line,
                    data: { raw: line },
                    metadata: parsed.metadata || {},
                    raw: line
                }));
            }
        }
        return events;
    }

    parseLogLine(line) {
        const result = {};
        const patterns = [
            /(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}(?:\.\d+)?)/,
            /(\d{2}\/\d{2}\/\d{4}\s+\d{2}:\d{2}:\d{2})/,
            /(\d{2}:\d{2}:\d{2}\s+\d{2}\/\d{2}\/\d{4})/,
            /(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z?)/
        ];
        for (const pattern of patterns) {
            const match = line.match(pattern);
            if (match) {
                const date = DateUtils.parseTimestamp(match[1]);
                if (date) { result.timestamp = date; break; }
            }
        }
        const lower = line.toLowerCase();
        if (lower.includes('error') || lower.includes('exception') || lower.includes('fail')) {
            result.category = 'Error'; result.type = 'error';
        } else if (lower.includes('warning') || lower.includes('warn')) {
            result.category = 'Warning'; result.type = 'warning';
        } else if (lower.includes('info') || lower.includes('information')) {
            result.category = 'Info'; result.type = 'info';
        }
        const levelMatch = line.match(/\[(DEBUG|INFO|WARN|ERROR|FATAL)\]/i);
        if (levelMatch) { result.metadata = { level: levelMatch[1].toUpperCase() }; }
        const desc = line.substring(0, 200);
        if (desc) { result.description = desc; }
        return Object.keys(result).length > 0 ? result : null;
    }

    parseText(file) { return this.parseLog(file); }
    parseXML(file) { return this.parseText(file); }

    parseCSV(file) {
        const events = [];
        const lines = file.content.split('\n');
        if (lines.length < 2) return events;
        const headers = lines[0].split(',').map(h => h.trim());
        for (let i = 1; i < lines.length; i++) {
            const values = lines[i].split(',').map(v => v.trim());
            if (values.length === headers.length) {
                const data = {};
                for (let j = 0; j < headers.length; j++) {
                    data[headers[j]] = values[j];
                }
                const eventData = this.extractEventData(data);
                if (eventData) {
                    events.push(new EventModel({
                        timestamp: eventData.timestamp || new Date(),
                        source: file.name,
                        category: 'CSV',
                        type: eventData.type || 'row',
                        description: eventData.description || `Linha ${i}`,
                        data: data,
                        metadata: { row: i },
                        raw: lines[i]
                    }));
                }
            }
        }
        return events;
    }

    extractEventsFromJSON(obj, file, events, path = 'root') {
        if (typeof obj !== 'object' || obj === null) return;

        if (Array.isArray(obj)) {
            for (let i = 0; i < obj.length; i++) {
                this.extractEventsFromJSON(obj[i], file, events, `${path}[${i}]`);
            }
            return;
        }

        const eventData = this.extractEventData(obj);
        if (eventData) {
            events.push(new EventModel({
                timestamp: eventData.timestamp,
                source: file.name,
                category: this.detectCategory(obj),
                type: eventData.type || 'event',
                description: eventData.description || this.generateDescription(obj),
                data: obj,
                metadata: { path: path, confidence: eventData.confidence || 'medium' },
                raw: JSON.stringify(obj)
            }));
        }

        for (const [key, value] of Object.entries(obj)) {
            if (typeof value === 'object' && value !== null) {
                this.extractEventsFromJSON(value, file, events, `${path}.${key}`);
            }
        }
    }

    extractEventData(obj) {
        const result = {};
        for (const key of ['timestamp', 'date', 'time', 'created', 'modified', 'eventTime', 'event_date', 'occurred']) {
            if (obj[key]) {
                const date = DateUtils.parseTimestamp(obj[key]);
                if (date) { result.timestamp = date; break; }
            }
        }
        for (const key of ['type', 'event', 'action', 'operation', 'event_type', 'category']) {
            if (obj[key]) { result.type = String(obj[key]); break; }
        }
        for (const key of ['description', 'message', 'title', 'text', 'content', 'detail', 'event_description']) {
            if (obj[key]) { result.description = String(obj[key]); break; }
        }
        if (obj.confidence) { result.confidence = obj.confidence; }
        return (result.timestamp || result.description) ? result : null;
    }

    detectCategory(obj) {
        const str = JSON.stringify(obj).toLowerCase();
        if (str.includes('vpn') || str.includes('wireguard') || str.includes('openvpn')) return 'VPN';
        if (str.includes('proxy') || str.includes('mitm') || str.includes('charles') || str.includes('burp')) return 'Proxy';
        if (str.includes('cydia') || str.includes('jailbreak') || str.includes('sileo') || str.includes('zebra')) return 'Jailbreak';
        if (str.includes('freefire') || str.includes('garena') || str.includes('ff')) return 'FreeFire';
        if (str.includes('appstore') || str.includes('app store') || str.includes('itunes')) return 'AppStore';
        if (str.includes('certificate') || str.includes('trust') || str.includes('ssl')) return 'Certificate';
        if (str.includes('developer') || str.includes('xcode')) return 'Development';
        if (str.includes('crash') || str.includes('exception') || str.includes('panic')) return 'Crash';
        if (str.includes('frida') || str.includes('hook') || str.includes('inject') || str.includes('cycript')) return 'Hook';
        if (str.includes('altstore') || str.includes('trollstore') || str.includes('sideload')) return 'Sideload';
        if (str.includes('network') || str.includes('dns') || str.includes('http')) return 'Network';
        if (str.includes('analytics') || str.includes('diagnostic') || str.includes('sysdiagnose')) return 'Analytics';
        if (str.includes('mdm') || str.includes('mcsettings') || str.includes('configuration')) return 'MDM';
        return 'System';
    }

    generateDescription(obj) {
        if (obj.message) return typeof obj.message === 'string' ? obj.message : String(obj.message);
        if (obj.description) return typeof obj.description === 'string' ? obj.description : String(obj.description);
        if (obj.title) return typeof obj.title === 'string' ? obj.title : String(obj.title);
        if (obj.name) return typeof obj.name === 'string' ? obj.name : String(obj.name);
        if (obj.event) return typeof obj.event === 'string' ? obj.event : String(obj.event);
        
        const keys = Object.keys(obj);
        for (const key of keys) {
            const value = obj[key];
            if (typeof value === 'string' && value.length > 0 && value.length < 100) {
                return value;
            }
        }
        return JSON.stringify(obj).substring(0, 100);
    }
}

// ============================================
// 10. BASE DETECTOR
// ============================================

class BaseDetector {
    constructor(name) {
        this.name = name;
        this.confidence = 'medium';
    }

    detect(events) { return []; }

    createResult(type, evidence, confidence = 'medium') {
        return {
            detector: this.name,
            type: type,
            evidence: evidence,
            confidence: confidence,
            timestamp: new Date(),
            explanation: this.explain(type, evidence)
        };
    }

    explain(type, evidence) {
        return `Evidência de ${type} encontrada em ${evidence.source || 'arquivo'}`;
    }
}

// ============================================
// 11. DETECTOR MANAGER
// ============================================

class DetectorManager {
    constructor() {
        this.detectors = [];
    }

    register(detector) {
        if (!(detector instanceof BaseDetector)) {
            Logger.warn('Detector inválido, deve herdar de BaseDetector');
            return;
        }
        this.detectors.push(detector);
        Logger.info(`Detector registrado: ${detector.name}`);
    }

    analyze(events) {
        const results = [];
        for (const detector of this.detectors) {
            try {
                const detections = detector.detect(events);
                if (detections.length > 0) {
                    results.push(...detections);
                }
            } catch (error) {
                Logger.error(`Erro no detector ${detector.name}: ${error.message}`);
            }
        }
        return results;
    }

    getDetectorCount() { return this.detectors.length; }
}

// ============================================
// 12. ADVANCED DETECTORS
// ============================================

class AdvancedProxyDetector extends BaseDetector {
    constructor() {
        super('Advanced Proxy Detector');
        this.patterns = {
            apps: ['mitmproxy', 'charles', 'burp', 'fiddler', 'proxyman', 'http catcher', 'surge', 'quantumult', 'shadowrocket', 'potatso', 'loon'],
            configFiles: ['proxy.pac', 'proxy.conf', 'proxy.config', 'mitmproxy', 'charles.log', 'burp.log', 'proxyman.log', 'surge.conf', 'quantumult.conf', 'shadowrocket.conf'],
            bundleIds: ['com.charles.proxy', 'com.burp', 'com.proxyman', 'com.surge', 'com.quantumult', 'com.shadowrocket'],
            networkPatterns: ['proxy', 'mitm', 'intercept', 'ssl interception', 'certificate pinning', 'ssl proxy', 'http proxy', 'socks proxy', 'proxy settings', 'proxy configuration'],
            ports: ['8080', '8888', '8090', '3128', '8081', '8889', '8082', '8083'],
            certPatterns: ['mitm certificate', 'portswigger ca', 'charles ca', 'burp ca', 'proxyman ca', 'self-signed certificate', 'proxy certificate', 'intercepting certificate']
        };
    }

    detect(events) {
        const results = [];
        let proxyIndicators = [];

        for (const event of events) {
            const str = JSON.stringify(event).toLowerCase();
            let found = false;
            let details = [];

            for (const app of this.patterns.apps) {
                if (str.includes(app.toLowerCase())) {
                    details.push(`Aplicativo de proxy: ${app}`);
                    found = true;
                    proxyIndicators.push({ type: 'app', value: app, event: event });
                }
            }

            for (const config of this.patterns.configFiles) {
                if (str.includes(config.toLowerCase())) {
                    details.push(`Configuração de proxy: ${config}`);
                    found = true;
                    proxyIndicators.push({ type: 'config', value: config, event: event });
                }
            }

            for (const bundleId of this.patterns.bundleIds) {
                if (str.includes(bundleId.toLowerCase())) {
                    details.push(`Bundle ID de proxy: ${bundleId}`);
                    found = true;
                    proxyIndicators.push({ type: 'bundle', value: bundleId, event: event });
                }
            }

            for (const pattern of this.patterns.networkPatterns) {
                if (str.includes(pattern.toLowerCase())) {
                    details.push(`Padrão de rede: ${pattern}`);
                    found = true;
                    proxyIndicators.push({ type: 'network', value: pattern, event: event });
                }
            }

            for (const port of this.patterns.ports) {
                if (str.includes(`:${port}`) || str.includes(`port ${port}`)) {
                    details.push(`Porta de proxy: ${port}`);
                    found = true;
                    proxyIndicators.push({ type: 'port', value: port, event: event });
                }
            }

            for (const cert of this.patterns.certPatterns) {
                if (str.includes(cert.toLowerCase())) {
                    details.push(`Certificado MITM: ${cert}`);
                    found = true;
                    proxyIndicators.push({ type: 'certificate', value: cert, event: event });
                }
            }

            if (found && details.length > 0) {
                results.push(this.createResult(
                    'Proxy Evidence',
                    {
                        source: event.source || 'arquivo',
                        timestamp: event.timestamp,
                        details: details.join('; '),
                        event: event
                    },
                    details.length >= 3 ? 'high' : 'medium'
                ));
            }
        }

        if (proxyIndicators.length >= 3) {
            const uniqueTypes = new Set(proxyIndicators.map(i => i.type));
            if (uniqueTypes.size >= 2) {
                results.push({
                    detector: this.name,
                    type: 'Multiple Proxy Indicators',
                    evidence: proxyIndicators,
                    confidence: 'high',
                    timestamp: new Date(),
                    explanation: `Múltiplos indicadores de proxy detectados (${proxyIndicators.length} evidências)`
                });
            }
        }

        return results;
    }
}

// ============================================
// 13. ENHANCED CORRELATION ENGINE
// ============================================

class EnhancedCorrelationEngine {
    constructor() {
        this.rules = [
            this.correlateProxyAndCertificate.bind(this),
            this.correlateSideloadAndFreeFire.bind(this),
            this.correlateMultipleTools.bind(this),
            this.correlateVPNAndNetwork.bind(this),
            this.correlateTiming.bind(this),
            this.correlateCrashPatterns.bind(this),
            this.correlateNDJSONEvidence.bind(this),
            this.correlateMDMAndSuspicious.bind(this)
        ];
    }

    correlate(events) {
        const correlations = [];
        for (const rule of this.rules) {
            try {
                const result = rule(events);
                if (result && result.length > 0) {
                    correlations.push(...result);
                }
            } catch (error) {
                Logger.error(`Erro na regra de correlação: ${error.message}`);
            }
        }
        return correlations;
    }

    correlateProxyAndCertificate(events) {
        const correlations = [];
        const proxyEvents = events.filter(e => e.category === 'Proxy' || e.type === 'Proxy Evidence');
        const certEvents = events.filter(e => e.category === 'Certificate' || e.type === 'MITM Certificate');

        for (const proxy of proxyEvents) {
            for (const cert of certEvents) {
                if (this.isTimeClose(proxy.timestamp, cert.timestamp, 10)) {
                    correlations.push({
                        id: `corr_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
                        type: 'proxy_mitm_certificate',
                        description: 'Proxy e certificado MITM detectados próximos no tempo',
                        confidence: 'critical',
                        events: [proxy, cert],
                        timestamp: proxy.timestamp,
                        explanation: 'Proxy ativo com certificado MITM - indica interceptação de tráfego'
                    });
                }
            }
        }
        return correlations;
    }

    correlateSideloadAndFreeFire(events) {
        const correlations = [];
        const sideloadEvents = events.filter(e => e.type === 'Sideload App' || e.type === 'Sideload Pattern');
        const ffEvents = events.filter(e => e.category === 'FreeFire' || e.type === 'Free Fire Bundle');

        for (const sideload of sideloadEvents) {
            for (const ff of ffEvents) {
                if (this.isTimeClose(sideload.timestamp, ff.timestamp, 30)) {
                    correlations.push({
                        id: `corr_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
                        type: 'sideload_freefire_cheat',
                        description: 'Sideload detectado com atividade do Free Fire',
                        confidence: 'high',
                        events: [sideload, ff],
                        timestamp: ff.timestamp,
                        explanation: 'Aplicativo sideload detectado junto com uso do Free Fire - possível modificação do jogo'
                    });
                }
            }
        }
        return correlations;
    }

    correlateMultipleTools(events) {
        const correlations = [];
        const toolCategories = ['Proxy', 'VPN', 'Jailbreak', 'Hook', 'Sideload'];
        const tools = events.filter(e => toolCategories.includes(e.category));

        if (tools.length >= 3) {
            const uniqueTypes = new Set(tools.map(e => e.category));
            if (uniqueTypes.size >= 2) {
                correlations.push({
                    id: `corr_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
                    type: 'multiple_suspicious_tools',
                    description: `${tools.length} ferramentas suspeitas detectadas (${Array.from(uniqueTypes).join(', ')})`,
                    confidence: 'high',
                    events: tools,
                    timestamp: tools[0].timestamp,
                    explanation: 'Múltiplas ferramentas suspeitas detectadas - ambiente comprometido'
                });
            }
        }
        return correlations;
    }

    correlateVPNAndNetwork(events) {
        const correlations = [];
        const vpnEvents = events.filter(e => e.category === 'VPN');
        const networkEvents = events.filter(e => e.category === 'Network' || e.type === 'network');
        
        for (const vpn of vpnEvents) {
            for (const network of networkEvents) {
                if (this.isTimeClose(vpn.timestamp, network.timestamp, 10)) {
                    correlations.push({
                        id: `corr_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
                        type: 'vpn_network',
                        description: 'Atividade de VPN próxima a eventos de rede',
                        confidence: 'medium',
                        events: [vpn, network],
                        timestamp: vpn.timestamp
                    });
                }
            }
        }
        return correlations;
    }

    correlateTiming(events) {
        const correlations = [];
        const sortedEvents = events.filter(e => e.timestamp).sort((a, b) => a.timestamp - b.timestamp);
        
        for (let i = 0; i < sortedEvents.length - 2; i++) {
            const e1 = sortedEvents[i];
            const e2 = sortedEvents[i + 1];
            const e3 = sortedEvents[i + 2];
            const diff1 = e2.timestamp - e1.timestamp;
            const diff2 = e3.timestamp - e2.timestamp;
            
            if (diff1 < 60000 && diff2 < 60000) {
                if (e1.category !== e2.category || e2.category !== e3.category) {
                    correlations.push({
                        id: `corr_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
                        type: 'sequence',
                        description: `Sequência: ${e1.category} → ${e2.category} → ${e3.category}`,
                        confidence: 'medium',
                        events: [e1, e2, e3],
                        timestamp: e2.timestamp
                    });
                }
            }
        }
        return correlations;
    }

    correlateCrashPatterns(events) {
        const correlations = [];
        const crashes = events.filter(e => e.category === 'Crash' || e.type === 'crash');
        
        for (const crash of crashes) {
            const before = events.filter(e => {
                if (!e.timestamp || !crash.timestamp) return false;
                const diff = crash.timestamp - e.timestamp;
                return diff > 0 && diff < 300000;
            });
            
            if (before.length > 0) {
                correlations.push({
                    id: `corr_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
                    type: 'crash_preceded',
                    description: `Crash precedido por ${before.length} evento(s)`,
                    confidence: 'high',
                    events: [crash, ...before],
                    timestamp: crash.timestamp
                });
            }
        }
        return correlations;
    }

    correlateNDJSONEvidence(events) {
        const correlations = [];
        const ndjsonEvents = events.filter(e => e.category === 'NDJSON');
        const suspiciousEvents = events.filter(e => 
            e.category === 'Proxy' || e.category === 'VPN' || 
            e.category === 'Jailbreak' || e.category === 'Sideload'
        );

        for (const ndjson of ndjsonEvents) {
            for (const susp of suspiciousEvents) {
                if (this.isTimeClose(ndjson.timestamp, susp.timestamp, 5)) {
                    correlations.push({
                        id: `corr_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
                        type: 'ndjson_suspicious',
                        description: `Evidência em NDJSON correlacionada com ${susp.category}`,
                        confidence: 'high',
                        events: [ndjson, susp],
                        timestamp: ndjson.timestamp,
                        explanation: `Dados estruturados (NDJSON) contém evidências relacionadas a ${susp.category}`
                    });
                }
            }
        }
        return correlations;
    }

    correlateMDMAndSuspicious(events) {
        const correlations = [];
        const mdmEvents = events.filter(e => e.category === 'MDM' || e.type === 'Suspicious MDM Tool');
        const suspiciousEvents = events.filter(e => 
            e.category === 'Jailbreak' || e.category === 'Sideload' || e.category === 'Hook'
        );

        for (const mdm of mdmEvents) {
            for (const susp of suspiciousEvents) {
                if (this.isTimeClose(mdm.timestamp, susp.timestamp, 10)) {
                    correlations.push({
                        id: `corr_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
                        type: 'mdm_suspicious_tool',
                        description: `Configuração MDM com ferramenta suspeita (${susp.category})`,
                        confidence: 'high',
                        events: [mdm, susp],
                        timestamp: mdm.timestamp,
                        explanation: `Arquivo de configuração MDM contém evidência de ${susp.category}`
                    });
                }
            }
        }
        return correlations;
    }

    isTimeClose(date1, date2, minutes) {
        if (!date1 || !date2) return false;
        const diff = Math.abs(date1.getTime() - date2.getTime());
        return diff < minutes * 60 * 1000;
    }
}

// ============================================
// 14. STATISTICS ENGINE
// ============================================

class StatisticsEngine {
    constructor() {
        this.statistics = {
            totalEvents: 0,
            uniqueSources: new Set(),
            categories: {},
            types: {},
            confidence: { critical: 0, high: 0, medium: 0, low: 0 },
            correlations: { total: 0, byType: {} },
            fileTypes: {}
        };
    }

    analyze(events, detections, correlations) {
        this.statistics.totalEvents = events.length;
        
        for (const event of events) {
            if (event.source) {
                this.statistics.uniqueSources.add(event.source);
                const ext = event.source.split('.').pop().toLowerCase();
                this.statistics.fileTypes[ext] = (this.statistics.fileTypes[ext] || 0) + 1;
            }
            const category = event.category || 'Unknown';
            this.statistics.categories[category] = (this.statistics.categories[category] || 0) + 1;
            const type = event.type || 'unknown';
            this.statistics.types[type] = (this.statistics.types[type] || 0) + 1;
        }
        
        for (const detection of detections) {
            const confidence = detection.confidence || 'medium';
            if (this.statistics.confidence[confidence] !== undefined) {
                this.statistics.confidence[confidence]++;
            }
        }
        
        this.statistics.correlations.total = correlations.length;
        for (const corr of correlations) {
            const type = corr.type || 'unknown';
            this.statistics.correlations.byType[type] = (this.statistics.correlations.byType[type] || 0) + 1;
        }
        
        return this.getStats();
    }

    getStats() {
        return {
            ...this.statistics,
            uniqueSourcesCount: this.statistics.uniqueSources.size,
            uniqueSources: Array.from(this.statistics.uniqueSources),
            fileTypes: this.statistics.fileTypes
        };
    }
}

// ============================================
// 15. SCORE ENGINE
// ============================================

class ScoreEngine {
    constructor() {
        this.weights = { critical: 100, high: 50, medium: 25, low: 10 };
        this.categories = {
            jailbreak: 2.0,
            hook: 1.8,
            proxy: 1.6,
            vpn: 1.4,
            sideload: 1.5,
            certificate: 1.3,
            developer: 1.2,
            freefire: 1.0,
            appstore: 0.8,
            crash: 1.0,
            analytics: 0.5,
            ndjson: 0.7,
            mdm: 0.6
        };
        this.thresholds = { low: 50, medium: 100, high: 200, critical: 300 };
    }

    calculate(evidences) {
        let totalScore = 0;
        const byCategory = {};
        const byConfidence = { critical: 0, high: 0, medium: 0, low: 0 };

        for (const evidence of evidences) {
            const baseScore = this.weights[evidence.confidence] || 25;
            const categoryMultiplier = this.categories[evidence.category] || 1.0;
            const score = baseScore * categoryMultiplier;
            totalScore += score;

            if (!byCategory[evidence.category]) {
                byCategory[evidence.category] = { count: 0, score: 0 };
            }
            byCategory[evidence.category].count++;
            byCategory[evidence.category].score += score;
            
            if (evidence.confidence in byConfidence) {
                byConfidence[evidence.confidence]++;
            }
        }

        const categoryCount = Object.keys(byCategory).length;
        let diversityBonus = 0;
        if (categoryCount >= 5) diversityBonus = 50;
        else if (categoryCount >= 3) diversityBonus = 25;
        else if (categoryCount >= 2) diversityBonus = 10;

        const finalScore = Math.min(totalScore + diversityBonus, 1000);

        let riskLevel = 'low';
        if (finalScore >= this.thresholds.critical) riskLevel = 'critical';
        else if (finalScore >= this.thresholds.high) riskLevel = 'high';
        else if (finalScore >= this.thresholds.medium) riskLevel = 'medium';

        return {
            total: Math.round(finalScore),
            baseScore: Math.round(totalScore),
            diversityBonus: diversityBonus,
            riskLevel: riskLevel,
            byCategory: byCategory,
            byConfidence: byConfidence,
            totalEvidences: evidences.length
        };
    }

    getRecommendations(score) {
        const recommendations = [];
        
        if (score.riskLevel === 'critical' || score.riskLevel === 'high') {
            recommendations.push('🔍 Realizar análise aprofundada dos arquivos indicados');
            recommendations.push('📋 Verificar integridade dos certificados encontrados');
            recommendations.push('🛡️ Validar configurações de rede e VPN');
        }
        
        if (score.byCategory?.jailbreak) {
            recommendations.push('📱 Verificar presença de ferramentas de jailbreak');
        }
        
        if (score.byCategory?.proxy) {
            recommendations.push('🌐 Investigar ferramentas de proxy detectadas');
        }
        
        if (score.byCategory?.sideload) {
            recommendations.push('📲 Verificar aplicativos sideload instalados');
        }
        
        if (score.byCategory?.hook) {
            recommendations.push('⚠️ Detectar ferramentas de hook/injeção');
        }
        
        if (score.byCategory?.certificate) {
            recommendations.push('🔐 Verificar certificados instalados');
        }
        
        if (score.byCategory?.mdm) {
            recommendations.push('📋 Revisar configurações MDM e ferramentas de gerenciamento');
        }
        
        return recommendations;
    }
}

// ============================================
// 16. EVIDENCE CLASS
// ============================================

class Evidence {
    constructor(data) {
        this.id = this.generateId();
        this.detector = data.detector || 'unknown';
        this.sourceFile = data.sourceFile || 'unknown';
        this.path = data.path || '';
        this.key = data.key || '';
        this.value = data.value || null;
        this.timestamp = data.timestamp || new Date();
        this.confidence = data.confidence || 'medium';
        this.description = data.description || '';
        this.reason = data.reason || '';
        this.category = data.category || 'System';
        this.metadata = data.metadata || {};
        this.relatedEvidences = data.relatedEvidences || [];
        this.raw = data.raw || null;
    }

    generateId() {
        return 'ev_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    }
}

class EvidenceCollection {
    constructor() {
        this.evidences = [];
        this.index = new Map();
    }

    add(evidence) {
        if (!(evidence instanceof Evidence)) {
            evidence = new Evidence(evidence);
        }
        this.evidences.push(evidence);
        this.index.set(evidence.id, evidence);
        return evidence;
    }

    getAll() { return this.evidences; }
    get(id) { return this.index.get(id); }
    
    getByCategory(category) {
        return this.evidences.filter(e => e.category === category);
    }
    
    getByConfidence(confidence) {
        return this.evidences.filter(e => e.confidence === confidence);
    }
}

// ============================================
// 17. ENHANCED TIMELINE BUILDER
// ============================================

class EnhancedTimelineBuilder {
    constructor() {
        this.grouping = 'hour';
        this.sorting = 'asc';
    }

    build(events) {
        let filtered = events.filter(e => e.timestamp);
        filtered = filtered.sort((a, b) => {
            const timeA = a.timestamp ? a.timestamp.getTime() : 0;
            const timeB = b.timestamp ? b.timestamp.getTime() : 0;
            return this.sorting === 'asc' ? timeA - timeB : timeB - timeA;
        });

        const groups = new Map();
        for (const event of filtered) {
            if (!event.timestamp) continue;
            const key = this.getGroupKey(event.timestamp);
            if (!groups.has(key)) {
                groups.set(key, { timestamp: event.timestamp, events: [] });
            }
            groups.get(key).events.push(event);
        }

        const timeline = [];
        for (const [key, group] of groups) {
            timeline.push({
                key: key,
                timestamp: group.timestamp,
                events: group.events,
                count: group.events.length,
                categories: this.getCategoryDistribution(group.events),
                confidence: this.getMaxConfidence(group.events)
            });
        }
        return timeline;
    }

    getGroupKey(timestamp) {
        const pad = (n) => String(n).padStart(2, '0');
        switch (this.grouping) {
            case 'hour':
                return `${timestamp.getFullYear()}-${pad(timestamp.getMonth()+1)}-${pad(timestamp.getDate())} ${pad(timestamp.getHours())}:00`;
            case 'day':
                return `${timestamp.getFullYear()}-${pad(timestamp.getMonth()+1)}-${pad(timestamp.getDate())}`;
            default:
                return timestamp.toISOString();
        }
    }

    getCategoryDistribution(events) {
        const distribution = {};
        for (const event of events) {
            const category = event.category || 'Unknown';
            distribution[category] = (distribution[category] || 0) + 1;
        }
        return distribution;
    }

    getMaxConfidence(events) {
        const levels = { critical: 4, high: 3, medium: 2, low: 1 };
        let maxLevel = 0;
        let maxConfidence = 'low';
        
        for (const event of events) {
            const level = levels[event.confidence] || 0;
            if (level > maxLevel) {
                maxLevel = level;
                maxConfidence = event.confidence || 'low';
            }
        }
        return maxConfidence;
    }
}

// ============================================
// 18. EXPORT MANAGER
// ============================================

class ExportManager {
    constructor() {
        this.formats = {
            json: this.exportToJSON.bind(this),
            html: this.exportToHTML.bind(this),
            txt: this.exportToText.bind(this)
        };
    }

    async export(report, format = 'html') {
        const exporter = this.formats[format.toLowerCase()];
        if (!exporter) throw new Error(`Formato não suportado: ${format}`);
        return exporter(report);
    }

    exportToJSON(report) {
        return JSON.stringify(report, null, 2);
    }

    exportToHTML(report) {
        return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>iOS Evidence Scanner - Relatório</title>
<style>
* { margin:0; padding:0; box-sizing:border-box; }
body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f5f5f5; color: #333; padding: 20px; }
.container { max-width: 1200px; margin: 0 auto; background: white; padding: 30px; border-radius: 10px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
.header { border-bottom: 3px solid #007aff; padding-bottom: 20px; margin-bottom: 30px; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; }
.header h1 { color: #007aff; font-size: 28px; }
.header .meta { color: #666; font-size: 14px; }
.score-section { background: linear-gradient(135deg, #007aff, #0051d5); color: white; padding: 20px; border-radius: 8px; margin-bottom: 30px; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; }
.score-number { font-size: 48px; font-weight: bold; }
.risk-level { padding: 10px 20px; border-radius: 20px; background: rgba(255,255,255,0.2); font-weight: bold; }
.risk-critical { background: #ff3b30; }
.risk-high { background: #ff9500; }
.risk-medium { background: #ffcc00; color: #000; }
.risk-low { background: #34c759; }
.stats-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 15px; margin-bottom: 30px; }
.stat-box { background: #f8f9fa; padding: 15px; border-radius: 8px; text-align: center; }
.stat-box .number { font-size: 24px; font-weight: bold; color: #007aff; }
.stat-box .label { color: #666; font-size: 12px; margin-top: 5px; }
.section { margin-top: 30px; border-top: 1px solid #e5e5e5; padding-top: 20px; }
.section h2 { color: #333; margin-bottom: 15px; }
.detection-item { background: #f8f9fa; padding: 15px; border-radius: 8px; margin-bottom: 10px; border-left: 4px solid #007aff; }
.detection-item .type { font-weight: bold; color: #007aff; }
.detection-item .confidence { float: right; padding: 2px 10px; border-radius: 10px; font-size: 12px; font-weight: bold; }
.confidence-critical { background: #ff3b30; color: white; }
.confidence-high { background: #ff9500; color: white; }
.confidence-medium { background: #ffcc00; color: #000; }
.confidence-low { background: #34c759; color: white; }
.detection-item .details { margin-top: 5px; color: #666; font-size: 13px; }
.correlation-item { background: #f0f7ff; padding: 15px; border-radius: 8px; margin-bottom: 10px; border-left: 4px solid #ff9500; }
.correlation-item .type { font-weight: bold; color: #ff9500; }
.timeline-item { padding: 10px; border-bottom: 1px solid #eee; }
.timeline-item .time { color: #666; font-size: 14px; font-weight: bold; }
.timeline-item .desc { color: #333; margin-top: 3px; }
.recommendations { background: #f0f7ff; padding: 15px; border-radius: 8px; margin-top: 20px; }
.recommendations ul { padding-left: 20px; margin-top: 10px; }
.recommendations li { margin: 5px 0; }
</style>
</head>
<body>
<div class="container">
    <div class="header">
        <div>
            <h1>🔍 ${report.appName || 'iOS Evidence Scanner'}</h1>
            <div class="meta">Versão: ${report.version || '1.0.0'} • ${new Date(report.generated).toLocaleString('pt-BR')}</div>
        </div>
        <div style="font-size:14px;color:#666;">
            Eventos: ${report.totalEvents} • Detecções: ${report.totalDetections}
        </div>
    </div>
    
    <div class="score-section">
        <div>
            <div class="score-number">${report.score}</div>
            <div style="font-size:14px;opacity:0.8;">Score de Evidências</div>
        </div>
        <div>
            <div class="risk-level risk-${report.riskLevel}">${report.riskLevel.toUpperCase()}</div>
        </div>
    </div>
    
    <div class="stats-grid">
        <div class="stat-box"><div class="number">${Object.keys(report.statistics?.categories || {}).length}</div><div class="label">Categorias</div></div>
        <div class="stat-box"><div class="number">${report.statistics?.uniqueSourcesCount || 0}</div><div class="label">Fontes</div></div>
        <div class="stat-box"><div class="number">${report.statistics?.confidence?.critical || 0}</div><div class="label">Crítico</div></div>
        <div class="stat-box"><div class="number">${report.statistics?.confidence?.high || 0}</div><div class="label">Alta Confiança</div></div>
        <div class="stat-box"><div class="number">${report.totalCorrelations || 0}</div><div class="label">Correlações</div></div>
        <div class="stat-box"><div class="number">${report.totalEvidences || 0}</div><div class="label">Evidências</div></div>
    </div>

    ${report.detections && report.detections.length > 0 ? `
    <div class="section">
        <h2>🔎 Detecções (${report.detections.length})</h2>
        ${report.detections.slice(0, 100).map(d => `
            <div class="detection-item">
                <div>
                    <span class="type">${d.type || 'Detecção'}</span>
                    <span class="confidence confidence-${d.confidence || 'low'}">${(d.confidence || 'low').toUpperCase()}</span>
                </div>
                <div style="margin-top:5px;color:#666;font-size:14px;">${d.detector || 'Unknown'}</div>
                <div style="margin-top:5px;color:#888;font-size:13px;">${d.explanation || ''}</div>
                ${d.details ? `<div class="details">${d.details}</div>` : ''}
                ${d.evidence?.source ? `<div class="details">📁 ${d.evidence.source}</div>` : ''}
                ${d.timestamp ? `<div class="details">🕐 ${new Date(d.timestamp).toLocaleString('pt-BR')}</div>` : ''}
            </div>
        `).join('')}
        ${report.detections.length > 100 ? `<div style="color:#999;padding:10px;">... e mais ${report.detections.length - 100} detecções</div>` : ''}
    </div>` : ''}

    ${report.correlations && report.correlations.length > 0 ? `
    <div class="section">
        <h2>🔗 Correlações (${report.correlations.length})</h2>
        ${report.correlations.slice(0, 30).map(c => `
            <div class="correlation-item">
                <div>
                    <span class="type">${c.type || 'Correlação'}</span>
                    <span style="float:right;font-size:12px;color:#666;">${c.confidence || 'medium'}</span>
                </div>
                <div style="margin-top:5px;color:#666;font-size:14px;">${c.description || ''}</div>
                ${c.explanation ? `<div style="margin-top:3px;color:#888;font-size:12px;">${c.explanation}</div>` : ''}
                <div style="margin-top:3px;color:#999;font-size:12px;">${c.events ? `${c.events.length} evento(s) relacionados` : ''}</div>
            </div>
        `).join('')}
    </div>` : ''}

    ${report.recommendations && report.recommendations.length > 0 ? `
    <div class="section">
        <div class="recommendations">
            <h2>💡 Recomendações</h2>
            <ul>${report.recommendations.map(r => `<li>${r}</li>`).join('')}</ul>
        </div>
    </div>` : ''}

    <div style="text-align:center;color:#999;padding:30px 0 10px;font-size:12px;border-top:1px solid #eee;margin-top:30px;">
        ${report.appName || 'iOS Evidence Scanner'} - Análise baseada exclusivamente em evidências nos arquivos
    </div>
</div>
</body>
</html>`;
    }

    exportToText(report) {
        let output = [];
        output.push('='.repeat(60));
        output.push(`  ${report.appName || 'iOS Evidence Scanner'} v${report.version || '1.0.0'}`);
        output.push('='.repeat(60));
        output.push('');
        output.push(`📅 Relatório: ${new Date(report.generated).toLocaleString('pt-BR')}`);
        output.push(`📊 Eventos: ${report.totalEvents}`);
        output.push(`🔍 Detecções: ${report.totalDetections}`);
        output.push(`📈 SCORE: ${report.score} - ${report.riskLevel.toUpperCase()}`);
        output.push('');
        output.push('📊 ESTATÍSTICAS:');
        output.push(`  Categorias: ${Object.keys(report.statistics?.categories || {}).join(', ')}`);
        output.push(`  Fontes: ${report.statistics?.uniqueSourcesCount || 0}`);
        output.push(`  Tipos de Arquivo: ${Object.keys(report.statistics?.fileTypes || {}).join(', ')}`);
        output.push(`  Crítico: ${report.statistics?.confidence?.critical || 0}`);
        output.push(`  Alta Confiança: ${report.statistics?.confidence?.high || 0}`);
        output.push(`  Correlações: ${report.totalCorrelations || 0}`);
        output.push('');
        
        if (report.detections && report.detections.length > 0) {
            output.push('🔎 DETECÇÕES:');
            for (const d of report.detections.slice(0, 50)) {
                output.push(`  [${(d.confidence || 'low').toUpperCase()}] ${d.detector}: ${d.type}`);
                output.push(`    ${d.explanation || ''}`);
                if (d.details) output.push(`    ${d.details}`);
                output.push('');
            }
            if (report.detections.length > 50) {
                output.push(`  ... e mais ${report.detections.length - 50} detecções`);
            }
        }
        
        if (report.correlations && report.correlations.length > 0) {
            output.push('');
            output.push('🔗 CORRELAÇÕES:');
            for (const c of report.correlations.slice(0, 20)) {
                output.push(`  ${c.type}: ${c.description}`);
                if (c.explanation) output.push(`    ${c.explanation}`);
            }
        }
        
        if (report.recommendations && report.recommendations.length > 0) {
            output.push('');
            output.push('💡 RECOMENDAÇÕES:');
            for (const r of report.recommendations) {
                output.push(`  ${r}`);
            }
        }
        
        output.push('');
        output.push('='.repeat(60));
        return output.join('\n');
    }

    getSupportedFormats() { return Object.keys(this.formats); }
}

// ============================================
// 19. UI - CORRIGIDA
// ============================================

class ImprovedScriptableUI {
    constructor(scanner) {
        this.scanner = scanner;
        this.isRunning = false;
        this.shouldCancel = false;
        this.progress = 0;
        this.currentStep = '';
        this.totalSteps = 0;
    }

    async showMainMenu() {
        const alert = new Alert();
        alert.title = '🔍 iOS Evidence Scanner';
        alert.message = `v${this.scanner?.configManager?.get('version') || '2.2.0'}\n\nScanner forense para análise de evidências em arquivos iOS\n\n📁 Suporte: JSON, NDJSON, IPS, PLIST, LOG, CSV, XML\n🔎 Detectores: Proxy, VPN, Jailbreak, Sideload, Hook, Free Fire, Certificados, MDM`;
        alert.addAction('🔍 Nova Análise');
        alert.addAction('📊 Histórico');
        alert.addAction('⚙️ Configurações');
        alert.addAction('📖 Ajuda');
        alert.addAction('❌ Sair');
        return await alert.presentAlert();
    }

    async selectFiles() {
        try {
            if (!this.scanner || !this.scanner.fileLoader) {
                throw new Error('FileLoader não disponível');
            }
            
            const alert = new Alert();
            alert.title = '📂 Selecionar Arquivo';
            alert.message = 'Escolha o arquivo que deseja analisar.\n\nFormatos suportados:\n• JSON, NDJSON, JSONL\n• IPS (Crash Reports)\n• PLIST, LOG, CSV, XML, TXT';
            alert.addAction('📂 Escolher da iCloud');
            alert.addAction('📂 Seletor Nativo');
            alert.addAction('❌ Cancelar');
            
            const action = await alert.presentAlert();
            
            if (action === 2) {
                return [];
            }
            
            let files = [];
            
            if (action === 0) {
                files = await this.scanner.fileLoader.selectFilesFromiCloud(true);
            } else {
                files = await this.scanner.fileLoader.selectFiles(true);
            }
            
            if (!files || files.length === 0) {
                const alert2 = new Alert();
                alert2.title = 'ℹ️ Nenhum arquivo selecionado';
                alert2.message = 'Você precisa selecionar pelo menos um arquivo para analisar.';
                alert2.addAction('OK');
                await alert2.presentAlert();
                return [];
            }
            
            return files;
            
        } catch (error) {
            Logger.error(`Erro na seleção: ${error.message}`);
            
            const alert = new Alert();
            alert.title = '❌ Erro ao selecionar arquivos';
            alert.message = `${error.message}\n\nDica: Coloque os arquivos na pasta:\niCloud Drive → Scriptable`;
            alert.addAction('OK');
            await alert.presentAlert();
            
            return [];
        }
    }

    async showFileInfo(files) {
        if (!files || files.length === 0) return false;
        
        let message = `📂 ${files.length} arquivo(s) selecionado(s):\n\n`;
        let totalSize = 0;
        let fileTypes = new Set();
        
        for (const file of files) {
            const ext = file.extension || 'desconhecido';
            const type = file.type || 'Desconhecido';
            const size = this.scanner?.fileLoader?.formatFileSize(file.size) || '?';
            totalSize += file.size || 0;
            fileTypes.add(ext);
            
            message += `📄 ${file.name}\n   Tipo: ${type} (${ext}) • Tamanho: ${size}\n\n`;
        }
        
        message += `📊 Total: ${this.scanner?.fileLoader?.formatFileSize(totalSize)} • ${fileTypes.size} tipo(s) de arquivo`;
        
        const alert = new Alert();
        alert.title = '📂 Arquivos Selecionados';
        alert.message = message + '\n\nDeseja iniciar a análise?';
        alert.addAction('✅ Iniciar Análise');
        alert.addAction('📂 Escolher Mais');
        alert.addAction('❌ Cancelar');
        
        const action = await alert.presentAlert();
        
        if (action === 0) return true;
        if (action === 1) return await this.selectFiles();
        return false;
    }

    async showProgress(current, total, message, details = '') {
        this.progress = (current / total) * 100;
        this.currentStep = message;
        this.totalSteps = total;
        
        const percentage = Math.round(this.progress);
        const bar = this.createProgressBar(percentage);
        
        console.log(`Progresso: ${percentage}% - ${message}${details ? ' - ' + details : ''}`);
        
        if (percentage % 20 === 0 || percentage === 100 || current === total) {
            const alert = new Alert();
            alert.title = '🔄 Processando...';
            alert.message = `${message}\n\n${bar}\n${percentage}% concluído (${current}/${total})\n${details ? '\n' + details : ''}`;
            
            if (percentage >= 100) {
                alert.addAction('✅ Concluído!');
                await alert.presentAlert();
                return;
            }
            
            alert.presentAlert().catch(() => {});
        }
    }

    createProgressBar(percentage) {
        const width = 20;
        const filled = Math.round((percentage / 100) * width);
        const empty = width - filled;
        return '█'.repeat(filled) + '░'.repeat(empty);
    }

    async showReport(report) {
        const webView = new WebView();
        webView.title = '📊 Relatório de Análise';
        
        const html = this.generateReportHTML(report);
        webView.loadHTML(html);
        await webView.present(true);
    }

    generateReportHTML(report) {
        const exportManager = new ExportManager();
        return exportManager.exportToHTML(report);
    }

    async showStats(stats) {
        const alert = new Alert();
        alert.title = '📊 Estatísticas';
        
        let message = `
📈 Resumo:
  Eventos: ${stats.totalEvents}
  Detecções: ${stats.totalDetections}
  Correlações: ${stats.totalCorrelations}
  Evidências: ${stats.totalEvidences}
  Tempo: ${(stats.executionTime / 1000).toFixed(2)}s

📁 Arquivos: ${stats.fileCount || 0}

🔍 Detecções por Confiança:
  Crítico: ${stats.byConfidence?.critical || 0}
  Alta: ${stats.byConfidence?.high || 0}
  Média: ${stats.byConfidence?.medium || 0}
  Baixa: ${stats.byConfidence?.low || 0}

📂 Tipos de Arquivo:
  ${Object.entries(stats.fileTypes || {}).map(([ext, count]) => `${ext}: ${count}`).join('\n  ')}
        `;
        
        alert.message = message;
        alert.addAction('OK');
        await alert.presentAlert();
    }

    async showError(error) {
        const alert = new Alert();
        alert.title = '❌ Erro';
        alert.message = error.message || 'Ocorreu um erro inesperado';
        alert.addAction('OK');
        await alert.presentAlert();
    }

    async showSuccess(message) {
        const alert = new Alert();
        alert.title = '✅ Sucesso';
        alert.message = message;
        alert.addAction('OK');
        await alert.presentAlert();
    }

    async showHelp() {
        const webView = new WebView();
        webView.title = '📖 Ajuda';
        webView.loadHTML(`
            <!DOCTYPE html>
            <html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
            <style>
                body { font-family: -apple-system, BlinkMacSystemFont, sans-serif; padding: 20px; background: #f5f5f5; }
                .container { max-width: 600px; margin: 0 auto; background: white; padding: 30px; border-radius: 10px; }
                h1 { color: #007aff; }
                h2 { color: #333; margin-top: 20px; }
                ul { padding-left: 20px; }
                li { margin: 10px 0; }
                .tip { background: #f0f7ff; padding: 15px; border-radius: 8px; border-left: 4px solid #007aff; margin: 20px 0; }
                .warning { background: #fff3e0; padding: 15px; border-radius: 8px; border-left: 4px solid #ff9500; margin: 20px 0; }
                .detector-list { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin: 10px 0; }
                .detector-item { background: #f8f9fa; padding: 8px; border-radius: 5px; text-align: center; font-size: 14px; }
                .format-list { display: flex; flex-wrap: wrap; gap: 8px; margin: 10px 0; }
                .format-tag { background: #e5e5e5; padding: 4px 12px; border-radius: 12px; font-size: 12px; }
            </style>
            </head>
            <body>
            <div class="container">
                <h1>📖 Guia do iOS Evidence Scanner v2.2</h1>
                
                <h2>🔍 O que faz?</h2>
                <p>Analisa arquivos do sistema iOS em busca de evidências técnicas.</p>
                
                <h2>📁 Formatos Suportados</h2>
                <div class="format-list">
                    <span class="format-tag">📋 PLIST</span>
                    <span class="format-tag">📊 JSON</span>
                    <span class="format-tag">📊 NDJSON</span>
                    <span class="format-tag">📊 JSONL</span>
                    <span class="format-tag">💥 IPS</span>
                    <span class="format-tag">📝 LOG</span>
                    <span class="format-tag">📄 TXT</span>
                    <span class="format-tag">📈 CSV</span>
                    <span class="format-tag">📋 XML</span>
                </div>
                
                <h2>🔎 Detectores Disponíveis</h2>
                <div class="detector-list">
                    <div class="detector-item">🛡️ Proxy</div>
                    <div class="detector-item">🔒 VPN</div>
                    <div class="detector-item">📱 Jailbreak</div>
                    <div class="detector-item">📲 Sideload</div>
                    <div class="detector-item">🎣 Hook/Frida</div>
                    <div class="detector-item">🎮 Free Fire</div>
                    <div class="detector-item">🔐 Certificados</div>
                    <div class="detector-item">💥 Crash Reports</div>
                    <div class="detector-item">📋 MDM Config</div>
                </div>
                
                <h2>📁 Como usar?</h2>
                <ol>
                    <li><strong>Selecionar:</strong> Escolha o(s) arquivo(s) para analisar</li>
                    <li><strong>Analisar:</strong> Aguarde o processamento automático</li>
                    <li><strong>Visualizar:</strong> Veja o relatório completo</li>
                </ol>
                
                <div class="tip">
                    <strong>💡 Dica:</strong> Use arquivos de sysdiagnose para melhores resultados
                </div>
                
                <div class="warning">
                    <strong>⚠️ Importante:</strong> O scanner não afirma conclusões, apenas apresenta evidências
                </div>
                
                <h2>📊 Níveis de Confiança</h2>
                <ul>
                    <li><span style="color:#ff3b30;">Crítico</span> - Evidências fortes</li>
                    <li><span style="color:#ff9500;">Alta</span> - Evidências significativas</li>
                    <li><span style="color:#ffcc00;">Média</span> - Indícios</li>
                    <li><span style="color:#34c759;">Baixa</span> - Possíveis indícios</li>
                </ul>
            </div>
            </body></html>
        `);
        await webView.present(true);
    }

    async showCancelConfirmation() {
        const alert = new Alert();
        alert.title = '⚠️ Cancelar Análise';
        alert.message = 'Deseja realmente cancelar a análise em andamento?';
        alert.addAction('Sim, cancelar');
        alert.addAction('Continuar');
        const action = await alert.presentAlert();
        if (action === 0) {
            this.shouldCancel = true;
            return true;
        }
        return false;
    }
}

// ============================================
// 20. APPLICATION PRINCIPAL
// ============================================

class Application {
    constructor() {
        this.configManager = new ConfigManager();
        this.fileLoader = new ScriptableFileLoader(this.configManager);
        this.parser = new AdvancedParser();
        this.detectorManager = new DetectorManager();
        this.correlationEngine = new EnhancedCorrelationEngine();
        this.statisticsEngine = new StatisticsEngine();
        this.timelineBuilder = new EnhancedTimelineBuilder();
        this.scoreEngine = new ScoreEngine();
        this.evidenceCollection = new EvidenceCollection();
        this.exportManager = new ExportManager();
        this.ui = new ImprovedScriptableUI(this);
        
        this.events = [];
        this.detections = [];
        this.correlations = [];
        this.startTime = null;
        this.endTime = null;
        
        this.registerDetectors();
    }

    registerDetectors() {
        this.detectorManager.register(new AdvancedProxyDetector());
        this.detectorManager.register(new AdvancedVPNDetector());
        this.detectorManager.register(new AdvancedJailbreakDetector());
        this.detectorManager.register(new AdvancedSideloadDetector());
        this.detectorManager.register(new AdvancedHookDetector());
        this.detectorManager.register(new AdvancedFreeFireDetector());
        this.detectorManager.register(new AdvancedCertificateDetector());
        this.detectorManager.register(new MDMPlistsDetector());
    }

    async run() {
        try {
            while (true) {
                const action = await this.ui.showMainMenu();
                
                switch (action) {
                    case 0:
                        await this.runAnalysis();
                        break;
                    case 1:
                        await this.showHistory();
                        break;
                    case 2:
                        await this.showSettings();
                        break;
                    case 3:
                        await this.ui.showHelp();
                        break;
                    case 4:
                        return;
                }
            }
        } catch (error) {
            await this.ui.showError(error);
        }
    }

    async runAnalysis() {
        try {
            const files = await this.ui.selectFiles();
            if (!files || files.length === 0) {
                const alert = new Alert();
                alert.title = 'ℹ️ Nenhum arquivo selecionado';
                alert.message = 'A análise foi cancelada porque nenhum arquivo foi selecionado.';
                alert.addAction('OK');
                await alert.presentAlert();
                return;
            }

            const confirmed = await this.ui.showFileInfo(files);
            if (!confirmed) return;

            this.startTime = Date.now();
            this.events = [];
            this.detections = [];
            this.correlations = [];
            this.evidenceCollection = new EvidenceCollection();

            const totalFiles = files.length;
            let processedFiles = 0;

            for (const file of files) {
                await this.ui.showProgress(
                    processedFiles,
                    totalFiles,
                    `📂 Analisando: ${file.name}`,
                    `Tamanho: ${this.fileLoader.formatFileSize(file.size)}`
                );

                const parsedEvents = await this.parser.parse(file);
                this.events.push(...parsedEvents);

                for (const event of parsedEvents) {
                    const evidence = new Evidence({
                        detector: 'Parser',
                        sourceFile: file.name,
                        key: event.type || 'event',
                        value: event.description || '',
                        timestamp: event.timestamp || new Date(),
                        confidence: 'low',
                        description: event.description || '',
                        category: event.category || 'System',
                        raw: event.raw || null
                    });
                    this.evidenceCollection.add(evidence);
                }

                processedFiles++;
            }

            await this.ui.showProgress(1, 1, '🔎 Executando detectores...', 
                `${this.detectorManager.getDetectorCount()} detectores ativos`);
            
            this.detections = this.detectorManager.analyze(this.events);
            
            for (const detection of this.detections) {
                const evidence = new Evidence({
                    detector: detection.detector,
                    sourceFile: detection.evidence?.source || 'unknown',
                    key: detection.type || 'detection',
                    value: detection.explanation || '',
                    timestamp: detection.timestamp || new Date(),
                    confidence: detection.confidence || 'medium',
                    description: detection.type || 'Detecção',
                    category: detection.type || 'Detection',
                    raw: detection
                });
                this.evidenceCollection.add(evidence);
            }

            await this.ui.showProgress(1, 1, '🔗 Correlacionando eventos...', 
                `${this.events.length} eventos processados`);
            
            this.correlations = this.correlationEngine.correlate(this.events);

            const score = this.scoreEngine.calculate(this.evidenceCollection.getAll());
            const stats = this.statisticsEngine.analyze(this.events, this.detections, this.correlations);
            const timeline = this.timelineBuilder.build(this.events);

            this.endTime = Date.now();

            const report = {
                appName: this.configManager.get('appName'),
                version: this.configManager.get('version'),
                generated: new Date().toISOString(),
                totalEvents: this.events.length,
                totalDetections: this.detections.length,
                totalEvidences: this.evidenceCollection.getAll().length,
                totalCorrelations: this.correlations.length,
                score: score.total,
                riskLevel: score.riskLevel,
                statistics: stats,
                timeline: timeline,
                detections: this.detections,
                correlations: this.correlations,
                recommendations: this.scoreEngine.getRecommendations(score),
                files: files.map(f => ({
                    name: f.name,
                    extension: f.extension,
                    size: f.size,
                    modified: f.modified
                })),
                performance: {
                    totalTime: this.endTime - this.startTime
                }
            };

            await this.ui.showReport(report);

            const exportAlert = new Alert();
            exportAlert.title = '📥 Exportar Relatório';
            exportAlert.message = 'Deseja exportar o relatório em múltiplos formatos?';
            exportAlert.addAction('Sim');
            exportAlert.addAction('Não');
            
            if (await exportAlert.presentAlert() === 0) {
                await this.exportReport(report);
            }

            const statsData = {
                totalEvents: this.events.length,
                totalDetections: this.detections.length,
                totalCorrelations: this.correlations.length,
                totalEvidences: this.evidenceCollection.getAll().length,
                executionTime: this.endTime - this.startTime,
                fileCount: files.length,
                byConfidence: {
                    critical: this.detections.filter(d => d.confidence === 'critical').length,
                    high: this.detections.filter(d => d.confidence === 'high').length,
                    medium: this.detections.filter(d => d.confidence === 'medium').length,
                    low: this.detections.filter(d => d.confidence === 'low').length
                },
                fileTypes: stats.fileTypes || {}
            };
            await this.ui.showStats(statsData);

        } catch (error) {
            await this.ui.showError(error);
        }
    }

    async exportReport(report) {
        try {
            const formats = this.exportManager.getSupportedFormats();
            const fm = FileManager.iCloud();
            const docs = fm.documentsDirectory();
            
            for (const format of formats) {
                const content = await this.exportManager.export(report, format);
                const ext = format === 'html' ? 'html' : format;
                const filename = `evidence_report_${Date.now()}.${ext}`;
                const path = fm.joinPath(docs, filename);
                fm.writeString(path, content);
                Logger.info(`Relatório exportado: ${filename}`);
            }

            await this.ui.showSuccess(`Relatórios exportados para:\n${docs}`);
        } catch (error) {
            await this.ui.showError(error);
        }
    }

    async showHistory() {
        try {
            const fm = FileManager.iCloud();
            const docs = fm.documentsDirectory();
            const items = fm.listContents(docs);
            
            const reports = items
                .filter(item => item.startsWith('evidence_report_'))
                .sort()
                .reverse();

            if (reports.length === 0) {
                const alert = new Alert();
                alert.title = '📊 Histórico';
                alert.message = 'Nenhum relatório anterior encontrado';
                alert.addAction('OK');
                await alert.presentAlert();
                return;
            }

            const selection = new UITable();
            selection.title = '📄 Relatórios Anteriores';
            
            for (const report of reports.slice(0, 20)) {
                const row = new UITableRow(`📄 ${report}`);
                const path = fm.joinPath(docs, report);
                try {
                    const content = fm.readString(path);
                    row.detailText = `${this.fileLoader.formatFileSize(content ? content.length : 0)}`;
                } catch (e) {
                    row.detailText = 'Arquivo indisponível';
                }
                selection.addRow(row);
            }

            selection.addAction('Visualizar', async (table, index) => {
                const selected = table.selectedRows[0];
                const path = fm.joinPath(docs, reports[selected.index]);
                const content = fm.readString(path);
                
                const webView = new WebView();
                webView.title = '📄 Relatório';
                webView.loadHTML(content);
                await webView.present(true);
            });

            await selection.present();
        } catch (error) {
            await this.ui.showError(error);
        }
    }

    async showSettings() {
        const alert = new Alert();
        alert.title = '⚙️ Configurações';
        alert.message = `
🔍 Debug: ${this.configManager.get('debug') ? '✅' : '❌'}
💾 Cache: ${this.configManager.get('cacheEnabled') ? '✅' : '❌'}
📦 Tamanho máximo: ${(this.configManager.get('maxFileSize') / 1024 / 1024).toFixed(1)} MB
📁 Formatos: ${this.configManager.getSupportedExtensions().join(', ')}
🔎 Detectores: ${this.detectorManager.getDetectorCount()} ativos
        `;
        alert.addAction('🔍 Debug: ' + (this.configManager.get('debug') ? 'Desativar' : 'Ativar'));
        alert.addAction('💾 Cache: ' + (this.configManager.get('cacheEnabled') ? 'Desativar' : 'Ativar'));
        alert.addAction('🔙 Voltar');

        const action = await alert.presentAlert();
        
        switch (action) {
            case 0:
                this.configManager.set('debug', !this.configManager.get('debug'));
                await this.showSettings();
                break;
            case 1:
                this.configManager.set('cacheEnabled', !this.configManager.get('cacheEnabled'));
                if (!this.configManager.get('cacheEnabled')) {
                    this.fileLoader.clearCache();
                }
                await this.showSettings();
                break;
            default:
                break;
        }
    }
}

// ============================================
// 21. PONTO DE ENTRADA
// ============================================

(async () => {
    try {
        const app = new Application();
        await app.run();
    } catch (error) {
        console.error('Erro fatal:', error.message);
        const alert = new Alert();
        alert.title = '❌ Erro Fatal';
        alert.message = `Ocorreu um erro inesperado:\n\n${error.message}`;
        alert.addAction('OK');
        await alert.presentAlert();
    }
})();
