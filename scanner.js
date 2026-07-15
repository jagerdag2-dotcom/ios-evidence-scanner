// ============================================
// iOS EVIDENCE SCANNER - VERSÃO CORRIGIDA 2.2.1
// ============================================

// ============================================
// 1. CONFIGURATION MANAGER
// ============================================

class ConfigManager {
    constructor() {
        this.config = {
            appName: 'iOS Evidence Scanner',
            version: '2.2.1',
            maxFileSize: 50 * 1024 * 1024,
            supportedExtensions: ['.plist', '.log', '.txt', '.json', '.ips', '.csv', '.xml', '.tracev3', '.ndjson', '.ndj', '.jsonl'],
            debug: false,
            cacheEnabled: true,
            maxCacheSize: 100
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
        try {
            const date = new Date(value);
            if (!isNaN(date.getTime())) return date;
            return null;
        } catch (e) { return null; }
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
        this.id = 'evt_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);
        this.timestamp = data.timestamp || new Date();
        this.source = data.source || 'unknown';
        this.category = data.category || 'System';
        this.type = data.type || 'unknown';
        this.description = data.description || '';
        this.data = data.data || {};
        this.metadata = data.metadata || {};
        this.confidence = data.confidence || 'medium';
        this.raw = data.raw || null;
    }
}

// ============================================
// 5. SCRIPTABLE FILE LOADER (CORRIGIDO)
// ============================================

class ScriptableFileLoader {
    constructor(configManager) {
        this.configManager = configManager;
        this.supportedExtensions = configManager.getSupportedExtensions();
        this.maxFileSize = configManager.getMaxFileSize();
        this.selectedFiles = [];
    }

    async selectFiles() {
        try {
            Logger.info('Abrindo seletor de arquivos...');
            
            // MÉTODO 1: Usar FileManager para listar arquivos na pasta do Scriptable
            const files = await this.selectFromScriptableFolder();
            if (files && files.length > 0) {
                return files;
            }

            // MÉTODO 2: Tentar usar DocumentPicker (funciona em versões mais recentes)
            try {
                const files = await this.selectWithDocumentPicker();
                if (files && files.length > 0) {
                    return files;
                }
            } catch (e) {
                Logger.warn('DocumentPicker não disponível');
            }

            // MÉTODO 3: Fallback - pedir ao usuário para digitar o caminho
            return await this.selectWithPathInput();

        } catch (error) {
            Logger.error(`Erro na seleção: ${error.message}`);
            return await this.selectWithPathInput();
        }
    }

