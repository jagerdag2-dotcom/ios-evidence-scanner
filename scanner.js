// ============================================
// iOS EVIDENCE SCANNER - VERSÃO UNIFICADA 2.2.0
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
// 6. SCRIPTABLE FILE LOADER (UNIFICADO)
// ============================================

class ScriptableFileLoader {
    constructor(configManager) {
        this.configManager = configManager;
        this.supportedExtensions = configManager.getSupportedExtensions();
        this.maxFileSize = configManager.getMaxFileSize();
        this.cacheManager = new CacheManager(configManager);
        this.selectedFiles = [];
    }

    async selectFiles(allowMultiple = true) {
        try {
            Logger.info('Abrindo seletor de arquivos...');
            
            // Tenta usar o seletor nativo do Scriptable
            const files = await this.selectFilesNative(allowMultiple);
            if (files && files.length > 0) {
                this.selectedFiles = files;
                return files;
            }
            
            // Fallback para iCloud
            return await this.selectFilesFromiCloud(allowMultiple);
        } catch (error) {
            Logger.error(`Erro na seleção de arquivos: ${error.message}`);
            return await this.selectFilesFromiCloud(allowMultiple);
        }
    }

    async selectFilesNative(allowMultiple = true) {
        try {
            // Usa DocumentPicker do Scriptable
            const documentPicker = new DocumentPicker();
            const files = await documentPicker.present(allowMultiple);
            
            if (!files || files.length === 0) return [];
            
            const loadedFiles = [];
            for (const file of files) {
                try {
                    const content = file.readString();
                    if (content) {
                        loadedFiles.push({
                            name: file.fileName || 'arquivo',
                            path: file.filePath || '',
                            extension: this.getFileExtension(file.fileName || ''),
                            size: content.length,
                            modified: new Date(),
                            content: content,
                            type: this.detectFileType(file.fileName || '')
                        });
                    }
                } catch (e) {
                    Logger.error(`Erro ao ler arquivo: ${e.message}`);
                }
            }
            
            return loadedFiles;
        } catch (error) {
            Logger.warn(`DocumentPicker falhou: ${error.message}`);
            return [];
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
                alert.message = `Nenhum arquivo suportado encontrado.\n\nFormatos: ${this.supportedExtensions.join(', ')}`;
                alert.addAction('OK');
                await alert.presentAlert();
                return [];
            }

            const selection = new UITable();
            selection.title = '📂 Selecione o(s) arquivo(s)';
            
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
                row.detailText = this.formatFileSize(fileSize);
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
            
            let result = null;
            selection.addAction('📊 Analisar', async (table) => {
                const selectedRows = table.selectedRows;
                if (selectedRows.length === 0) {
                    const alert = new Alert();
                    alert.title = '⚠️ Nenhum arquivo selecionado';
                    alert.message = 'Selecione pelo menos um arquivo.';
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
                                type: this.detectFileType(fileInfo.item)
                            });
                        }
                    } catch (error) {
                        Logger.error(`Erro ao ler ${fileInfo.item}: ${error.message}`);
                    }
                }
                result = files;
                return files;
            });
            
            selection.addAction('❌ Cancelar', () => {
                result = [];
                return [];
            });

            await selection.present();
            
            // Aguarda o resultado
            let attempts = 0;
            while (result === null && attempts < 20) {
                await new Promise(resolve => setTimeout(resolve, 100));
                attempts++;
            }
            
            return result || [];
        } catch (error) {
            Logger.error(`Erro na seleção iCloud: ${error.message}`);
            return [];
        }
    }

    loadFile(file) {
        try {
            if (typeof file === 'string') {
                const fm = FileManager.iCloud();
                const content = fm.readString(file);
                if (!content) throw new Error(`Arquivo vazio: ${file}`);
                
                return {
                    name: this.getFileName(file),
                    path: file,
                    extension: this.getFileExtension(file),
                    size: content.length,
                    modified: new Date(),
                    content: content,
                    type: this.detectFileType(file)
                };
            } else if (file.content) {
                return {
                    name: file.name || 'arquivo',
                    path: file.path || '',
                    extension: this.getFileExtension(file.name || ''),
                    size: file.content.length,
                    modified: file.modified || new Date(),
                    content: file.content,
                    type: this.detectFileType(file.name || '')
                };
            } else {
                throw new Error('Formato de arquivo não suportado');
            }
        } catch (error) {
            Logger.error(`Erro ao carregar arquivo: ${error.message}`);
            throw error;
        }
    }

    detectFileType(filename) {
        const ext = this.getFileExtension(filename);
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
            
            vpn: ['vpn', 'tunnel', 'wireguard', 'openvpn', 'ikev2', 'l2tp', 'pptp', 'ipsec'],
            proxy: ['proxy', 'mitm', 'charles', 'burp', 'fiddler', 'proxyman', 'surge', 'quantumult', 'shadowrocket'],
            dns: ['dns', 'nameserver', 'resolv', '8.8.8.8', '1.1.1.1', '9.9.9.9'],
            
            suspicious: [
                '3utools', 'altstore', 'trollstore', 'sidestore', 'scarlet', 'esign',
                'cydia', 'sileo', 'zebra', 'procursus', 'ellekit', 
                'frida', 'substrate', 'substitute', 'cycript',
                'adguard', 'surge', 'quantumult', 'shadowrocket', 'potatso', 'loon'
            ],
            
            mdmConfig: ['server', 'host', 'url', 'endpoint', 'certificate', 'cert', 'pem', 'crt', 'ca', 'identity']
        };
        
        this.commonDomains = [
            'apple.com', 'icloud.com', 'google.com', 'facebook.com',
            'localhost', 'example.com', 'test.com'
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
        if (!str || str.length > 10000) return;
        const lowerStr = str.toLowerCase();

        // IPv4
        const ipv4Matches = str.match(this.patterns.ipv4);
        if (ipv4Matches) {
            for (const ip of ipv4Matches) {
                if (!this.isPrivateIP(ip) && !this.isReservedIP(ip)) {
                    results.network.ips.push({ ip, path, type: 'IPv4', confidence: 'high' });
                }
            }
        }

        // Domínios
        const domainMatches = str.match(this.patterns.domain);
        if (domainMatches) {
            for (const domain of domainMatches) {
                if (!this.isCommonDomain(domain) && domain.length > 3) {
                    results.network.domains.push({ domain, path, confidence: 'medium' });
                }
            }
        }

        // URLs
        const urlMatches = str.match(this.patterns.url);
        if (urlMatches) {
            for (const url of urlMatches) {
                results.network.urls.push({ url, path, confidence: 'high' });
            }
        }

        // VPN, Proxy, DNS
        for (const vpn of this.patterns.vpn) {
            if (lowerStr.includes(vpn)) {
                results.network.vpnIndicators.push({ indicator: vpn, path, confidence: 'high' });
            }
        }
        for (const proxy of this.patterns.proxy) {
            if (lowerStr.includes(proxy)) {
                results.network.proxyIndicators.push({ indicator: proxy, path, confidence: 'high' });
            }
        }
        for (const dns of this.patterns.dns) {
            if (lowerStr.includes(dns)) {
                results.network.dnsIndicators.push({ indicator: dns, path, confidence: 'medium' });
            }
        }

        // Suspicious
        for (const tool of this.patterns.suspicious) {
            if (lowerStr.includes(tool)) {
                results.suspicious.push({ tool, path, confidence: 'critical' });
            }
        }
    }

    analyzeKey(key, value, path, results) {
        const lowerKey = key.toLowerCase();

        if (lowerKey.includes('com.') || lowerKey.includes('org.') || lowerKey.includes('net.')) {
            if (key.length > 5 && key.length < 50) {
                results.systemInfo.apps.push({ bundleId: key, path, value, confidence: 'medium' });
            }
        }

        if (lowerKey.includes('udid') || lowerKey.includes('serial') || 
            lowerKey.includes('deviceid') || lowerKey.includes('identifier') ||
            lowerKey.includes('uuid')) {
            results.systemInfo.identifiers.push({ key, value, path, confidence: 'medium' });
        }

        if (lowerKey.includes('cert') || lowerKey.includes('trust') || 
            lowerKey.includes('pem') || lowerKey.includes('crt')) {
            results.systemInfo.certificates.push({ 
                key, 
                value: typeof value === 'string' ? value.substring(0, 50) : value, 
                path, 
                confidence: 'medium' 
            });
        }

        for (const config of this.patterns.mdmConfig) {
            if (lowerKey.includes(config)) {
                results.mdmConfig.push({
                    key, 
                    value: typeof value === 'string' ? value.substring(0, 100) : value, 
                    path, 
                    type: config, 
                    confidence: 'medium' 
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
        return false;
    }

    generateReport(results) {
        return {
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
            network: results.network || { ips: [], domains: [], urls: [], vpnIndicators: [], proxyIndicators: [], dnsIndicators: [] },
            suspicious: results.suspicious || [],
            mdmConfig: results.mdmConfig || [],
            systemInfo: results.systemInfo || { apps: [], identifiers: [], certificates: [] }
        };
    }
}

// ============================================
// 8. BASE DETECTOR
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
// 9. MDM PLIST DETECTOR
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
            
            if (sourceLower.includes('mcsettings') || 
                sourceLower.includes('settings') ||
                sourceLower.includes('configuration') ||
                sourceLower.includes('profile') ||
                (event.category === 'System' && event.type === 'plist')) {
                
                const analysis = this.analyzer.analyzePlist(event.data);
                
                if (analysis.suspicious && analysis.suspicious.length > 0) {
                    for (const susp of analysis.suspicious) {
                        results.push(this.createResult(
                            'Suspicious MDM Tool',
                            { source: event.source, timestamp: event.timestamp, tool: susp.tool, path: susp.path },
                            susp.confidence || 'critical'
                        ));
                    }
                }

                if (analysis.network && analysis.network.ips) {
                    for (const ip of analysis.network.ips) {
                        results.push(this.createResult('Network IP Found', { source: event.source, ip: ip.ip }, ip.confidence));
                    }
                }

                if (analysis.network && analysis.network.domains) {
                    for (const domain of analysis.network.domains) {
                        results.push(this.createResult('Domain Found', { source: event.source, domain: domain.domain }, domain.confidence));
                    }
                }

                if (analysis.network && analysis.network.urls) {
                    for (const url of analysis.network.urls) {
                        results.push(this.createResult('URL Found', { source: event.source, url: url.url }, url.confidence));
                    }
                }

                if (analysis.network && analysis.network.vpnIndicators) {
                    for (const vpn of analysis.network.vpnIndicators) {
                        results.push(this.createResult('VPN Indicator', { source: event.source, indicator: vpn.indicator }, vpn.confidence));
                    }
                }

                if (analysis.systemInfo && analysis.systemInfo.certificates) {
                    for (const cert of analysis.systemInfo.certificates) {
                        results.push(this.createResult('Certificate Found', { source: event.source, key: cert.key }, cert.confidence));
                    }
                }
            }
        }

        return results;
    }
}

