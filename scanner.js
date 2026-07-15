// ============================================
// iOS EVIDENCE SCANNER - VERSÃO COMPLETA COM DETECTORES APRIMORADOS
// ============================================

// ============================================
// 1. CONFIGURATION MANAGER
// ============================================

class ConfigManager {
    constructor() {
        this.config = {
            appName: 'iOS Evidence Scanner',
            version: '2.0.0',
            maxFileSize: 50 * 1024 * 1024,
            supportedExtensions: ['.plist', '.log', '.txt', '.json', '.ips', '.csv', '.xml', '.tracev3'],
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
            '.plist': '📋', '.json': '📊', '.log': '📝',
            '.txt': '📄', '.csv': '📈', '.xml': '📋',
            '.ips': '💥', '.tracev3': '🔍'
        };
        return iconMap[extension] || '📁';
    }

    getSelectedFiles() { return this.selectedFiles; }
    clearCache() { this.cacheManager.clear(); this.selectedFiles = []; }
}

// ============================================
// 7. ADVANCED PARSER
// ============================================

class AdvancedParser {
    constructor() {
        this.parsers = {
            json: this.parseJSON.bind(this),
            plist: this.parsePlist.bind(this),
            log: this.parseLog.bind(this),
            txt: this.parseText.bind(this),
            xml: this.parseXML.bind(this),
            csv: this.parseCSV.bind(this)
        };
    }

    async parse(file) {
        const parser = this.parsers[file.extension.replace('.', '')];
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
                metadata: { path: path, confidence: eventData.confidence || 'medium' }
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
        for (const key of ['timestamp', 'date', 'time', 'created', 'modified', 'eventTime']) {
            if (obj[key]) {
                const date = DateUtils.parseTimestamp(obj[key]);
                if (date) { result.timestamp = date; break; }
            }
        }
        for (const key of ['type', 'event', 'action', 'operation']) {
            if (obj[key]) { result.type = String(obj[key]); break; }
        }
        for (const key of ['description', 'message', 'title', 'text', 'content']) {
            if (obj[key]) { result.description = String(obj[key]); break; }
        }
        return (result.timestamp || result.description) ? result : null;
    }