    async selectFromScriptableFolder() {
        try {
            const fm = FileManager.iCloud();
            const docs = fm.documentsDirectory();
            
            Logger.info(`Procurando em: ${docs}`);
            
            let items = [];
            try {
                items = fm.listContents(docs);
            } catch (e) {
                Logger.warn('Erro ao listar diretório iCloud');
                // Tentar local
                const localFM = FileManager.local();
                const localDocs = localFM.documentsDirectory();
                items = localFM.listContents(localDocs);
            }

            if (!items || items.length === 0) {
                Logger.info('Nenhum arquivo encontrado');
                return [];
            }

            // Filtrar arquivos suportados
            const supportedItems = items.filter(item => {
                const ext = this.getFileExtension(item);
                return this.supportedExtensions.includes(ext);
            });

            if (supportedItems.length === 0) {
                const alert = new Alert();
                alert.title = 'ℹ️ Nenhum arquivo suportado';
                alert.message = `Coloque arquivos com estas extensões na pasta do Scriptable:\n\n${this.supportedExtensions.join(', ')}`;
                alert.addAction('OK');
                await alert.presentAlert();
                return [];
            }

            // Mostrar lista para seleção
            const selection = new UITable();
            selection.title = '📂 Selecione o(s) arquivo(s)';
            
            const fileInfos = [];
            for (const item of supportedItems) {
                const path = fm.joinPath(docs, item);
                const ext = this.getFileExtension(item);
                const icon = this.getFileIcon(ext);
                
                let content = null;
                let fileSize = 0;
                try {
                    content = fm.readString(path);
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
                row.addCheckbox();
                
                fileInfos.push({ item, path, size: fileSize, content, row });
                selection.addRow(row);
            }

            selection.addAction('📊 Analisar Selecionados', async (table) => {
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
                        let content = fileInfo.content;
                        if (!content) {
                            content = fm.readString(fileInfo.path);
                        }
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
                return files;
            });
            
            selection.addAction('❌ Cancelar', () => {
                return [];
            });

            // Aguardar resultado
            let result = null;
            const originalPresent = selection.present.bind(selection);
            selection.present = async function() {
                const value = await originalPresent();
                // Se o valor for um array, é o resultado
                if (Array.isArray(value) && value.length > 0) {
                    result = value;
                }
                return value;
            };

            // Apresentar e aguardar
            const promise = selection.present();
            
            // Também capturar o resultado através das actions
            const timeout = new Promise((resolve) => {
                setTimeout(() => {
                    // Verificar se há arquivos selecionados
                    const selectedRows = selection.selectedRows;
                    if (selectedRows && selectedRows.length > 0) {
                        const files = [];
                        for (const row of selectedRows) {
                            const fileInfo = fileInfos[row.index];
                            if (fileInfo.content) {
                                files.push({
                                    name: fileInfo.item,
                                    path: fileInfo.path,
                                    extension: this.getFileExtension(fileInfo.item),
                                    size: fileInfo.content.length,
                                    modified: new Date(),
                                    content: fileInfo.content,
                                    type: this.detectFileType(fileInfo.item)
                                });
                            }
                        }
                        if (files.length > 0) {
                            result = files;
                        }
                    }
                    resolve();
                }, 5000);
            });

            await Promise.race([promise, timeout]);
            
            // Se o resultado não foi definido, verificar selectedRows
            if (!result || result.length === 0) {
                const selectedRows = selection.selectedRows;
                if (selectedRows && selectedRows.length > 0) {
                    const files = [];
                    for (const row of selectedRows) {
                        const fileInfo = fileInfos[row.index];
                        if (fileInfo.content) {
                            files.push({
                                name: fileInfo.item,
                                path: fileInfo.path,
                                extension: this.getFileExtension(fileInfo.item),
                                size: fileInfo.content.length,
                                modified: new Date(),
                                content: fileInfo.content,
                                type: this.detectFileType(fileInfo.item)
                            });
                        }
                    }
                    result = files;
                }
            }

            return result || [];

        } catch (error) {
            Logger.error(`Erro ao selecionar da pasta: ${error.message}`);
            return [];
        }
    }

    async selectWithDocumentPicker() {
        try {
            const dp = new DocumentPicker();
            const files = await dp.present(true);
            
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
                    Logger.error(`Erro ao ler: ${e.message}`);
                }
            }
            return loadedFiles;
        } catch (error) {
            Logger.warn(`DocumentPicker falhou: ${error.message}`);
            return [];
        }
    }