// ============================================
// 10. ADVANCED PARSER
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
            txt: this.parseLog.bind(this),
            xml: this.parseLog.bind(this),
            csv: this.parseCSV.bind(this),
            ips: this.parseIPS.bind(this)
        };
    }

    async parse(file) {
        const ext = file.extension ? file.extension.replace('.', '') : '';
        const parser = this.parsers[ext];
        if (!parser) {
            Logger.warn(`Parser não encontrado para: ${file.extension}`);
            return this.parseLog(file);
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
        
        for (let i = 0; i < Math.min(lines.length, 10000); i++) {
            try {
                const data = JSON.parse(lines[i]);
                events.push(new EventModel({
                    timestamp: new Date(),
                    source: file.name,
                    category: 'NDJSON',
                    type: 'event',
                    description: `Linha ${i + 1}`,
                    data: data,
                    metadata: { line: i + 1 },
                    raw: lines[i].substring(0, 500)
                }));
            } catch (error) {
                // Ignora linhas com erro
            }
        }
        return events;
    }

    parsePlist(file) {
        const events = [];
        try {
            const content = file.content;
            if (content.includes('<?xml') && content.includes('plist')) {
                const data = {};
                const matches = content.match(/<key>(.*?)<\/key>\s*<([a-z]+)>(.*?)<\/\2>/gs);
                if (matches) {
                    for (const match of matches) {
                        const keyMatch = match.match(/<key>(.*?)<\/key>/);
                        const valueMatch = match.match(/<([a-z]+)>(.*?)<\/\1>/);
                        if (keyMatch && valueMatch) {
                            const key = keyMatch[1];
                            const value = this.parsePlistValue(valueMatch[2], valueMatch[1]);
                            data[key] = value;
                        }
                    }
                }
                if (Object.keys(data).length > 0) {
                    this.extractEventsFromJSON(data, file, events);
                }
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
        
        const headerMatch = content.match(/(?:^|\n)([^\n]+?)(?:\n|$)/);
        if (headerMatch) {
            events.push(new EventModel({
                timestamp: new Date(),
                source: file.name,
                category: 'Crash',
                type: 'crash_header',
                description: `Crash Report: ${headerMatch[1]}`,
                data: { header: headerMatch[1] }
            }));
        }

        const appMatch = content.match(/Application Name:\s*([^\n]+)/i) || content.match(/Process:\s*([^\n]+)/i);
        if (appMatch) {
            events.push(new EventModel({
                timestamp: new Date(),
                source: file.name,
                category: 'Crash',
                type: 'crash_app',
                description: `Aplicativo: ${appMatch[1]}`,
                data: { app: appMatch[1] }
            }));
        }

        const exceptionMatch = content.match(/Exception Type:\s*([^\n]+)/i) || content.match(/Exception:\s*([^\n]+)/i);
        if (exceptionMatch) {
            events.push(new EventModel({
                timestamp: new Date(),
                source: file.name,
                category: 'Crash',
                type: 'crash_exception',
                description: `Exceção: ${exceptionMatch[1]}`,
                data: { exception: exceptionMatch[1] }
            }));
        }

        if (content.toLowerCase().includes('jailbreak') || 
            content.toLowerCase().includes('cydia')) {
            events.push(new EventModel({
                timestamp: new Date(),
                source: file.name,
                category: 'Jailbreak',
                type: 'crash_jailbreak',
                description: 'Indicador de jailbreak no crash report',
                data: { indicator: 'Jailbreak' },
                metadata: { confidence: 'high' }
            }));
        }

        return events;
    }

    parseLog(file) {
        const events = [];
        const lines = file.content.split('\n');
        let count = 0;
        for (const line of lines) {
            if (!line.trim() || count++ > 5000) continue;
            const parsed = this.parseLogLine(line);
            if (parsed) {
                events.push(new EventModel({
                    timestamp: parsed.timestamp || new Date(),
                    source: file.name,
                    category: parsed.category || 'Log',
                    type: parsed.type || 'log',
                    description: parsed.description || line.substring(0, 200),
                    data: { raw: line.substring(0, 500) },
                    metadata: parsed.metadata || {}
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
        if (lower.includes('error') || lower.includes('exception')) {
            result.category = 'Error';
            result.type = 'error';
        } else if (lower.includes('warning')) {
            result.category = 'Warning';
            result.type = 'warning';
        }
        const desc = line.substring(0, 200);
        if (desc) result.description = desc;
        return Object.keys(result).length > 0 ? result : null;
    }

    parseCSV(file) {
        const events = [];
        const lines = file.content.split('\n');
        if (lines.length < 2) return events;
        const headers = lines[0].split(',').map(h => h.trim());
        for (let i = 1; i < Math.min(lines.length, 1000); i++) {
            const values = lines[i].split(',').map(v => v.trim());
            if (values.length === headers.length) {
                const data = {};
                for (let j = 0; j < headers.length; j++) {
                    data[headers[j]] = values[j];
                }
                events.push(new EventModel({
                    timestamp: new Date(),
                    source: file.name,
                    category: 'CSV',
                    type: 'row',
                    description: `Linha ${i}`,
                    data: data,
                    metadata: { row: i },
                    raw: lines[i].substring(0, 500)
                }));
            }
        }
        return events;
    }

    extractEventsFromJSON(obj, file, events, path = 'root') {
        if (typeof obj !== 'object' || obj === null) return;
        if (Array.isArray(obj)) {
            for (let i = 0; i < Math.min(obj.length, 1000); i++) {
                this.extractEventsFromJSON(obj[i], file, events, `${path}[${i}]`);
            }
            return;
        }

        events.push(new EventModel({
            timestamp: new Date(),
            source: file.name,
            category: this.detectCategory(obj),
            type: 'event',
            description: this.generateDescription(obj),
            data: obj,
            metadata: { path: path },
            raw: JSON.stringify(obj).substring(0, 500)
        }));

        for (const [key, value] of Object.entries(obj)) {
            if (typeof value === 'object' && value !== null && Object.keys(value).length < 100) {
                this.extractEventsFromJSON(value, file, events, `${path}.${key}`);
            }
        }
    }

    detectCategory(obj) {
        const str = JSON.stringify(obj).toLowerCase();
        if (str.includes('vpn') || str.includes('wireguard')) return 'VPN';
        if (str.includes('proxy') || str.includes('mitm')) return 'Proxy';
        if (str.includes('cydia') || str.includes('jailbreak')) return 'Jailbreak';
        if (str.includes('freefire') || str.includes('garena')) return 'FreeFire';
        if (str.includes('certificate') || str.includes('ssl')) return 'Certificate';
        if (str.includes('frida') || str.includes('hook')) return 'Hook';
        if (str.includes('altstore') || str.includes('trollstore')) return 'Sideload';
        if (str.includes('mdm') || str.includes('mcsettings')) return 'MDM';
        return 'System';
    }

    generateDescription(obj) {
        if (obj.message) return typeof obj.message === 'string' ? obj.message.substring(0, 200) : String(obj.message);
        if (obj.description) return typeof obj.description === 'string' ? obj.description.substring(0, 200) : String(obj.description);
        if (obj.title) return typeof obj.title === 'string' ? obj.title.substring(0, 200) : String(obj.title);
        if (obj.name) return typeof obj.name === 'string' ? obj.name.substring(0, 200) : String(obj.name);
        return JSON.stringify(obj).substring(0, 100);
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
            Logger.warn('Detector inválido');
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
            apps: ['mitmproxy', 'charles', 'burp', 'fiddler', 'proxyman', 'surge', 'quantumult', 'shadowrocket', 'potatso', 'loon'],
            bundleIds: ['com.charles.proxy', 'com.burp', 'com.proxyman', 'com.surge'],
            keywords: ['proxy', 'mitm', 'intercept', 'ssl interception']
        };
    }

    detect(events) {
        const results = [];
        for (const event of events) {
            const str = JSON.stringify(event).toLowerCase();
            let found = false;
            let details = [];

            for (const app of this.patterns.apps) {
                if (str.includes(app.toLowerCase())) {
                    details.push(`App: ${app}`);
                    found = true;
                }
            }

            for (const keyword of this.patterns.keywords) {
                if (str.includes(keyword.toLowerCase())) {
                    details.push(`Keyword: ${keyword}`);
                    found = true;
                }
            }

            if (found && details.length > 0) {
                results.push(this.createResult(
                    'Proxy Evidence',
                    { source: event.source, details: details.join('; ') },
                    details.length >= 2 ? 'high' : 'medium'
                ));
            }
        }
        return results;
    }
}

class AdvancedVPNDetector extends BaseDetector {
    constructor() {
        super('Advanced VPN Detector');
        this.vpnKeywords = ['vpn', 'tunnel', 'wireguard', 'openvpn', 'ikev2', 'l2tp', 'pptp', 'ipsec'];
    }

    detect(events) {
        const results = [];
        for (const event of events) {
            const str = JSON.stringify(event).toLowerCase();
            for (const keyword of this.vpnKeywords) {
                if (str.includes(keyword)) {
                    results.push(this.createResult(
                        'VPN Evidence',
                        { source: event.source, keyword: keyword },
                        'high'
                    ));
                    break;
                }
            }
        }
        return results;
    }
}

class AdvancedJailbreakDetector extends BaseDetector {
    constructor() {
        super('Advanced Jailbreak Detector');
        this.jailbreakIndicators = ['cydia', 'sileo', 'zebra', 'procursus', 'ellekit', 'substrate', 'substitute'];
    }

    detect(events) {
        const results = [];
        for (const event of events) {
            const str = JSON.stringify(event).toLowerCase();
            for (const indicator of this.jailbreakIndicators) {
                if (str.includes(indicator)) {
                    results.push(this.createResult(
                        'Jailbreak Evidence',
                        { source: event.source, indicator: indicator },
                        'critical'
                    ));
                    break;
                }
            }
        }
        return results;
    }
}

class AdvancedSideloadDetector extends BaseDetector {
    constructor() {
        super('Advanced Sideload Detector');
        this.sideloadIndicators = ['altstore', 'trollstore', 'sidestore', 'scarlet', 'esign'];
    }

    detect(events) {
        const results = [];
        for (const event of events) {
            const str = JSON.stringify(event).toLowerCase();
            for (const indicator of this.sideloadIndicators) {
                if (str.includes(indicator)) {
                    results.push(this.createResult(
                        'Sideload Evidence',
                        { source: event.source, indicator: indicator },
                        'high'
                    ));
                    break;
                }
            }
        }
        return results;
    }
}

class AdvancedHookDetector extends BaseDetector {
    constructor() {
        super('Advanced Hook Detector');
        this.hookIndicators = ['frida', 'cycript', 'hook', 'inject'];
    }

    detect(events) {
        const results = [];
        for (const event of events) {
            const str = JSON.stringify(event).toLowerCase();
            for (const indicator of this.hookIndicators) {
                if (str.includes(indicator)) {
                    results.push(this.createResult(
                        'Hook Evidence',
                        { source: event.source, indicator: indicator },
                        'high'
                    ));
                    break;
                }
            }
        }
        return results;
    }
}

class AdvancedFreeFireDetector extends BaseDetector {
    constructor() {
        super('Advanced FreeFire Detector');
    }

    detect(events) {
        const results = [];
        for (const event of events) {
            const str = JSON.stringify(event).toLowerCase();
            if (str.includes('freefire') || str.includes('garena') || str.includes('ff ')) {
                results.push(this.createResult(
                    'FreeFire Evidence',
                    { source: event.source },
                    'medium'
                ));
            }
        }
        return results;
    }
}

class AdvancedCertificateDetector extends BaseDetector {
    constructor() {
        super('Advanced Certificate Detector');
        this.certIndicators = ['certificate', 'trust', 'ssl', 'pem', 'crt'];
    }

    detect(events) {
        const results = [];
        for (const event of events) {
            const str = JSON.stringify(event).toLowerCase();
            for (const indicator of this.certIndicators) {
                if (str.includes(indicator)) {
                    results.push(this.createResult(
                        'Certificate Evidence',
                        { source: event.source, indicator: indicator },
                        'medium'
                    ));
                    break;
                }
            }
        }
        return results;
    }
}

// ============================================
// 13. CORRELATION ENGINE
// ============================================

class CorrelationEngine {
    constructor() {
        this.rules = [
            this.correlateMultipleCategories.bind(this),
            this.correlateTiming.bind(this)
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
                Logger.error(`Erro na correlação: ${error.message}`);
            }
        }
        return correlations;
    }

    correlateMultipleCategories(events) {
        const correlations = [];
        const categories = {};
        for (const event of events) {
            const cat = event.category || 'Unknown';
            if (!categories[cat]) categories[cat] = [];
            categories[cat].push(event);
        }

        const present = Object.keys(categories).filter(c => categories[c].length > 0);
        if (present.length >= 3) {
            correlations.push({
                type: 'multiple_categories',
                description: `${present.length} categorias detectadas: ${present.join(', ')}`,
                confidence: 'high',
                events: present.map(c => categories[c][0])
            });
        }
        return correlations;
    }

    correlateTiming(events) {
        const correlations = [];
        const sorted = events.filter(e => e.timestamp).sort((a, b) => a.timestamp - b.timestamp);
        
        for (let i = 0; i < sorted.length - 2; i++) {
            const diff1 = sorted[i+1].timestamp - sorted[i].timestamp;
            const diff2 = sorted[i+2].timestamp - sorted[i+1].timestamp;
            if (diff1 < 60000 && diff2 < 60000) {
                correlations.push({
                    type: 'temporal_sequence',
                    description: `Sequência: ${sorted[i].category} → ${sorted[i+1].category} → ${sorted[i+2].category}`,
                    confidence: 'medium',
                    events: [sorted[i], sorted[i+1], sorted[i+2]]
                });
                break;
            }
        }
        return correlations;
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
        this.thresholds = { low: 50, medium: 100, high: 200, critical: 300 };
    }

    calculate(evidences) {
        let totalScore = 0;
        const byCategory = {};
        const byConfidence = { critical: 0, high: 0, medium: 0, low: 0 };

        for (const evidence of evidences) {
            const baseScore = this.weights[evidence.confidence] || 25;
            totalScore += baseScore;

            const category = evidence.category || 'Unknown';
            if (!byCategory[category]) {
                byCategory[category] = { count: 0, score: 0 };
            }
            byCategory[category].count++;
            byCategory[category].score += baseScore;
            
            if (evidence.confidence in byConfidence) {
                byConfidence[evidence.confidence]++;
            }
        }

        const finalScore = Math.min(totalScore, 1000);

        let riskLevel = 'low';
        if (finalScore >= this.thresholds.critical) riskLevel = 'critical';
        else if (finalScore >= this.thresholds.high) riskLevel = 'high';
        else if (finalScore >= this.thresholds.medium) riskLevel = 'medium';

        return {
            total: Math.round(finalScore),
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
        if (score.byCategory?.Jailbreak) {
            recommendations.push('📱 Verificar presença de ferramentas de jailbreak');
        }
        if (score.byCategory?.Proxy) {
            recommendations.push('🌐 Investigar ferramentas de proxy detectadas');
        }
        if (score.byCategory?.Sideload) {
            recommendations.push('📲 Verificar aplicativos sideload instalados');
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
        this.timestamp = data.timestamp || new Date();
        this.confidence = data.confidence || 'medium';
        this.description = data.description || '';
        this.category = data.category || 'System';
        this.raw = data.raw || null;
    }

    generateId() {
        return 'ev_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    }
}

// ============================================
// 17. UI
// ============================================

class ScriptableUI {
    constructor(scanner) {
        this.scanner = scanner;
        this.progress = 0;
    }

    async showMainMenu() {
        const alert = new Alert();
        alert.title = '🔍 iOS Evidence Scanner';
        alert.message = `v2.2.0\n\nScanner forense para análise de evidências em arquivos iOS`;
        alert.addAction('🔍 Nova Análise');
        alert.addAction('⚙️ Configurações');
        alert.addAction('📖 Ajuda');
        alert.addAction('❌ Sair');
        return await alert.presentAlert();
    }

    async selectFiles() {
        if (!this.scanner || !this.scanner.fileLoader) {
            throw new Error('FileLoader não disponível');
        }
        return await this.scanner.fileLoader.selectFiles(true);
    }

    async showFileInfo(files) {
        if (!files || files.length === 0) return false;
        
        let message = `📂 ${files.length} arquivo(s) selecionado(s):\n\n`;
        let totalSize = 0;
        
        for (const file of files) {
            const size = this.scanner?.fileLoader?.formatFileSize(file.size) || '?';
            totalSize += file.size || 0;
            message += `📄 ${file.name}\n   Tipo: ${file.type || 'Desconhecido'} • Tamanho: ${size}\n\n`;
        }
        
        message += `📊 Total: ${this.scanner?.fileLoader?.formatFileSize(totalSize)}`;
        
        const alert = new Alert();
        alert.title = '📂 Arquivos Selecionados';
        alert.message = message + '\n\nDeseja iniciar a análise?';
        alert.addAction('✅ Iniciar Análise');
        alert.addAction('❌ Cancelar');
        
        return await alert.presentAlert() === 0;
    }

    async showProgress(current, total, message) {
        this.progress = (current / total) * 100;
        const percentage = Math.round(this.progress);
        const bar = '█'.repeat(Math.round(percentage/5)) + '░'.repeat(20 - Math.round(percentage/5));
        
        console.log(`${percentage}% - ${message}`);
        
        if (percentage % 20 === 0 || percentage === 100) {
            const alert = new Alert();
            alert.title = '🔄 Processando...';
            alert.message = `${message}\n\n${bar}\n${percentage}% concluído (${current}/${total})`;
            if (percentage >= 100) {
                alert.addAction('✅ Concluído!');
                await alert.presentAlert();
            } else {
                alert.presentAlert().catch(() => {});
            }
        }
    }

    async showReport(report) {
        const webView = new WebView();
        webView.title = '📊 Relatório de Análise';
        webView.loadHTML(this.generateReportHTML(report));
        await webView.present(true);
    }

    generateReportHTML(report) {
        return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>iOS Evidence Scanner - Relatório</title>
<style>
body { font-family: -apple-system, BlinkMacSystemFont, sans-serif; background: #f5f5f5; color: #333; padding: 20px; }
.container { max-width: 800px; margin: 0 auto; background: white; padding: 30px; border-radius: 10px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
h1 { color: #007aff; font-size: 24px; }
.score { font-size: 48px; font-weight: bold; color: #007aff; }
.risk { padding: 10px 20px; border-radius: 20px; display: inline-block; font-weight: bold; }
.risk-critical { background: #ff3b30; color: white; }
.risk-high { background: #ff9500; color: white; }
.risk-medium { background: #ffcc00; color: #000; }
.risk-low { background: #34c759; color: white; }
.detection { background: #f8f9fa; padding: 10px; border-radius: 5px; margin: 5px 0; border-left: 4px solid #007aff; }
.confidence-critical { border-left-color: #ff3b30; }
.confidence-high { border-left-color: #ff9500; }
.confidence-medium { border-left-color: #ffcc00; }
.stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(100px, 1fr)); gap: 10px; margin: 20px 0; }
.stat-box { background: #f8f9fa; padding: 10px; border-radius: 5px; text-align: center; }
</style>
</head>
<body>
<div class="container">
    <h1>🔍 ${report.appName || 'iOS Evidence Scanner'}</h1>
    <p>Versão: ${report.version || '2.2.0'} • ${new Date(report.generated).toLocaleString('pt-BR')}</p>
    
    <div style="display:flex; justify-content:space-between; align-items:center; margin:20px 0;">
        <div><span class="score">${report.score}</span><br>Score</div>
        <div><span class="risk risk-${report.riskLevel}">${(report.riskLevel || 'low').toUpperCase()}</span></div>
    </div>
    
    <div class="stats">
        <div class="stat-box">${report.totalEvents}<br>Eventos</div>
        <div class="stat-box">${report.totalDetections}<br>Detecções</div>
        <div class="stat-box">${report.totalCorrelations || 0}<br>Correlações</div>
    </div>
    
    ${report.detections && report.detections.length > 0 ? `
    <h2>🔎 Detecções</h2>
    ${report.detections.slice(0, 50).map(d => `
        <div class="detection confidence-${d.confidence || 'low'}">
            <strong>${d.type || 'Detecção'}</strong> [${(d.confidence || 'low').toUpperCase()}]
            <br><span style="color:#666;font-size:14px;">${d.explanation || ''}</span>
            ${d.evidence?.source ? `<br><span style="color:#999;font-size:12px;">📁 ${d.evidence.source}</span>` : ''}
        </div>
    `).join('')}
    ${report.detections.length > 50 ? `<p style="color:#999;">... e mais ${report.detections.length - 50} detecções</p>` : ''}
    ` : ''}
    
    ${report.recommendations && report.recommendations.length > 0 ? `
    <h2>💡 Recomendações</h2>
    <ul>${report.recommendations.map(r => `<li>${r}</li>`).join('')}</ul>
    ` : ''}
</div>
</body>
</html>`;
    }

    async showStats(stats) {
        const alert = new Alert();
        alert.title = '📊 Estatísticas';
        alert.message = `
📈 Resumo:
  Eventos: ${stats.totalEvents}
  Detecções: ${stats.totalDetections}
  Correlações: ${stats.totalCorrelations}
  Tempo: ${(stats.executionTime / 1000).toFixed(2)}s

📁 Arquivos: ${stats.fileCount || 0}

🔍 Confiança:
  Crítico: ${stats.byConfidence?.critical || 0}
  Alta: ${stats.byConfidence?.high || 0}
  Média: ${stats.byConfidence?.medium || 0}
  Baixa: ${stats.byConfidence?.low || 0}
        `;
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
                ul { padding-left: 20px; }
                li { margin: 10px 0; }
                .format-tag { background: #e5e5e5; padding: 2px 10px; border-radius: 12px; font-size: 12px; display: inline-block; margin: 2px; }
            </style>
            </head>
            <body>
            <div class="container">
                <h1>📖 iOS Evidence Scanner v2.2</h1>
                <h2>🔍 O que faz?</h2>
                <p>Analisa arquivos do sistema iOS em busca de evidências técnicas.</p>
                
                <h2>📁 Formatos</h2>
                <p>
                    <span class="format-tag">PLIST</span>
                    <span class="format-tag">JSON</span>
                    <span class="format-tag">NDJSON</span>
                    <span class="format-tag">IPS</span>
                    <span class="format-tag">LOG</span>
                    <span class="format-tag">CSV</span>
                    <span class="format-tag">XML</span>
                    <span class="format-tag">TXT</span>
                </p>
                
                <h2>🔎 Detectores</h2>
                <ul>
                    <li>🛡️ Proxy</li>
                    <li>🔒 VPN</li>
                    <li>📱 Jailbreak</li>
                    <li>📲 Sideload</li>
                    <li>🎣 Hook/Frida</li>
                    <li>🎮 Free Fire</li>
                    <li>🔐 Certificados</li>
                    <li>📋 MDM</li>
                </ul>
            </div>
            </body></html>
        `);
        await webView.present(true);
    }
}

// ============================================
// 18. APPLICATION
// ============================================

class Application {
    constructor() {
        this.configManager = new ConfigManager();
        this.fileLoader = new ScriptableFileLoader(this.configManager);
        this.parser = new AdvancedParser();
        this.detectorManager = new DetectorManager();
        this.correlationEngine = new CorrelationEngine();
        this.statisticsEngine = new StatisticsEngine();
        this.scoreEngine = new ScoreEngine();
        this.ui = new ScriptableUI(this);
        
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
                    case 0: await this.runAnalysis(); break;
                    case 1: await this.showSettings(); break;
                    case 2: await this.ui.showHelp(); break;
                    case 3: return;
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
                await this.ui.showError(new Error('Nenhum arquivo selecionado'));
                return;
            }

            const confirmed = await this.ui.showFileInfo(files);
            if (!confirmed) return;

            this.startTime = Date.now();
            this.events = [];
            this.detections = [];
            this.correlations = [];

            const totalFiles = files.length;
            let processedFiles = 0;

            for (const file of files) {
                await this.ui.showProgress(processedFiles, totalFiles, `Analisando: ${file.name}`);
                const parsedEvents = await this.parser.parse(file);
                this.events.push(...parsedEvents);
                processedFiles++;
            }

            await this.ui.showProgress(1, 1, 'Executando detectores...');
            this.detections = this.detectorManager.analyze(this.events);

            await this.ui.showProgress(1, 1, 'Correlacionando eventos...');
            this.correlations = this.correlationEngine.correlate(this.events);

            const score = this.scoreEngine.calculate(this.detections);
            const stats = this.statisticsEngine.analyze(this.events, this.detections, this.correlations);

            this.endTime = Date.now();

            const report = {
                appName: this.configManager.get('appName'),
                version: this.configManager.get('version'),
                generated: new Date().toISOString(),
                totalEvents: this.events.length,
                totalDetections: this.detections.length,
                totalCorrelations: this.correlations.length,
                score: score.total,
                riskLevel: score.riskLevel,
                statistics: stats,
                detections: this.detections,
                correlations: this.correlations,
                recommendations: this.scoreEngine.getRecommendations(score),
                files: files.map(f => ({ name: f.name, size: f.size }))
            };

            await this.ui.showReport(report);

            const statsData = {
                totalEvents: this.events.length,
                totalDetections: this.detections.length,
                totalCorrelations: this.correlations.length,
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

            // Exportar relatório
            const exportAlert = new Alert();
            exportAlert.title = '📥 Exportar Relatório';
            exportAlert.message = 'Deseja exportar o relatório?';
            exportAlert.addAction('Sim');
            exportAlert.addAction('Não');
            if (await exportAlert.presentAlert() === 0) {
                await this.exportReport(report);
            }

        } catch (error) {
            await this.ui.showError(error);
        }
    }

    async exportReport(report) {
        try {
            const fm = FileManager.iCloud();
            const docs = fm.documentsDirectory();
            
            const html = this.ui.generateReportHTML(report);
            const filename = `evidence_report_${Date.now()}.html`;
            const path = fm.joinPath(docs, filename);
            fm.writeString(path, html);
            
            await this.ui.showSuccess(`Relatório exportado para:\n${docs}`);
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
        }
    }
}

// ============================================
// 19. PONTO DE ENTRADA
// ============================================

(async () => {
    try {
        const app = new Application();
        await app.run();
    } catch (error) {
        console.error('Erro fatal:', error.message);
        const alert = new Alert();
        alert.title = '❌ Erro Fatal';
        alert.message = `Ocorreu um erro:\n\n${error.message}`;
        alert.addAction('OK');
        await alert.presentAlert();
    }
})();
