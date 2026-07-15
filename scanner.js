// ============================================
// iOS EVIDENCE SCANNER - VERSÃO COMPLETA CORRIGIDA
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
                high: 0.8,
                medium: 0.5,
                low: 0.3
            },
            scoreWeights: {
                high: 30,
                medium: 15,
                low: 5
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
// 6. SCRIPTABLE FILE LOADER - CORRIGIDO
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

    /**
     * Método principal para selecionar arquivos
     * Usa o método nativo do Scriptable para abrir seletor de arquivos
     */
    async selectFiles(allowMultiple = true) {
        try {
            Logger.info('Abrindo seletor de arquivos...');
            
            const fm = FileManager.iCloud();
            
            // Tenta usar o método nativo do Scriptable para selecionar arquivo
            try {
                // Método 1: Usar a função nativa de importação
                if (typeof fm.importFile === 'function') {
                    const file = await fm.importFile();
                    if (file) {
                        const loadedFile = await this.loadFileFromPath(file);
                        if (loadedFile) {
                            this.selectedFiles = [loadedFile];
                            return [loadedFile];
                        }
                    }
                }
            } catch (e) {
                Logger.warn(`Método importFile falhou: ${e.message}`);
            }

            // Método 2: Usar a função nativa de DocumentPicker
            try {
                // Scriptable tem uma função global para selecionar arquivos
                if (typeof DocumentPicker !== 'undefined') {
                    // Tenta usar a função estática
                    const result = await DocumentPicker.open();
                    if (result && result.length > 0) {
                        const files = [];
                        for (const file of result) {
                            const loaded = await this.loadFileFromPath(file.path || file);
                            if (loaded) files.push(loaded);
                        }
                        if (files.length > 0) {
                            this.selectedFiles = files;
                            return files;
                        }
                    }
                }
            } catch (e) {
                Logger.warn(`DocumentPicker falhou: ${e.message}`);
            }

            // Método 3: Fallback - usar iCloud Drive
            return await this.selectFilesFromiCloud(allowMultiple);

        } catch (error) {
            Logger.error(`Erro na seleção de arquivos: ${error.message}`);
            // Último recurso: iCloud
            return await this.selectFilesFromiCloud(allowMultiple);
        }
    }

    /**
     * Seleção via iCloud Drive (Fallback)
     */
    async selectFilesFromiCloud(allowMultiple = true) {
        try {
            const fm = FileManager.iCloud();
            const docs = fm.documentsDirectory();
            
            // Lista arquivos na pasta do Scriptable
            const items = fm.listContents(docs);
            const supportedItems = items.filter(item => {
                const ext = this.getFileExtension(item);
                return this.supportedExtensions.includes(ext);
            });

            if (supportedItems.length === 0) {
                const alert = new Alert();
                alert.title = 'ℹ️ Nenhum arquivo encontrado';
                alert.message = `Nenhum arquivo suportado encontrado na pasta do Scriptable.\n\nFormatos aceitos:\n${this.supportedExtensions.join(', ')}\n\nColoque os arquivos em:\niCloud Drive → Scriptable\n\nOu use AirDrop para enviar.`;
                alert.addAction('OK');
                await alert.presentAlert();
                return [];
            }

            // Cria tabela de seleção
            const selection = new UITable();
            selection.title = '📂 Selecione o(s) arquivo(s) para análise';
            
            const fileInfos = [];
            for (const item of supportedItems) {
                const path = fm.joinPath(docs, item);
                const info = fm.getFileInfo(path);
                const ext = this.getFileExtension(item);
                const icon = this.getFileIcon(ext);
                
                const row = new UITableRow(`${icon} ${item}`);
                row.detailText = `${this.formatFileSize(info.size)} • ${new Date(info.modifiedDate).toLocaleString('pt-BR')}`;
                row.dismissOnSelect = false;
                
                if (allowMultiple) {
                    row.addCheckbox();
                }
                
                fileInfos.push({ item, path, info, row });
                selection.addRow(row);
            }

            // Botão de selecionar todos (se múltiplo)
            if (allowMultiple) {
                selection.addAction('📂 Selecionar Todos', (table) => {
                    for (const row of table.rows) {
                        row.select();
                    }
                });
            }
            
            // Botão principal de análise
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
                        files.push({
                            name: fileInfo.item,
                            path: fileInfo.path,
                            extension: this.getFileExtension(fileInfo.item),
                            size: fileInfo.info.size,
                            modified: fileInfo.info.modifiedDate,
                            content: content,
                            type: this.detectFileType({ name: fileInfo.item, extension: this.getFileExtension(fileInfo.item) })
                        });
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
            
            // Se o resultado for um array de arquivos, retorna
            if (Array.isArray(result) && result.length > 0) {
                this.selectedFiles = result;
                return result;
            }
            
            // Se não veio resultado, tenta pegar da seleção manual
            const selectedRows = selection.selectedRows;
            if (selectedRows && selectedRows.length > 0) {
                const files = [];
                for (const row of selectedRows) {
                    const fileInfo = fileInfos[row.index];
                    try {
                        const content = fm.readString(fileInfo.path);
                        files.push({
                            name: fileInfo.item,
                            path: fileInfo.path,
                            extension: this.getFileExtension(fileInfo.item),
                            size: fileInfo.info.size,
                            modified: fileInfo.info.modifiedDate,
                            content: content,
                            type: this.detectFileType({ name: fileInfo.item, extension: this.getFileExtension(fileInfo.item) })
                        });
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
            
            // Mostra erro amigável
            const alert = new Alert();
            alert.title = '❌ Erro ao selecionar arquivos';
            alert.message = `${error.message}\n\nDica: Coloque os arquivos na pasta:\niCloud Drive → Scriptable`;
            alert.addAction('OK');
            await alert.presentAlert();
            
            return [];
        }
    }

    /**
     * Carrega um arquivo a partir de um caminho
     */
    async loadFileFromPath(path) {
        try {
            const fm = FileManager.iCloud();
            
            // Se for um objeto com path
            if (typeof path === 'object' && path.path) {
                path = path.path;
            }
            
            const info = fm.getFileInfo(path);
            if (!info) throw new Error(`Arquivo não encontrado: ${path}`);
            
            const content = fm.readString(path);
            const file = {
                name: this.getFileName(path),
                path: path,
                extension: this.getFileExtension(path),
                size: info.size,
                modified: info.modifiedDate,
                content: content,
                type: this.detectFileType({ name: path })
            };
            
            // Valida o arquivo
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

    /**
     * Carrega um arquivo individual (para compatibilidade)
     */
    async loadFile(file) {
        try {
            const fm = FileManager.iCloud();
            let loadedFile = null;

            // Caso 1: Caminho do arquivo
            if (typeof file === 'string') {
                const path = file;
                const info = fm.getFileInfo(path);
                if (!info) throw new Error(`Arquivo não encontrado: ${path}`);
                
                const content = fm.readString(path);
                loadedFile = {
                    name: this.getFileName(path),
                    path: path,
                    extension: this.getFileExtension(path),
                    size: info.size,
                    modified: info.modifiedDate,
                    content: content,
                    type: this.detectFileType({ name: path })
                };
            }
            // Caso 2: Objeto com conteúdo
            else if (file.content) {
                loadedFile = {
                    name: file.name || 'arquivo',
                    path: file.path || '',
                    extension: this.getFileExtension(file.name || ''),
                    size: file.size || file.content.length,
                    modified: file.modified || new Date(),
                    content: file.content,
                    type: this.detectFileType({ name: file.name || 'arquivo' })
                };
            } else {
                throw new Error('Formato de arquivo não suportado');
            }

            // Valida o arquivo
            const validation = this.validateFile(loadedFile);
            if (!validation.valid) {
                throw new Error(validation.error);
            }

            // Adiciona ao cache
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

    /**
     * Valida o arquivo
     */
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

    /**
     * Detecta o tipo do arquivo
     */
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
// 10. ENHANCED DETECTORS
// ============================================

class EnhancedVPNDetector extends BaseDetector {
    constructor() {
        super('Enhanced VPN Detector');
        this.patterns = {
            process: ['packettunnel', 'networkextension', 'vpn', 'wireguard', 'openvpn', 'ikev2'],
            files: ['vpn.conf', 'wg.conf', 'ovpn', 'vpn.log'],
            bundleIds: ['com.wireguard', 'com.openvpn', 'com.apple.networkextension'],
            services: ['VPN', 'L2TP', 'PPTP', 'IPSec']
        };
    }

    detect(events) {
        const results = [];
        for (const event of events) {
            const str = JSON.stringify(event).toLowerCase();
            for (const pattern of this.patterns.process) {
                if (str.includes(pattern)) {
                    results.push(this.createResult('VPN', event, 'high'));
                    break;
                }
            }
            for (const bundleId of this.patterns.bundleIds) {
                if (str.includes(bundleId.toLowerCase())) {
                    results.push(this.createResult('VPN Bundle', event, 'high'));
                    break;
                }
            }
        }
        return results;
    }
}

class EnhancedProxyDetector extends BaseDetector {
    constructor() {
        super('Enhanced Proxy Detector');
        this.patterns = {
            apps: ['mitmproxy', 'charles', 'burp', 'fiddler', 'proxyman', 'http catcher'],
            files: ['proxy.pac', 'proxy.conf', 'mitmproxy', 'charles.log'],
            bundleIds: ['com.xx', 'com.charles', 'com.burp'],
            network: ['proxy', 'mitm', 'intercept', 'ssl', 'certificate']
        };
    }

    detect(events) {
        const results = [];
        for (const event of events) {
            const str = JSON.stringify(event).toLowerCase();
            for (const app of this.patterns.apps) {
                if (str.includes(app.toLowerCase())) {
                    results.push(this.createResult('Proxy App', event, 'high'));
                    break;
                }
            }
            for (const file of this.patterns.files) {
                if (str.includes(file.toLowerCase())) {
                    results.push(this.createResult('Proxy File', event, 'medium'));
                    break;
                }
            }
            if (event.category === 'Network' || event.type === 'network') {
                for (const pattern of this.patterns.network) {
                    if (str.includes(pattern)) {
                        results.push(this.createResult('Proxy Network', event, 'medium'));
                        break;
                    }
                }
            }
        }
        return results;
    }
}

class EnhancedJailbreakDetector extends BaseDetector {
    constructor() {
        super('Enhanced Jailbreak Detector');
        this.patterns = {
            apps: ['cydia', 'sileo', 'zebra', 'procursus', 'ellekit', 'substitute', 'substrate'],
            files: ['cydia.log', 'jailbreak.plist', 'procursus', 'substrate'],
            bundleIds: ['com.saurik.cydia', 'org.coolstar.sileo', 'com.zebra'],
            processes: ['jailbreakd', 'substituted', 'cydia', 'sileo']
        };
    }

    detect(events) {
        const results = [];
        for (const event of events) {
            const str = JSON.stringify(event).toLowerCase();
            for (const app of this.patterns.apps) {
                if (str.includes(app.toLowerCase())) {
                    results.push(this.createResult('Jailbreak App', event, 'high'));
                    break;
                }
            }
            for (const file of this.patterns.files) {
                if (str.includes(file.toLowerCase())) {
                    results.push(this.createResult('Jailbreak File', event, 'high'));
                    break;
                }
            }
        }
        return results;
    }
}

// ============================================
// 11. CORRELATION ENGINE
// ============================================

class CorrelationEngine {
    constructor() {
        this.rules = [
            this.correlateProxyAndApp,
            this.correlateVPNAndNetwork,
            this.correlateTiming,
            this.correlateCrashPatterns,
            this.correlateSideloadAndFreeFire
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

    correlateProxyAndApp(events) {
        const correlations = [];
        const proxyEvents = events.filter(e => e.category === 'Proxy');
        const appEvents = events.filter(e => e.category === 'FreeFire' || e.category === 'AppStore');
        for (const proxy of proxyEvents) {
            for (const app of appEvents) {
                if (this.isTimeClose(proxy.timestamp, app.timestamp, 5)) {
                    correlations.push({
                        id: `corr_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
                        type: 'proxy_app_usage',
                        description: `Proxy ativo próximo ao uso do aplicativo ${app.type}`,
                        confidence: 'high',
                        events: [proxy, app],
                        timestamp: proxy.timestamp
                    });
                }
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

    correlateSideloadAndFreeFire(events) {
        const correlations = [];
        const sideloadEvents = events.filter(e => e.category === 'Sideload');
        const ffEvents = events.filter(e => e.category === 'FreeFire');
        for (const sideload of sideloadEvents) {
            for (const ff of ffEvents) {
                if (this.isTimeClose(sideload.timestamp, ff.timestamp, 30)) {
                    correlations.push({
                        id: `corr_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
                        type: 'sideload_ff',
                        description: 'Sideload detectado próximo ao uso do Free Fire',
                        confidence: 'high',
                        events: [sideload, ff],
                        timestamp: ff.timestamp
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
// 12. STATISTICS ENGINE
// ============================================

class StatisticsEngine {
    constructor() {
        this.statistics = {
            totalEvents: 0,
            uniqueSources: new Set(),
            categories: {},
            types: {},
            confidence: { high: 0, medium: 0, low: 0 },
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
            jailbreak: 1.5, hook: 1.4, proxy: 1.3, vpn: 1.2,
            sideload: 1.3, certificate: 1.2, developer: 1.1,
            freefire: 1.0, appstore: 0.8, crash: 1.0, analytics: 0.5
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
            .score-section { background: linear-gradient(135deg, #007aff, #0051d5); color: white; padding: 20px; border-radius: 8px; margin-bottom: 30px; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; }
            .score-number { font-size: 48px; font-weight: bold; }
            .risk-level { padding: 10px 20px; border-radius: 20px; background: rgba(255,255,255,0.2); font-weight: bold; }
            .stats-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 15px; margin-bottom: 30px; }
            .stat-box { background: #f8f9fa; padding: 15px; border-radius: 8px; text-align: center; }
            .stat-box .number { font-size: 24px; font-weight: bold; color: #007aff; }
            .stat-box .label { color: #666; font-size: 12px; margin-top: 5px; }
            .section { margin-top: 30px; border-top: 1px solid #e5e5e5; padding-top: 20px; }
            .section h2 { color: #333; margin-bottom: 15px; }
            .detection-item { background: #f8f9fa; padding: 15px; border-radius: 8px; margin-bottom: 10px; border-left: 4px solid #007aff; }
            .detection-item .type { font-weight: bold; color: #007aff; }
            .detection-item .confidence { float: right; padding: 2px 10px; border-radius: 10px; font-size: 12px; font-weight: bold; }
            .confidence-high { background: #ff3b30; color: white; }
            .confidence-medium { background: #ff9500; color: white; }
            .confidence-low { background: #34c759; color: white; }
            .timeline-item { padding: 10px; border-bottom: 1px solid #eee; }
            .timeline-item .time { color: #666; font-size: 14px; font-weight: bold; }
            .timeline-item .desc { color: #333; margin-top: 3px; }
        </style>
        </head>
        <body>
        <div class="container">
            <div class="header">
                <div><h1>🔍 ${report.appName || 'iOS Evidence Scanner'}</h1>
                <div style="color:#666;font-size:14px;">Versão: ${report.version || '1.0.0'} • ${new Date(report.generated).toLocaleString('pt-BR')}</div></div>
                <div style="font-size:14px;color:#666;">Eventos: ${report.totalEvents} • Detecções: ${report.totalDetections}</div>
            </div>
            <div class="score-section">
                <div><div class="score-number">${report.score}</div><div style="font-size:14px;opacity:0.8;">Score de Evidências</div></div>
                <div><div class="risk-level">${report.riskLevel}</div></div>
            </div>
            <div class="stats-grid">
                <div class="stat-box"><div class="number">${Object.keys(report.statistics?.categories || {}).length}</div><div class="label">Categorias</div></div>
                <div class="stat-box"><div class="number">${report.statistics?.uniqueSourcesCount || 0}</div><div class="label">Fontes</div></div>
                <div class="stat-box"><div class="number">${report.statistics?.confidence?.high || 0}</div><div class="label">Alta Confiança</div></div>
                <div class="stat-box"><div class="number">${report.totalCorrelations || 0}</div><div class="label">Correlações</div></div>
            </div>
            ${report.detections && report.detections.length > 0 ? `
            <div class="section"><h2>🔎 Detecções (${report.detections.length})</h2>
            ${report.detections.slice(0, 50).map(d => `
                <div class="detection-item">
                    <div><span class="type">${d.type || 'Detecção'}</span>
                    <span class="confidence confidence-${d.confidence || 'low'}">${(d.confidence || 'low').toUpperCase()}</span></div>
                    <div style="margin-top:5px;color:#666;font-size:14px;">${d.detector || 'Unknown'}</div>
                    <div style="margin-top:5px;color:#888;font-size:13px;">${d.explanation || ''}</div>
                </div>
            `).join('')}
            </div>` : ''}
            ${report.timeline && report.timeline.length > 0 ? `
            <div class="section"><h2>📅 Timeline (${report.timeline.length})</h2>
            ${report.timeline.slice(0, 50).map(item => `
                <div class="timeline-item">
                    <div class="time">${item.key || new Date(item.timestamp).toLocaleString('pt-BR')}</div>
                    <div class="desc">${Object.keys(item.categories || {}).join(', ')}: ${item.count} evento(s)</div>
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
        output.push(`📈 SCORE: ${report.score} - ${report.riskLevel}`);
        output.push('');
        if (report.detections && report.detections.length > 0) {
            output.push('🔎 DETECÇÕES:');
            for (const d of report.detections.slice(0, 30)) {
                output.push(`  [${(d.confidence || 'low').toUpperCase()}] ${d.detector}: ${d.type}`);
                output.push(`    ${d.explanation || ''}`);
            }
        }
        output.push('');
        output.push('='.repeat(60));
        return output.join('\n');
    }

    getSupportedFormats() { return Object.keys(this.formats); }
}

// ============================================
// 17. UI - CORRIGIDA COM SELEÇÃO DE ARQUIVOS
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
        alert.message = `v${this.scanner?.configManager?.get('version') || '2.0.0'}\n\nScanner forense para análise de evidências em arquivos iOS\n\nBaseado exclusivamente em evidências reais\n\n📊 ${this.scanner?.fileLoader?.getSelectedFiles()?.length || 0} arquivo(s) selecionado(s)`;
        alert.addAction('🔍 Nova Análise');
        alert.addAction('📊 Histórico');
        alert.addAction('⚙️ Configurações');
        alert.addAction('📖 Ajuda');
        alert.addAction('❌ Sair');
        return await alert.presentAlert();
    }

    async selectFiles() {
        try {
            // Usa o FileLoader do scanner
            if (!this.scanner || !this.scanner.fileLoader) {
                throw new Error('FileLoader não disponível');
            }
            
            // Mostra alerta informativo
            const alert = new Alert();
            alert.title = '📂 Selecionar Arquivo';
            alert.message = 'Escolha o arquivo que deseja analisar.\n\nVocê pode:\n• Selecionar da pasta do Scriptable\n• Usar o seletor nativo do iOS\n• Importar via compartilhamento';
            alert.addAction('📂 Escolher da iCloud');
            alert.addAction('📂 Seletor Nativo');
            alert.addAction('❌ Cancelar');
            
            const action = await alert.presentAlert();
            
            if (action === 2) {
                return [];
            }
            
            let files = [];
            
            if (action === 0) {
                // Usa iCloud Drive
                files = await this.scanner.fileLoader.selectFilesFromiCloud(true);
            } else {
                // Tenta o seletor nativo
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
        
        // Mostra alerta apenas em marcos importantes
        if (percentage % 20 === 0 || percentage === 100 || current === total) {
            const alert = new Alert();
            alert.title = '🔄 Processando...';
            alert.message = `${message}\n\n${bar}\n${percentage}% concluído (${current}/${total})\n${details ? '\n' + details : ''}`;
            
            if (percentage >= 100) {
                alert.addAction('✅ Concluído!');
                await alert.presentAlert();
                return;
            }
            
            // Não espera o alerta fechar para não travar
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

⚡ Performance:
  ${Object.entries(stats.performance?.phases || {})
      .map(([phase, data]) => `  ${phase}: ${data.duration}ms`)
      .join('\n')}
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
            </style>
            </head>
            <body>
            <div class="container">
                <h1>📖 Guia do iOS Evidence Scanner</h1>
                <h2>🔍 O que faz?</h2>
                <p>Analisa arquivos do sistema iOS em busca de evidências técnicas.</p>
                <h2>📁 Como usar?</h2>
                <ol>
                    <li><strong>Selecionar:</strong> Escolha o(s) arquivo(s) para analisar</li>
                    <li><strong>Analisar:</strong> Aguarde o processamento automático</li>
                    <li><strong>Visualizar:</strong> Veja o relatório completo</li>
                </ol>
                <div class="tip"><strong>💡 Dica:</strong> Use arquivos de sysdiagnose para melhores resultados</div>
                <div class="warning"><strong>⚠️ Importante:</strong> O scanner não afirma conclusões, apenas apresenta evidências</div>
                <h2>🔧 Formatos Suportados</h2>
                <ul>
                    <li>.plist, .json, .log, .txt</li>
                    <li>.csv, .xml, .ips, .tracev3</li>
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
        this.correlationEngine = new CorrelationEngine();
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
        
        // Registra detectores
        this.registerDetectors();
    }

    registerDetectors() {
        this.detectorManager.register(new EnhancedVPNDetector());
        this.detectorManager.register(new EnhancedProxyDetector());
        this.detectorManager.register(new EnhancedJailbreakDetector());
    }

    async run() {
        try {
            while (true) {
                const action = await this.ui.showMainMenu();
                
                switch (action) {
                    case 0: // Nova Análise
                        await this.runAnalysis();
                        break;
                    case 1: // Histórico
                        await this.showHistory();
                        break;
                    case 2: // Configurações
                        await this.showSettings();
                        break;
                    case 3: // Ajuda
                        await this.ui.showHelp();
                        break;
                    case 4: // Sair
                        return;
                    default:
                        break;
                }
            }
        } catch (error) {
            await this.ui.showError(error);
        }
    }

    async runAnalysis() {
        try {
            // 1. Selecionar arquivos
            const files = await this.ui.selectFiles();
            if (!files || files.length === 0) {
                const alert = new Alert();
                alert.title = 'ℹ️ Nenhum arquivo selecionado';
                alert.message = 'A análise foi cancelada porque nenhum arquivo foi selecionado.';
                alert.addAction('OK');
                await alert.presentAlert();
                return;
            }

            // 2. Confirmar seleção
            const confirmed = await this.ui.showFileInfo(files);
            if (!confirmed) {
                return;
            }

            // 3. Analisar
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

                // Parser
                const parsedEvents = await this.parser.parse(file);
                this.events.push(...parsedEvents);

                // Evidências
                for (const event of parsedEvents) {
                    const evidence = new Evidence({
                        detector: 'Parser',
                        sourceFile: file.name,
                        key: event.type || 'event',
                        value: event.description || '',
                        timestamp: event.timestamp || new Date(),
                        confidence: event.confidence || 'medium',
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
                    sourceFile: detection.evidence?.sourceFile || 'unknown',
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
                    totalTime: this.endTime - this.startTime,
                    phases: {
                        parsing: 'Completo',
                        detection: 'Completo',
                        correlation: 'Completo'
                    }
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
                performance: report.performance
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
                const info = fm.getFileInfo(path);
                row.detailText = `${this.fileLoader.formatFileSize(info.size)} • ${new Date(info.modifiedDate).toLocaleString('pt-BR')}`;
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

// Export para uso em outros scripts
module.exports = {
    Application,
    ScriptableFileLoader,
    ImprovedScriptableUI,
    ConfigManager,
    AdvancedParser,
    DetectorManager,
    CorrelationEngine,
    StatisticsEngine,
    ScoreEngine,
    ExportManager
};