    async selectWithPathInput() {
        const alert = new Alert();
        alert.title = '📂 Digite o caminho do arquivo';
        alert.message = 'Exemplo: /path/to/file.log ou use o nome do arquivo na pasta do Scriptable';
        alert.addTextField('Caminho do arquivo', '');
        alert.addAction('OK');
        alert.addAction('Cancelar');
        
        const action = await alert.presentAlert();
        if (action === 1) return [];
        
        const path = alert.textFieldValue(0);
        if (!path) return [];
        
        try {
            const fm = FileManager.iCloud();
            let content;
            try {
                content = fm.readString(path);
            } catch (e) {
                // Tentar local
                const localFM = FileManager.local();
                const docs = localFM.documentsDirectory();
                const fullPath = localFM.joinPath(docs, path);
                content = localFM.readString(fullPath);
            }
            
            if (!content) {
                throw new Error('Arquivo vazio ou não encontrado');
            }
            
            return [{
                name: path.split('/').pop() || path,
                path: path,
                extension: this.getFileExtension(path),
                size: content.length,
                modified: new Date(),
                content: content,
                type: this.detectFileType(path)
            }];
        } catch (error) {
            Logger.error(`Erro ao ler arquivo: ${error.message}`);
            const alert2 = new Alert();
            alert2.title = '❌ Erro';
            alert2.message = `Não foi possível ler o arquivo: ${error.message}`;
            alert2.addAction('OK');
            await alert2.presentAlert();
            return [];
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
    clearCache() { this.selectedFiles = []; }
}

// ============================================
// 6. PARSER SIMPLIFICADO
// ============================================

class AdvancedParser {
    async parse(file) {
        const events = [];
        const ext = file.extension ? file.extension.replace('.', '') : '';
        
        try {
            if (ext === 'json' || ext === 'ndjson' || ext === 'ndj' || ext === 'jsonl') {
                return this.parseJSON(file);
            } else if (ext === 'plist') {
                return this.parsePlist(file);
            } else if (ext === 'ips') {
                return this.parseIPS(file);
            } else {
                return this.parseLog(file);
            }
        } catch (error) {
            Logger.error(`Erro no parser: ${error.message}`);
            return events;
        }
    }

    parseJSON(file) {
        const events = [];
        try {
            const lines = file.content.split('\n').filter(line => line.trim());
            for (let i = 0; i < Math.min(lines.length, 5000); i++) {
                try {
                    const data = JSON.parse(lines[i]);
                    events.push(new EventModel({
                        timestamp: new Date(),
                        source: file.name,
                        category: 'JSON',
                        type: 'event',
                        description: `Linha ${i + 1}`,
                        data: data,
                        raw: lines[i].substring(0, 500)
                    }));
                } catch (e) {}
            }
        } catch (error) {
            Logger.error(`Erro no JSON: ${error.message}`);
        }
        return events;
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
                            data[keyMatch[1]] = valueMatch[2];
                        }
                    }
                    events.push(new EventModel({
                        timestamp: new Date(),
                        source: file.name,
                        category: 'Plist',
                        type: 'plist',
                        description: `Arquivo PLIST com ${Object.keys(data).length} chaves`,
                        data: data,
                        raw: content.substring(0, 500)
                    }));
                }
            }
        } catch (error) {
            Logger.error(`Erro no PLIST: ${error.message}`);
        }
        return events;
    }

    parseIPS(file) {
        const events = [];
        const content = file.content;
        
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

        const exceptionMatch = content.match(/Exception Type:\s*([^\n]+)/i);
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

        if (content.toLowerCase().includes('jailbreak') || content.toLowerCase().includes('cydia')) {
            events.push(new EventModel({
                timestamp: new Date(),
                source: file.name,
                category: 'Jailbreak',
                type: 'jailbreak_indicator',
                description: 'Indicador de jailbreak no crash report',
                data: { indicator: 'Jailbreak' }
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
            const lower = line.toLowerCase();
            let category = 'Log';
            let type = 'log';
            if (lower.includes('error') || lower.includes('exception')) {
                category = 'Error';
                type = 'error';
            } else if (lower.includes('warning')) {
                category = 'Warning';
                type = 'warning';
            } else if (lower.includes('proxy') || lower.includes('mitm')) {
                category = 'Proxy';
                type = 'proxy';
            } else if (lower.includes('vpn')) {
                category = 'VPN';
                type = 'vpn';
            }
            
            events.push(new EventModel({
                timestamp: new Date(),
                source: file.name,
                category: category,
                type: type,
                description: line.substring(0, 200),
                data: { line: line.substring(0, 500) },
                raw: line.substring(0, 500)
            }));
        }
        return events;
    }
}

// ============================================
// 7. BASE DETECTOR
// ============================================

class BaseDetector {
    constructor(name) {
        this.name = name;
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
        return `Evidência de ${type} encontrada`;
    }
}

// ============================================
// 8. DETECTORES SIMPLIFICADOS
// ============================================

class ProxyDetector extends BaseDetector {
    constructor() {
        super('Proxy Detector');
        this.keywords = ['proxy', 'mitm', 'charles', 'burp', 'fiddler', 'proxyman', 'surge'];
    }

    detect(events) {
        const results = [];
        for (const event of events) {
            const str = JSON.stringify(event).toLowerCase();
            for (const keyword of this.keywords) {
                if (str.includes(keyword)) {
                    results.push(this.createResult(
                        'Proxy Evidence',
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

class VPNDetector extends BaseDetector {
    constructor() {
        super('VPN Detector');
        this.keywords = ['vpn', 'tunnel', 'wireguard', 'openvpn', 'ikev2'];
    }

    detect(events) {
        const results = [];
        for (const event of events) {
            const str = JSON.stringify(event).toLowerCase();
            for (const keyword of this.keywords) {
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

class JailbreakDetector extends BaseDetector {
    constructor() {
        super('Jailbreak Detector');
        this.keywords = ['cydia', 'sileo', 'zebra', 'substrate', 'substitute'];
    }

    detect(events) {
        const results = [];
        for (const event of events) {
            const str = JSON.stringify(event).toLowerCase();
            for (const keyword of this.keywords) {
                if (str.includes(keyword)) {
                    results.push(this.createResult(
                        'Jailbreak Evidence',
                        { source: event.source, keyword: keyword },
                        'critical'
                    ));
                    break;
                }
            }
        }
        return results;
    }
}

class SideloadDetector extends BaseDetector {
    constructor() {
        super('Sideload Detector');
        this.keywords = ['altstore', 'trollstore', 'sidestore', 'scarlet', 'esign'];
    }

    detect(events) {
        const results = [];
        for (const event of events) {
            const str = JSON.stringify(event).toLowerCase();
            for (const keyword of this.keywords) {
                if (str.includes(keyword)) {
                    results.push(this.createResult(
                        'Sideload Evidence',
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

class HookDetector extends BaseDetector {
    constructor() {
        super('Hook Detector');
        this.keywords = ['frida', 'cycript', 'hook', 'inject'];
    }

    detect(events) {
        const results = [];
        for (const event of events) {
            const str = JSON.stringify(event).toLowerCase();
            for (const keyword of this.keywords) {
                if (str.includes(keyword)) {
                    results.push(this.createResult(
                        'Hook Evidence',
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

class FreeFireDetector extends BaseDetector {
    constructor() {
        super('FreeFire Detector');
    }

    detect(events) {
        const results = [];
        for (const event of events) {
            const str = JSON.stringify(event).toLowerCase();
            if (str.includes('freefire') || str.includes('garena')) {
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

// ============================================
// 9. DETECTOR MANAGER
// ============================================

class DetectorManager {
    constructor() {
        this.detectors = [];
    }

    register(detector) {
        this.detectors.push(detector);
    }

    analyze(events) {
        const results = [];
        for (const detector of this.detectors) {
            try {
                const detections = detector.detect(events);
                results.push(...detections);
            } catch (error) {
                Logger.error(`Erro no detector ${detector.name}: ${error.message}`);
            }
        }
        return results;
    }

    getDetectorCount() { return this.detectors.length; }
}

// ============================================
// 10. SCORE ENGINE
// ============================================

class ScoreEngine {
    constructor() {
        this.weights = { critical: 100, high: 50, medium: 25, low: 10 };
    }

    calculate(detections) {
        let total = 0;
        const byConfidence = { critical: 0, high: 0, medium: 0, low: 0 };
        
        for (const d of detections) {
            const conf = d.confidence || 'low';
            total += this.weights[conf] || 10;
            byConfidence[conf] = (byConfidence[conf] || 0) + 1;
        }

        let riskLevel = 'low';
        if (total >= 300) riskLevel = 'critical';
        else if (total >= 200) riskLevel = 'high';
        else if (total >= 100) riskLevel = 'medium';

        return { total: Math.min(total, 1000), riskLevel, byConfidence };
    }

    getRecommendations(score) {
        const recommendations = [];
        if (score.riskLevel === 'critical' || score.riskLevel === 'high') {
            recommendations.push('🔍 Realizar análise aprofundada');
            recommendations.push('📋 Verificar certificados e configurações');
        }
        if (score.byConfidence?.critical > 0) {
            recommendations.push('⚠️ Evidências críticas encontradas - priorizar investigação');
        }
        return recommendations;
    }
}

// ============================================
// 11. UI
// ============================================

class ScriptableUI {
    constructor(scanner) {
        this.scanner = scanner;
    }

    async showMainMenu() {
        const alert = new Alert();
        alert.title = '🔍 iOS Evidence Scanner';
        alert.message = `v2.2.1\n\nScanner forense para análise de evidências`;
        alert.addAction('🔍 Nova Análise');
        alert.addAction('📖 Ajuda');
        alert.addAction('❌ Sair');
        return await alert.presentAlert();
    }

    async selectFiles() {
        if (!this.scanner || !this.scanner.fileLoader) {
            throw new Error('FileLoader não disponível');
        }
        return await this.scanner.fileLoader.selectFiles();
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
        const percentage = Math.round((current / total) * 100);
        const bar = '█'.repeat(Math.round(percentage/5)) + '░'.repeat(20 - Math.round(percentage/5));
        console.log(`${percentage}% - ${message}`);
        
        if (percentage % 25 === 0 || percentage === 100) {
            const alert = new Alert();
            alert.title = '🔄 Processando...';
            alert.message = `${message}\n\n${bar}\n${percentage}% concluído`;
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
        webView.title = '📊 Relatório';
        webView.loadHTML(this.generateReportHTML(report));
        await webView.present(true);
    }

    generateReportHTML(report) {
        return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Relatório</title>
<style>
body { font-family: -apple-system, BlinkMacSystemFont, sans-serif; background: #f5f5f5; color: #333; padding: 20px; }
.container { max-width: 800px; margin: 0 auto; background: white; padding: 30px; border-radius: 10px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
h1 { color: #007aff; }
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
    <p>Versão: ${report.version} • ${new Date(report.generated).toLocaleString('pt-BR')}</p>
    
    <div style="display:flex; justify-content:space-between; align-items:center; margin:20px 0;">
        <div><span class="score">${report.score}</span><br>Score</div>
        <div><span class="risk risk-${report.riskLevel}">${(report.riskLevel || 'low').toUpperCase()}</span></div>
    </div>
    
    <div class="stats">
        <div class="stat-box">${report.totalEvents}<br>Eventos</div>
        <div class="stat-box">${report.totalDetections}<br>Detecções</div>
    </div>
    
    ${report.detections && report.detections.length > 0 ? `
    <h2>🔎 Detecções (${report.detections.length})</h2>
    ${report.detections.map(d => `
        <div class="detection confidence-${d.confidence || 'low'}">
            <strong>${d.type || 'Detecção'}</strong> [${(d.confidence || 'low').toUpperCase()}]
            <br><span style="color:#666;font-size:14px;">${d.explanation || ''}</span>
            ${d.evidence?.source ? `<br><span style="color:#999;font-size:12px;">📁 ${d.evidence.source}</span>` : ''}
        </div>
    `).join('')}
    ` : '<p>Nenhuma detecção encontrada</p>'}
    
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
  Tempo: ${(stats.executionTime / 1000).toFixed(2)}s
  Arquivos: ${stats.fileCount || 0}

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
        alert.message = error.message || 'Erro inesperado';
        alert.addAction('OK');
        await alert.presentAlert();
    }

    async showHelp() {
        const alert = new Alert();
        alert.title = '📖 Ajuda';
        alert.message = `
🔍 iOS Evidence Scanner

📁 Formatos suportados:
PLIST, JSON, NDJSON, IPS, LOG, CSV, XML, TXT

🔎 Detectores:
- Proxy
- VPN
- Jailbreak
- Sideload
- Hook
- Free Fire

📂 Como usar:
1. Coloque arquivos na pasta do Scriptable
2. Execute o scanner
3. Selecione os arquivos
4. Aguarde a análise
5. Veja o relatório

Níveis de confiança:
🔴 Crítico - Evidência forte
🟠 Alta - Evidência significativa
🟡 Média - Indício
🟢 Baixa - Possível indício
        `;
        alert.addAction('OK');
        await alert.presentAlert();
    }
}

// ============================================
// 12. APPLICATION
// ============================================

class Application {
    constructor() {
        this.configManager = new ConfigManager();
        this.fileLoader = new ScriptableFileLoader(this.configManager);
        this.parser = new AdvancedParser();
        this.detectorManager = new DetectorManager();
        this.scoreEngine = new ScoreEngine();
        this.ui = new ScriptableUI(this);
        
        this.events = [];
        this.detections = [];
        this.startTime = null;
        this.endTime = null;
        
        this.registerDetectors();
    }

    registerDetectors() {
        this.detectorManager.register(new ProxyDetector());
        this.detectorManager.register(new VPNDetector());
        this.detectorManager.register(new JailbreakDetector());
        this.detectorManager.register(new SideloadDetector());
        this.detectorManager.register(new HookDetector());
        this.detectorManager.register(new FreeFireDetector());
    }

    async run() {
        try {
            while (true) {
                const action = await this.ui.showMainMenu();
                switch (action) {
                    case 0: await this.runAnalysis(); break;
                    case 1: await this.ui.showHelp(); break;
                    case 2: return;
                }
            }
        } catch (error) {
            await this.ui.showError(error);
        }
    }

    async runAnalysis() {
        try {
            // Selecionar arquivos
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

            // Processar arquivos
            const totalFiles = files.length;
            for (let i = 0; i < totalFiles; i++) {
                const file = files[i];
                await this.ui.showProgress(i, totalFiles, `Analisando: ${file.name}`);
                
                const parsedEvents = await this.parser.parse(file);
                this.events.push(...parsedEvents);
            }

            // Detectar
            await this.ui.showProgress(1, 1, 'Executando detectores...');
            this.detections = this.detectorManager.analyze(this.events);

            // Calcular score
            const score = this.scoreEngine.calculate(this.detections);
            this.endTime = Date.now();

            // Gerar relatório
            const report = {
                appName: this.configManager.get('appName'),
                version: this.configManager.get('version'),
                generated: new Date().toISOString(),
                totalEvents: this.events.length,
                totalDetections: this.detections.length,
                score: score.total,
                riskLevel: score.riskLevel,
                detections: this.detections,
                recommendations: this.scoreEngine.getRecommendations(score),
                files: files.map(f => ({ name: f.name, size: f.size }))
            };

            await this.ui.showReport(report);

            // Estatísticas
            const statsData = {
                totalEvents: this.events.length,
                totalDetections: this.detections.length,
                executionTime: this.endTime - this.startTime,
                fileCount: files.length,
                byConfidence: score.byConfidence
            };
            await this.ui.showStats(statsData);

        } catch (error) {
            await this.ui.showError(error);
        }
    }
}

// ============================================
// 13. PONTO DE ENTRADA
// ============================================

(async () => {
    try {
        const app = new Application();
        await app.run();
    } catch (error) {
        console.error('Erro:', error.message);
        const alert = new Alert();
        alert.title = '❌ Erro Fatal';
        alert.message = error.message;
        alert.addAction('OK');
        await alert.presentAlert();
    }
})();