    parsePlist(file) {
        const events = [];
        try {
            const content = file.content;
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
                        metadata: { row: i }
                    }));
                }
            }
        }
        return events;
    }

    detectCategory(obj) {
        const str = JSON.stringify(obj).toLowerCase();
        if (str.includes('vpn') || str.includes('wireguard') || str.includes('openvpn')) return 'VPN';
        if (str.includes('proxy') || str.includes('mitm') || str.includes('charles')) return 'Proxy';
        if (str.includes('cydia') || str.includes('jailbreak') || str.includes('sileo')) return 'Jailbreak';
        if (str.includes('freefire') || str.includes('garena')) return 'FreeFire';
        if (str.includes('appstore') || str.includes('app store')) return 'AppStore';
        if (str.includes('certificate') || str.includes('trust')) return 'Certificate';
        if (str.includes('developer') || str.includes('xcode')) return 'Development';
        if (str.includes('crash') || str.includes('exception')) return 'Crash';
        if (str.includes('frida') || str.includes('hook') || str.includes('inject')) return 'Hook';
        if (str.includes('altstore') || str.includes('trollstore') || str.includes('sideload')) return 'Sideload';
        return 'System';
    }

    generateDescription(obj) {
        if (obj.message) return obj.message;
        if (obj.description) return obj.description;
        if (obj.title) return obj.title;
        if (obj.name) return obj.name;
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
// 9. DETECTOR MANAGER
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
// 10. ADVANCED DETECTORS
// ============================================

// 10.1 ADVANCED PROXY DETECTOR
class AdvancedProxyDetector extends BaseDetector {
    constructor() {
        super('Advanced Proxy Detector');
        this.patterns = {
            apps: ['mitmproxy', 'charles', 'burp', 'fiddler', 'proxyman', 'http catcher', 'surge', 'quantumult', 'shadowrocket', 'potatso', 'loon'],
            configFiles: ['proxy.pac', 'proxy.conf', 'proxy.config', 'mitmproxy', 'charles.log', 'burp.log', 'proxyman.log', 'surge.conf', 'quantumult.conf', 'shadowrocket.conf'],
            bundleIds: ['com.charles.proxy', 'com.burp', 'com.proxyman', 'com.surge', 'com.quantumult', 'com.shadowrocket'],
            networkPatterns: ['proxy', 'mitm', 'intercept', 'ssl interception', 'certificate pinning', 'ssl proxy', 'http proxy', 'socks proxy', 'proxy settings', 'proxy configuration'],
            ports: ['8080', '8888', '8090', '3128', '8081', '8889'],
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

            if (event.category === 'Log' || event.type === 'log') {
                if (str.includes('proxy') || str.includes('mitm') || str.includes('intercept')) {
                    details.push(`Log com evidência de proxy`);
                    found = true;
                    proxyIndicators.push({ type: 'log', value: event.description, event: event });
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

// 10.2 ADVANCED VPN DETECTOR
class AdvancedVPNDetector extends BaseDetector {
    constructor() {
        super('Advanced VPN Detector');
        this.patterns = {
            apps: ['wireguard', 'openvpn', 'ikev2', 'l2tp', 'pptp', 'ipsec'],
            configFiles: ['vpn.conf', 'wg.conf', 'ovpn', 'openvpn.conf', 'ikev2.conf'],
            bundleIds: ['com.wireguard', 'com.openvpn', 'com.apple.networkextension'],
            processes: ['packettunnel', 'networkextension', 'vpn', 'wireguard', 'openvpn', 'iked'],
            networkPatterns: ['vpn', 'tunnel', 'encrypted tunnel', 'vpn connection', 'ppp', 'l2tp', 'ipsec', 'ikev2', 'wireguard']
        };
    }

    detect(events) {
        const results = [];
        let vpnIndicators = [];

        for (const event of events) {
            const str = JSON.stringify(event).toLowerCase();
            let found = false;

            for (const app of this.patterns.apps) {
                if (str.includes(app.toLowerCase())) {
                    results.push(this.createResult('VPN App', {
                        source: event.source,
                        timestamp: event.timestamp,
                        app: app
                    }, 'high'));
                    found = true;
                    vpnIndicators.push({ type: 'app', value: app });
                }
            }

            for (const config of this.patterns.configFiles) {
                if (str.includes(config.toLowerCase())) {
                    results.push(this.createResult('VPN Config', {
                        source: event.source,
                        timestamp: event.timestamp,
                        config: config
                    }, 'high'));
                    found = true;
                    vpnIndicators.push({ type: 'config', value: config });
                }
            }

            for (const process of this.patterns.processes) {
                if (str.includes(process.toLowerCase())) {
                    results.push(this.createResult('VPN Process', {
                        source: event.source,
                        timestamp: event.timestamp,
                        process: process
                    }, 'high'));
                    found = true;
                    vpnIndicators.push({ type: 'process', value: process });
                }
            }

            if (event.category === 'Network' || event.type === 'network') {
                for (const pattern of this.patterns.networkPatterns) {
                    if (str.includes(pattern.toLowerCase())) {
                        results.push(this.createResult('VPN Network', {
                            source: event.source,
                            timestamp: event.timestamp,
                            pattern: pattern
                        }, 'medium'));
                        found = true;
                        vpnIndicators.push({ type: 'network', value: pattern });
                    }
                }
            }

            if (str.includes('networkextension') || str.includes('packettunnel')) {
                results.push(this.createResult('VPN NetworkExtension', {
                    source: event.source,
                    timestamp: event.timestamp,
                    details: 'NetworkExtension detectado'
                }, 'high'));
                vpnIndicators.push({ type: 'ios_vpn', value: 'NetworkExtension' });
            }
        }

        if (vpnIndicators.length >= 2) {
            results.push({
                detector: this.name,
                type: 'Multiple VPN Indicators',
                evidence: vpnIndicators,
                confidence: 'high',
                timestamp: new Date(),
                explanation: `${vpnIndicators.length} indicadores de VPN detectados`
            });
        }

        return results;
    }
}

// 10.3 ADVANCED JAILBREAK DETECTOR
class AdvancedJailbreakDetector extends BaseDetector {
    constructor() {
        super('Advanced Jailbreak Detector');
        this.patterns = {
            apps: ['cydia', 'sileo', 'zebra', 'procursus', 'ellekit', 'substitute', 'substrate'],
            files: ['cydia.log', 'jailbreak.plist', 'procursus', 'substrate', 'mobile_substrate'],
            bundleIds: ['com.saurik.cydia', 'org.coolstar.sileo', 'com.zebra'],
            processes: ['jailbreakd', 'substituted', 'cydia', 'sileo', 'zebra', 'ellekit'],
            paths: ['/var/jb/', '/jb/', '/.jailbreak', '/var/lib/cydia'],
            systemFiles: ['/.cydia_', '/.sileo_', '/.procursus_']
        };
    }

    detect(events) {
        const results = [];
        let jbIndicators = [];

        for (const event of events) {
            const str = JSON.stringify(event).toLowerCase();
            let found = false;

            for (const app of this.patterns.apps) {
                if (str.includes(app.toLowerCase())) {
                    results.push(this.createResult('Jailbreak App', {
                        source: event.source,
                        timestamp: event.timestamp,
                        app: app
                    }, 'critical'));
                    found = true;
                    jbIndicators.push({ type: 'app', value: app });
                }
            }

            for (const file of this.patterns.files) {
                if (str.includes(file.toLowerCase())) {
                    results.push(this.createResult('Jailbreak File', {
                        source: event.source,
                        timestamp: event.timestamp,
                        file: file
                    }, 'critical'));
                    found = true;
                    jbIndicators.push({ type: 'file', value: file });
                }
            }

            for (const process of this.patterns.processes) {
                if (str.includes(process.toLowerCase())) {
                    results.push(this.createResult('Jailbreak Process', {
                        source: event.source,
                        timestamp: event.timestamp,
                        process: process
                    }, 'critical'));
                    found = true;
                    jbIndicators.push({ type: 'process', value: process });
                }
            }

            for (const path of this.patterns.paths) {
                if (str.includes(path.toLowerCase())) {
                    results.push(this.createResult('Jailbreak Path', {
                        source: event.source,
                        timestamp: event.timestamp,
                        path: path
                    }, 'critical'));
                    found = true;
                    jbIndicators.push({ type: 'path', value: path });
                }
            }

            for (const sysFile of this.patterns.systemFiles) {
                if (str.includes(sysFile.toLowerCase())) {
                    results.push(this.createResult('Jailbreak System File', {
                        source: event.source,
                        timestamp: event.timestamp,
                        file: sysFile
                    }, 'critical'));
                    found = true;
                    jbIndicators.push({ type: 'system_file', value: sysFile });
                }
            }
        }

        if (jbIndicators.length >= 2) {
            results.push({
                detector: this.name,
                type: 'Multiple Jailbreak Indicators',
                evidence: jbIndicators,
                confidence: 'critical',
                timestamp: new Date(),
                explanation: `${jbIndicators.length} indicadores de jailbreak detectados`
            });
        }

        return results;
    }
}

// 10.4 ADVANCED SIDELOAD DETECTOR
class AdvancedSideloadDetector extends BaseDetector {
    constructor() {
        super('Advanced Sideload Detector');
        this.patterns = {
            apps: ['altstore', 'trollstore', 'sidestore', 'scarlet', 'esign', 'feather', 'sideloadly'],
            files: ['altstore.plist', 'trollstore', 'provisioning', 'mobileprovision'],
            bundleIds: ['com.altstore', 'com.opa334.trollstore', 'com.sidestore'],
            processes: ['altstore', 'trollstore', 'sidestore', 'sideloadly'],
            patterns: ['provisioning profile', 'adhoc', 'enterprise certificate', 'sideload']
        };
    }

    detect(events) {
        const results = [];
        let sideloadIndicators = [];

        for (const event of events) {
            const str = JSON.stringify(event).toLowerCase();
            let found = false;

            for (const app of this.patterns.apps) {
                if (str.includes(app.toLowerCase())) {
                    results.push(this.createResult('Sideload App', {
                        source: event.source,
                        timestamp: event.timestamp,
                        app: app
                    }, 'high'));
                    found = true;
                    sideloadIndicators.push({ type: 'app', value: app });
                }
            }

            for (const file of this.patterns.files) {
                if (str.includes(file.toLowerCase())) {
                    results.push(this.createResult('Sideload File', {
                        source: event.source,
                        timestamp: event.timestamp,
                        file: file
                    }, 'high'));
                    found = true;
                    sideloadIndicators.push({ type: 'file', value: file });
                }
            }

            for (const pattern of this.patterns.patterns) {
                if (str.includes(pattern.toLowerCase())) {
                    results.push(this.createResult('Sideload Pattern', {
                        source: event.source,
                        timestamp: event.timestamp,
                        pattern: pattern
                    }, 'medium'));
                    found = true;
                    sideloadIndicators.push({ type: 'pattern', value: pattern });
                }
            }
        }

        if (sideloadIndicators.length >= 2) {
            results.push({
                detector: this.name,
                type: 'Multiple Sideload Indicators',
                evidence: sideloadIndicators,
                confidence: 'high',
                timestamp: new Date(),
                explanation: `${sideloadIndicators.length} indicadores de sideload detectados`
            });
        }

        return results;
    }
}

// 10.5 ADVANCED HOOK DETECTOR
class AdvancedHookDetector extends BaseDetector {
    constructor() {
        super('Advanced Hook Detector');
        this.patterns = {
            tools: ['frida', 'cycript', 'gdb', 'lldb', 'fishhook', 'substrate'],
            files: ['frida.log', 'frida.json', '.frida', 'cycript.js'],
            processes: ['frida-server', 'frida-gadget', 'cycript', 'gdb'],
            patterns: ['interpose', 'hook', 'inject', 'dylib injection', 'frida-agent'],
            bundleIds: ['re.frida', 'com.frida']
        };
    }

    detect(events) {
        const results = [];

        for (const event of events) {
            const str = JSON.stringify(event).toLowerCase();
            let found = false;

            for (const tool of this.patterns.tools) {
                if (str.includes(tool.toLowerCase())) {
                    results.push(this.createResult('Hook Tool', {
                        source: event.source,
                        timestamp: event.timestamp,
                        tool: tool
                    }, 'critical'));
                    found = true;
                }
            }

            for (const file of this.patterns.files) {
                if (str.includes(file.toLowerCase())) {
                    results.push(this.createResult('Hook File', {
                        source: event.source,
                        timestamp: event.timestamp,
                        file: file
                    }, 'critical'));
                    found = true;
                }
            }

            for (const process of this.patterns.processes) {
                if (str.includes(process.toLowerCase())) {
                    results.push(this.createResult('Hook Process', {
                        source: event.source,
                        timestamp: event.timestamp,
                        process: process
                    }, 'critical'));
                    found = true;
                }
            }

            for (const pattern of this.patterns.patterns) {
                if (str.includes(pattern.toLowerCase())) {
                    results.push(this.createResult('Hook Pattern', {
                        source: event.source,
                        timestamp: event.timestamp,
                        pattern: pattern
                    }, 'high'));
                    found = true;
                }
            }
        }

        return results;
    }
}

// 10.6 ADVANCED FREE FIRE DETECTOR
class AdvancedFreeFireDetector extends BaseDetector {
    constructor() {
        super('Advanced Free Fire Detector');
        this.patterns = {
            bundleIds: ['com.garena.game.ff', 'com.garena.game.freefire', 'com.garena.game.freefirebr'],
            processes: ['freefire', 'garena', 'ff'],
            files: ['freefire.log', 'ff_', 'garena.log'],
            patterns: ['free fire', 'garena', 'ff', 'battle royale'],
            crashPatterns: ['freefire crash', 'ff crash', 'garena crash'],
            analytics: ['freefire_analytics', 'ff_analytics']
        };
    }

    detect(events) {
        const results = [];
        let ffEvents = [];

        for (const event of events) {
            const str = JSON.stringify(event).toLowerCase();
            let found = false;

            for (const bundleId of this.patterns.bundleIds) {
                if (str.includes(bundleId.toLowerCase())) {
                    results.push(this.createResult('Free Fire Bundle', {
                        source: event.source,
                        timestamp: event.timestamp,
                        bundleId: bundleId
                    }, 'high'));
                    found = true;
                    ffEvents.push({ type: 'bundle', value: bundleId });
                }
            }

            for (const process of this.patterns.processes) {
                if (str.includes(process.toLowerCase())) {
                    results.push(this.createResult('Free Fire Process', {
                        source: event.source,
                        timestamp: event.timestamp,
                        process: process
                    }, 'high'));
                    found = true;
                    ffEvents.push({ type: 'process', value: process });
                }
            }

            for (const file of this.patterns.files) {
                if (str.includes(file.toLowerCase())) {
                    results.push(this.createResult('Free Fire File', {
                        source: event.source,
                        timestamp: event.timestamp,
                        file: file
                    }, 'medium'));
                    found = true;
                    ffEvents.push({ type: 'file', value: file });
                }
            }

            for (const pattern of this.patterns.patterns) {
                if (str.includes(pattern.toLowerCase())) {
                    results.push(this.createResult('Free Fire Pattern', {
                        source: event.source,
                        timestamp: event.timestamp,
                        pattern: pattern
                    }, 'medium'));
                    found = true;
                    ffEvents.push({ type: 'pattern', value: pattern });
                }
            }

            if (event.category === 'Crash' || event.type === 'crash') {
                for (const crash of this.patterns.crashPatterns) {
                    if (str.includes(crash.toLowerCase())) {
                        results.push(this.createResult('Free Fire Crash', {
                            source: event.source,
                            timestamp: event.timestamp,
                            crash: crash
                        }, 'high'));
                        found = true;
                        ffEvents.push({ type: 'crash', value: crash });
                    }
                }
            }
        }

        if (ffEvents.length >= 3) {
            results.push({
                detector: this.name,
                type: 'Multiple Free Fire Activities',
                evidence: ffEvents,
                confidence: 'high',
                timestamp: new Date(),
                explanation: `${ffEvents.length} eventos relacionados ao Free Fire detectados`
            });
        }

        return results;
    }
}

// 10.7 ADVANCED CERTIFICATE DETECTOR
class AdvancedCertificateDetector extends BaseDetector {
    constructor() {
        super('Advanced Certificate Detector');
        this.patterns = {
            types: ['certificate', 'trust', 'ssl', 'tls', 'ca', 'root ca'],
            mitmCerts: ['portswigger ca', 'charles ca', 'burp ca', 'mitmproxy ca', 'proxyman ca'],
            enterpriseCerts: ['enterprise certificate', 'in-house certificate', 'distribution certificate'],
            files: ['certificate.pem', 'certificate.crt', 'truststore', 'ca.crt'],
            patterns: ['self-signed', 'certificate pinning', 'ssl inspection']
        };
    }

    detect(events) {
        const results = [];

        for (const event of events) {
            const str = JSON.stringify(event).toLowerCase();

            for (const cert of this.patterns.mitmCerts) {
                if (str.includes(cert.toLowerCase())) {
                    results.push(this.createResult('MITM Certificate', {
                        source: event.source,
                        timestamp: event.timestamp,
                        certificate: cert
                    }, 'critical'));
                }
            }

            for (const cert of this.patterns.enterpriseCerts) {
                if (str.includes(cert.toLowerCase())) {
                    results.push(this.createResult('Enterprise Certificate', {
                        source: event.source,
                        timestamp: event.timestamp,
                        certificate: cert
                    }, 'high'));
                }
            }

            for (const file of this.patterns.files) {
                if (str.includes(file.toLowerCase())) {
                    results.push(this.createResult('Certificate File', {
                        source: event.source,
                        timestamp: event.timestamp,
                        file: file
                    }, 'medium'));
                }
            }

            if (event.category === 'Network' || event.type === 'network') {
                for (const pattern of this.patterns.patterns) {
                    if (str.includes(pattern.toLowerCase())) {
                        results.push(this.createResult('SSL Pattern', {
                            source: event.source,
                            timestamp: event.timestamp,
                            pattern: pattern
                        }, 'medium'));
                    }
                }
            }
        }

        return results;
    }
}

// ============================================
// 11. ENHANCED CORRELATION ENGINE
// ============================================

class EnhancedCorrelationEngine {
    constructor() {
        this.rules = [
            this.correlateProxyAndCertificate.bind(this),
            this.correlateSideloadAndFreeFire.bind(this),
            this.correlateMultipleTools.bind(this),
            this.correlateVPNAndNetwork.bind(this),
            this.correlateTiming.bind(this),
            this.correlateCrashPatterns.bind(this)
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

    isTimeClose(date1, date2, minutes) {
        if (!date1 || !date2) return false;
        const diff = Math.abs(date1.getTime() - date2.getTime());
        return diff < minutes * 60 * 1000;
    }
}

// ============================================
// 12. STATISTICS ENGINE
// ============================================

class StatisticsEngine {
    constructor() {
        this.statistics = {
            totalEvents: 0,
            uniqueSources: new Set(),
            categories: {},
            types: {},
            confidence: { critical: 0, high: 0, medium: 0, low: 0 },
            correlations: { total: 0, byType: {} }
        };
    }

    analyze(events, detections, correlations) {
        this.statistics.totalEvents = events.length;
        
        for (const event of events) {
            if (event.source) this.statistics.uniqueSources.add(event.source);
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
            uniqueSources: Array.from(this.statistics.uniqueSources)
        };
    }
}

// ============================================
// 13. SCORE ENGINE
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
            analytics: 0.5
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
        
        return recommendations;
    }
}

// ============================================
// 14. EVIDENCE CLASS
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
}

// ============================================
// 15. ENHANCED TIMELINE BUILDER
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
                categories: this.getCategoryDistribution(group.events)
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
}

// ============================================
// 16. EXPORT MANAGER
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
        return `
        <!DOCTYPE html>
        <html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
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
                <div class="stat-box">
                    <div class="number">${Object.keys(report.statistics?.categories || {}).length}</div>
                    <div class="label">Categorias</div>
                </div>
                <div class="stat-box">
                    <div class="number">${report.statistics?.uniqueSourcesCount || 0}</div>
                    <div class="label">Fontes</div>
                </div>
                <div class="stat-box">
                    <div class="number">${report.statistics?.confidence?.critical || 0}</div>
                    <div class="label">Crítico</div>
                </div>
                <div class="stat-box">
                    <div class="number">${report.statistics?.confidence?.high || 0}</div>
                    <div class="label">Alta Confiança</div>
                </div>
                <div class="stat-box">
                    <div class="number">${report.totalCorrelations || 0}</div>
                    <div class="label">Correlações</div>
                </div>
                <div class="stat-box">
                    <div class="number">${report.totalEvidences || 0}</div>
                    <div class="label">Evidências</div>
                </div>
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
                    <ul>
                        ${report.recommendations.map(r => `<li>${r}</li>`).join('')}
                    </ul>
                </div>
            </div>` : ''}

            ${report.timeline && report.timeline.length > 0 ? `
            <div class="section">
                <h2>📅 Timeline (${report.timeline.length})</h2>
                ${report.timeline.slice(0, 50).map(item => `
                    <div class="timeline-item">
                        <div class="time">${item.key || new Date(item.timestamp).toLocaleString('pt-BR')}</div>
                        <div class="desc">
                            ${Object.entries(item.categories || {}).map(([cat, count]) => `${cat}: ${count}`).join(' • ')}
                            (${item.count} evento${item.count > 1 ? 's' : ''})
                        </div>
                    </div>
                `).join('')}
            </div>` : ''}

            <div style="text-align:center;color:#999;padding:30px 0 10px;font-size:12px;border-top:1px solid #eee;margin-top:30px;">
                ${report.appName || 'iOS Evidence Scanner'} - Análise baseada exclusivamente em evidências nos arquivos
            </div>
        </div>
        </body></html>`;
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
// 17. UI - CORRIGIDA
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
        alert.message = `v${this.scanner?.configManager?.get('version') || '2.0.0'}\n\nScanner forense para análise de evidências em arquivos iOS\n\nBaseado exclusivamente em evidências reais\n\nDetectores: Proxy, VPN, Jailbreak, Sideload, Hook, Free Fire, Certificados`;
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
            alert.message = 'Escolha o arquivo que deseja analisar.\n\nVocê pode:\n• Selecionar da pasta do Scriptable\n• Usar o seletor nativo do iOS';
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
        for (const file of files) {
            const ext = file.extension || 'desconhecido';
            const type = file.type || 'Desconhecido';
            const size = this.scanner?.fileLoader?.formatFileSize(file.size) || '?';
            message += `📄 ${file.name}\n   Tipo: ${type} (${ext}) • Tamanho: ${size}\n\n`;
        }
        
        const alert = new Alert();
        alert.title = '📂 Arquivos Selecionados';
        alert.message = message + '\nDeseja iniciar a análise?';
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
        alert.message = `
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
                h2 { color: #333; margin-top: 20px; }
                ul { padding-left: 20px; }
                li { margin: 10px 0; }
                .tip { background: #f0f7ff; padding: 15px; border-radius: 8px; border-left: 4px solid #007aff; margin: 20px 0; }
                .warning { background: #fff3e0; padding: 15px; border-radius: 8px; border-left: 4px solid #ff9500; margin: 20px 0; }
                .detector-list { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin: 10px 0; }
                .detector-item { background: #f8f9fa; padding: 8px; border-radius: 5px; text-align: center; font-size: 14px; }
            </style>
            </head>
            <body>
            <div class="container">
                <h1>📖 Guia do iOS Evidence Scanner</h1>
                
                <h2>🔍 O que faz?</h2>
                <p>Analisa arquivos do sistema iOS em busca de evidências técnicas.</p>
                
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
                
                <h2>🔧 Formatos Suportados</h2>
                <ul>
                    <li>.plist, .json, .log, .txt</li>
                    <li>.csv, .xml, .ips, .tracev3</li>
                </ul>
                
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
// 18. APPLICATION PRINCIPAL
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
        // Detectores aprimorados
        this.detectorManager.register(new AdvancedProxyDetector());
        this.detectorManager.register(new AdvancedVPNDetector());
        this.detectorManager.register(new AdvancedJailbreakDetector());
        this.detectorManager.register(new AdvancedSideloadDetector());
        this.detectorManager.register(new AdvancedHookDetector());
        this.detectorManager.register(new AdvancedFreeFireDetector());
        this.detectorManager.register(new AdvancedCertificateDetector());
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

            // Parser
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
                        category: event.category || 'System'
                    });
                    this.evidenceCollection.add(evidence);
                }

                processedFiles++;
            }

            // Detectores
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
                    category: detection.type || 'Detection'
                });
                this.evidenceCollection.add(evidence);
            }

            // Correlação
            await this.ui.showProgress(1, 1, '🔗 Correlacionando eventos...', 
                `${this.events.length} eventos processados`);
            
            this.correlations = this.correlationEngine.correlate(this.events);

            // Score
            const score = this.scoreEngine.calculate(this.evidenceCollection.getAll());

            // Estatísticas
            const stats = this.statisticsEngine.analyze(
                this.events,
                this.detections,
                this.correlations
            );

            // Timeline
            const timeline = this.timelineBuilder.build(this.events);

            this.endTime = Date.now();

            // Relatório
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

            // Mostrar relatório
            await this.ui.showReport(report);

            // Perguntar exportação
            const exportAlert = new Alert();
            exportAlert.title = '📥 Exportar Relatório';
            exportAlert.message = 'Deseja exportar o relatório em múltiplos formatos?';
            exportAlert.addAction('Sim');
            exportAlert.addAction('Não');
            
            if (await exportAlert.presentAlert() === 0) {
                await this.exportReport(report);
            }

            // Estatísticas
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
                }
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
        alert.message = `Ocorreu um erro inesperado:\n\n${error.message}`;
        alert.addAction('OK');
        await alert.presentAlert();
    }
})();
