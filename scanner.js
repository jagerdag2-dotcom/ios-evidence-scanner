// ============================================
// iOS EVIDENCE SCANNER - VERSÃO FINAL 2.2.1
// ============================================

// ============================================
// 1. CONFIGURATION
// ============================================

const CONFIG = {
    appName: 'iOS Evidence Scanner',
    version: '2.2.1',
    maxFileSize: 50 * 1024 * 1024,
    supportedExtensions: ['.plist', '.log', '.txt', '.json', '.ips', '.csv', '.xml', '.ndjson', '.ndj', '.jsonl']
};

// ============================================
// 2. LOGGER
// ============================================

function log(message, level = 'INFO') {
    console.log(`[${new Date().toISOString()}] [${level}] ${message}`);
}

// ============================================
// 3. FILE LOADER - FUNCIONA NO IPHONE
// ============================================

class FileLoader {
    constructor() {
        this.selectedFiles = [];
    }

    async selectFiles() {
        try {
            log('Abrindo seletor de arquivos...');
            
            // MÉTODO PRINCIPAL: Usar DocumentPicker
            const files = await this.selectWithDocumentPicker();
            if (files && files.length > 0) {
                this.selectedFiles = files;
                return files;
            }

            // FALLBACK: Listar arquivos da pasta do Scriptable
            const fallbackFiles = await this.selectFromScriptableFolder();
            if (fallbackFiles && fallbackFiles.length > 0) {
                this.selectedFiles = fallbackFiles;
                return fallbackFiles;
            }

            log('Nenhum arquivo selecionado');
            return [];

        } catch (error) {
            log(`Erro na seleção: ${error.message}`, 'ERROR');
            return await this.selectFromScriptableFolder();
        }
    }

    async selectWithDocumentPicker() {
        try {
            // Usar DocumentPicker do Scriptable
            const dp = new DocumentPicker();
            
            // Apresentar o seletor
            const result = await dp.present(true); // true = múltiplos arquivos
            
            if (!result || result.length === 0) {
                log('Nenhum arquivo selecionado no DocumentPicker');
                return [];
            }

            log(`${result.length} arquivo(s) selecionado(s)`);
            
            const loadedFiles = [];
            for (const file of result) {
                try {
                    // Ler o conteúdo do arquivo
                    const content = file.readString();
                    if (content) {
                        const fileName = file.fileName || 'arquivo';
                        const ext = this.getFileExtension(fileName);
                        
                        // Verificar se é um formato suportado
                        if (CONFIG.supportedExtensions.includes(ext)) {
                            loadedFiles.push({
                                name: fileName,
                                path: file.filePath || '',
                                extension: ext,
                                size: content.length,
                                modified: new Date(),
                                content: content,
                                type: this.detectFileType(fileName)
                            });
                        } else {
                            log(`Arquivo ignorado (formato não suportado): ${fileName}`, 'WARN');
                        }
                    }
                } catch (e) {
                    log(`Erro ao ler arquivo: ${e.message}`, 'ERROR');
                }
            }

            return loadedFiles;

        } catch (error) {
            log(`DocumentPicker falhou: ${error.message}`, 'WARN');
            return [];
        }
    }

    async selectFromScriptableFolder() {
        try {
            const fm = FileManager.iCloud();
            const docs = fm.documentsDirectory();
            
            log(`Procurando arquivos em: ${docs}`);
            
            let items = [];
            try {
                items = fm.listContents(docs);
            } catch (e) {
                log('Erro ao listar iCloud, tentando local...', 'WARN');
                const localFM = FileManager.local();
                const localDocs = localFM.documentsDirectory();
                items = localFM.listContents(localDocs);
            }

            if (!items || items.length === 0) {
                log('Nenhum arquivo encontrado');
                return [];
            }

            // Filtrar arquivos suportados
            const supportedItems = items.filter(item => {
                const ext = this.getFileExtension(item);
                return CONFIG.supportedExtensions.includes(ext);
            });

            if (supportedItems.length === 0) {
                const alert = new Alert();
                alert.title = 'ℹ️ Nenhum arquivo suportado';
                alert.message = `Coloque arquivos com estas extensões na pasta do Scriptable:\n\n${CONFIG.supportedExtensions.join(', ')}`;
                alert.addAction('OK');
                await alert.presentAlert();
                return [];
            }

            // Criar tabela de seleção
            const table = new UITable();
            table.title = '📂 Selecione os arquivos';
            
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
                
                // Adicionar checkbox para seleção múltipla
                const checkbox = row.addCheckbox();
                
                fileInfos.push({ 
                    item, 
                    path, 
                    size: fileSize, 
                    content, 
                    row,
                    checkbox 
                });
                table.addRow(row);
            }

            // Adicionar botão Selecionar Todos
            table.addAction('📂 Selecionar Todos', (table) => {
                for (const row of table.rows) {
                    row.select();
                }
            });

            // Botão para analisar
            let result = null;
            table.addAction('📊 Analisar Selecionados', async (table) => {
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
                        log(`Erro ao ler ${fileInfo.item}: ${error.message}`, 'ERROR');
                    }
                }
                result = files;
                return files;
            });
            
            table.addAction('❌ Cancelar', () => {
                result = [];
                return [];
            });

            // Apresentar a tabela
            await table.present();

            // Aguardar resultado
            let attempts = 0;
            while (result === null && attempts < 30) {
                await new Promise(resolve => setTimeout(resolve, 100));
                attempts++;
            }

            // Se ainda não tiver resultado, verificar selectedRows
            if (!result || result.length === 0) {
                const selectedRows = table.selectedRows;
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
            log(`Erro ao selecionar da pasta: ${error.message}`, 'ERROR');
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
            '.ips': 'Crash Report'
        };
        return typeMap[ext] || 'Desconhecido';
    }

    getFileExtension(filename) {
        if (!filename) return '';
        const lastDot = filename.lastIndexOf('.');
        return lastDot > 0 ? filename.substring(lastDot).toLowerCase() : '';
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
            '.ips': '💥'
        };
        return iconMap[extension] || '📁';
    }

    getSelectedFiles() { return this.selectedFiles; }
}

// ============================================
// 4. PARSER
// ============================================

class Parser {
    async parse(file) {
        const events = [];
        const ext = file.extension || '';
        
        try {
            if (ext === '.json' || ext === '.ndjson' || ext === '.ndj' || ext === '.jsonl') {
                return this.parseJSON(file);
            } else if (ext === '.plist') {
                return this.parsePlist(file);
            } else if (ext === '.ips') {
                return this.parseIPS(file);
            } else if (ext === '.log' || ext === '.txt') {
                return this.parseLog(file);
            } else if (ext === '.csv') {
                return this.parseCSV(file);
            } else {
                return this.parseLog(file);
            }
        } catch (error) {
            log(`Erro no parser: ${error.message}`, 'ERROR');
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
                    events.push({
                        timestamp: new Date(),
                        source: file.name,
                        category: 'JSON',
                        type: 'event',
                        description: `Linha ${i + 1}`,
                        data: data,
                        raw: lines[i].substring(0, 500)
                    });
                } catch (e) {}
            }
        } catch (error) {
            log(`Erro no JSON: ${error.message}`, 'ERROR');
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
                    events.push({
                        timestamp: new Date(),
                        source: file.name,
                        category: 'Plist',
                        type: 'plist',
                        description: `Arquivo PLIST com ${Object.keys(data).length} chaves`,
                        data: data,
                        raw: content.substring(0, 500)
                    });
                }
            }
        } catch (error) {
            log(`Erro no PLIST: ${error.message}`, 'ERROR');
        }
        return events;
    }

    parseIPS(file) {
        const events = [];
        const content = file.content;
        
        const appMatch = content.match(/Application Name:\s*([^\n]+)/i) || content.match(/Process:\s*([^\n]+)/i);
        if (appMatch) {
            events.push({
                timestamp: new Date(),
                source: file.name,
                category: 'Crash',
                type: 'crash_app',
                description: `Aplicativo: ${appMatch[1]}`,
                data: { app: appMatch[1] }
            });
        }

        const exceptionMatch = content.match(/Exception Type:\s*([^\n]+)/i);
        if (exceptionMatch) {
            events.push({
                timestamp: new Date(),
                source: file.name,
                category: 'Crash',
                type: 'crash_exception',
                description: `Exceção: ${exceptionMatch[1]}`,
                data: { exception: exceptionMatch[1] }
            });
        }

        if (content.toLowerCase().includes('jailbreak') || content.toLowerCase().includes('cydia')) {
            events.push({
                timestamp: new Date(),
                source: file.name,
                category: 'Jailbreak',
                type: 'jailbreak_indicator',
                description: 'Indicador de jailbreak no crash report',
                data: { indicator: 'Jailbreak' }
            });
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
            
            events.push({
                timestamp: new Date(),
                source: file.name,
                category: category,
                type: type,
                description: line.substring(0, 200),
                data: { line: line.substring(0, 500) },
                raw: line.substring(0, 500)
            });
        }
        return events;
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
                events.push({
                    timestamp: new Date(),
                    source: file.name,
                    category: 'CSV',
                    type: 'row',
                    description: `Linha ${i}`,
                    data: data,
                    raw: lines[i].substring(0, 500)
                });
            }
        }
        return events;
    }
}

// ============================================
// 5. DETECTORS
// ============================================

class Detector {
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
            explanation: `Evidência de ${type} encontrada em ${evidence.source || 'arquivo'}`
        };
    }
}

class ProxyDetector extends Detector {
    constructor() {
        super('Proxy Detector');
        this.keywords = ['proxy', 'mitm', 'charles', 'burp', 'fiddler', 'proxyman', 'surge', 'quantumult', 'shadowrocket'];
    }

    detect(events) {
        const results = [];
        for (const event of events) {
            const str = JSON.stringify(event).toLowerCase();
            for (const keyword of this.keywords) {
                if (str.includes(keyword)) {
                    results.push(this.createResult('Proxy Evidence', { source: event.source, keyword: keyword }, 'high'));
                    break;
                }
            }
        }
        return results;
    }
}

class VPNDetector extends Detector {
    constructor() {
        super('VPN Detector');
        this.keywords = ['vpn', 'tunnel', 'wireguard', 'openvpn', 'ikev2', 'l2tp', 'pptp'];
    }

    detect(events) {
        const results = [];
        for (const event of events) {
            const str = JSON.stringify(event).toLowerCase();
            for (const keyword of this.keywords) {
                if (str.includes(keyword)) {
                    results.push(this.createResult('VPN Evidence', { source: event.source, keyword: keyword }, 'high'));
                    break;
                }
            }
        }
        return results;
    }
}

class JailbreakDetector extends Detector {
    constructor() {
        super('Jailbreak Detector');
        this.keywords = ['cydia', 'sileo', 'zebra', 'substrate', 'substitute', 'procursus', 'ellekit'];
    }

    detect(events) {
        const results = [];
        for (const event of events) {
            const str = JSON.stringify(event).toLowerCase();
            for (const keyword of this.keywords) {
                if (str.includes(keyword)) {
                    results.push(this.createResult('Jailbreak Evidence', { source: event.source, keyword: keyword }, 'critical'));
                    break;
                }
            }
        }
        return results;
    }
}

class SideloadDetector extends Detector {
    constructor() {
        super('Sideload Detector');
        this.keywords = ['altstore', 'trollstore', 'sidestore', 'scarlet', 'esign', '3utools'];
    }

    detect(events) {
        const results = [];
        for (const event of events) {
            const str = JSON.stringify(event).toLowerCase();
            for (const keyword of this.keywords) {
                if (str.includes(keyword)) {
                    results.push(this.createResult('Sideload Evidence', { source: event.source, keyword: keyword }, 'high'));
                    break;
                }
            }
        }
        return results;
    }
}

class HookDetector extends Detector {
    constructor() {
        super('Hook Detector');
        this.keywords = ['frida', 'cycript', 'hook', 'inject', 'substrate'];
    }

    detect(events) {
        const results = [];
        for (const event of events) {
            const str = JSON.stringify(event).toLowerCase();
            for (const keyword of this.keywords) {
                if (str.includes(keyword)) {
                    results.push(this.createResult('Hook Evidence', { source: event.source, keyword: keyword }, 'high'));
                    break;
                }
            }
        }
        return results;
    }
}

class FreeFireDetector extends Detector {
    constructor() {
        super('FreeFire Detector');
    }

    detect(events) {
        const results = [];
        for (const event of events) {
            const str = JSON.stringify(event).toLowerCase();
            if (str.includes('freefire') || str.includes('garena') || str.includes('ff ')) {
                results.push(this.createResult('FreeFire Evidence', { source: event.source }, 'medium'));
            }
        }
        return results;
    }
}

class CertificateDetector extends Detector {
    constructor() {
        super('Certificate Detector');
        this.keywords = ['certificate', 'cert', 'pem', 'crt', 'ssl', 'trust', 'ca'];
    }

    detect(events) {
        const results = [];
        for (const event of events) {
            const str = JSON.stringify(event).toLowerCase();
            for (const keyword of this.keywords) {
                if (str.includes(keyword)) {
                    results.push(this.createResult('Certificate Evidence', { source: event.source, keyword: keyword }, 'medium'));
                    break;
                }
            }
        }
        return results;
    }
}

// ============================================
// 6. SCORE ENGINE
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
            recommendations.push('🔍 Realizar análise aprofundada dos arquivos');
            recommendations.push('📋 Verificar certificados e configurações de rede');
            recommendations.push('🛡️ Validar integridade do sistema');
        }
        if (score.byConfidence?.critical > 0) {
            recommendations.push('⚠️ Evidências críticas encontradas - priorizar investigação');
        }
        if (score.byConfidence?.high > 2) {
            recommendations.push('📊 Múltiplas evidências de alta confiança - verificar em detalhes');
        }
        return recommendations;
    }
}

// ============================================
// 7. UI - FUNCIONA NO IPHONE
// ============================================

class UI {
    constructor(app) {
        this.app = app;
    }

    async showMainMenu() {
        const alert = new Alert();
        alert.title = '🔍 iOS Evidence Scanner';
        alert.message = `v${CONFIG.version}\n\nScanner forense para análise de evidências em arquivos iOS\n\n📁 Formatos: PLIST, JSON, NDJSON, IPS, LOG, CSV, XML, TXT\n🔎 Detectores: Proxy, VPN, Jailbreak, Sideload, Hook, Free Fire, Certificados`;
        alert.addAction('🔍 Nova Análise');
        alert.addAction('📖 Ajuda');
        alert.addAction('❌ Sair');
        return await alert.presentAlert();
    }

    async selectFiles() {
        if (!this.app || !this.app.fileLoader) {
            throw new Error('FileLoader não disponível');
        }
        return await this.app.fileLoader.selectFiles();
    }

    async showFileInfo(files) {
        if (!files || files.length === 0) return false;
        
        let message = `📂 ${files.length} arquivo(s) selecionado(s):\n\n`;
        let totalSize = 0;
        
        for (const file of files) {
            const size = this.app.fileLoader.formatFileSize(file.size);
            totalSize += file.size || 0;
            message += `📄 ${file.name}\n   Tipo: ${file.type || 'Desconhecido'} • Tamanho: ${size}\n\n`;
        }
        
        message += `📊 Total: ${this.app.fileLoader.formatFileSize(totalSize)}`;
        
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
        log(`${percentage}% - ${message}`);
        
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
* { margin:0; padding:0; box-sizing:border-box; }
body { font-family: -apple-system, BlinkMacSystemFont, sans-serif; background: #f5f5f5; color: #333; padding: 16px; }
.container { max-width: 800px; margin: 0 auto; background: white; padding: 24px; border-radius: 12px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
.header { border-bottom: 3px solid #007aff; padding-bottom: 16px; margin-bottom: 20px; }
h1 { color: #007aff; font-size: 24px; }
.meta { color: #666; font-size: 14px; margin-top: 4px; }
.score-section { background: linear-gradient(135deg, #007aff, #0051d5); color: white; padding: 20px; border-radius: 10px; margin-bottom: 20px; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; }
.score-number { font-size: 48px; font-weight: bold; }
.risk-level { padding: 8px 20px; border-radius: 20px; font-weight: bold; font-size: 16px; }
.risk-critical { background: #ff3b30; }
.risk-high { background: #ff9500; }
.risk-medium { background: #ffcc00; color: #000; }
.risk-low { background: #34c759; }
.stats-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap: 12px; margin-bottom: 20px; }
.stat-box { background: #f8f9fa; padding: 12px; border-radius: 8px; text-align: center; }
.stat-box .number { font-size: 22px; font-weight: bold; color: #007aff; }
.stat-box .label { color: #666; font-size: 12px; margin-top: 4px; }
.section { margin-top: 24px; border-top: 1px solid #e5e5e5; padding-top: 16px; }
.section h2 { color: #333; margin-bottom: 12px; font-size: 18px; }
.detection-item { background: #f8f9fa; padding: 12px; border-radius: 8px; margin-bottom: 8px; border-left: 4px solid #007aff; }
.detection-item .type { font-weight: bold; color: #007aff; }
.detection-item .confidence { float: right; padding: 2px 10px; border-radius: 10px; font-size: 11px; font-weight: bold; }
.confidence-critical { background: #ff3b30; color: white; }
.confidence-high { background: #ff9500; color: white; }
.confidence-medium { background: #ffcc00; color: #000; }
.confidence-low { background: #34c759; color: white; }
.detection-item .details { margin-top: 4px; color: #666; font-size: 13px; }
.recommendations { background: #f0f7ff; padding: 16px; border-radius: 8px; margin-top: 16px; }
.recommendations ul { padding-left: 20px; margin-top: 8px; }
.recommendations li { margin: 6px 0; }
.footer { text-align: center; color: #999; padding-top: 20px; font-size: 12px; border-top: 1px solid #eee; margin-top: 20px; }
</style>
</head>
<body>
<div class="container">
    <div class="header">
        <h1>🔍 ${report.appName || 'iOS Evidence Scanner'}</h1>
        <div class="meta">Versão: ${report.version} • ${new Date(report.generated).toLocaleString('pt-BR')}</div>
    </div>
    
    <div class="score-section">
        <div>
            <div class="score-number">${report.score}</div>
            <div style="font-size:14px;opacity:0.8;">Score de Evidências</div>
        </div>
        <div>
            <div class="risk-level risk-${report.riskLevel}">${(report.riskLevel || 'low').toUpperCase()}</div>
        </div>
    </div>
    
    <div class="stats-grid">
        <div class="stat-box"><div class="number">${report.totalEvents}</div><div class="label">Eventos</div></div>
        <div class="stat-box"><div class="number">${report.totalDetections}</div><div class="label">Detecções</div></div>
        <div class="stat-box"><div class="number">${report.byConfidence?.critical || 0}</div><div class="label">Crítico</div></div>
        <div class="stat-box"><div class="number">${report.byConfidence?.high || 0}</div><div class="label">Alta</div></div>
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
                <div class="details">${d.explanation || ''}</div>
                ${d.evidence?.source ? `<div class="details">📁 ${d.evidence.source}</div>` : ''}
                ${d.evidence?.keyword ? `<div class="details">🔑 ${d.evidence.keyword}</div>` : ''}
            </div>
        `).join('')}
        ${report.detections.length > 100 ? `<div style="color:#999;padding:10px;">... e mais ${report.detections.length - 100} detecções</div>` : ''}
    </div>` : ''}

    ${report.recommendations && report.recommendations.length > 0 ? `
    <div class="section">
        <div class="recommendations">
            <h2>💡 Recomendações</h2>
            <ul>${report.recommendations.map(r => `<li>${r}</li>`).join('')}</ul>
        </div>
    </div>` : ''}

    <div class="footer">
        ${report.appName || 'iOS Evidence Scanner'} - Análise baseada exclusivamente em evidências nos arquivos
    </div>
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
        alert.message = error.message || 'Ocorreu um erro inesperado';
        alert.addAction('OK');
        await alert.presentAlert();
    }

    async showHelp() {
        const alert = new Alert();
        alert.title = '📖 Ajuda - iOS Evidence Scanner';
        alert.message = `
🔍 O que faz?
Analisa arquivos do sistema iOS em busca de evidências técnicas.

📁 Formatos Suportados:
PLIST, JSON, NDJSON, IPS, LOG, CSV, XML, TXT

🔎 Detectores Disponíveis:
• Proxy - Detecta ferramentas de proxy/MITM
• VPN - Detecta configurações de VPN
• Jailbreak - Detecta ferramentas de jailbreak
• Sideload - Detecta sideload de apps
• Hook - Detecta ferramentas de hook/injeção
• Free Fire - Detecta atividade do Free Fire
• Certificados - Detecta certificados SSL

📂 Como usar:
1. Execute o script no Scriptable
2. Selecione "Nova Análise"
3. Escolha o(s) arquivo(s) para analisar
4. Aguarde o processamento
5. Visualize o relatório completo

📊 Níveis de Confiança:
🔴 Crítico - Evidência muito forte
🟠 Alta - Evidência significativa
🟡 Média - Indício relevante
🟢 Baixa - Possível indício
        `;
        alert.addAction('OK');
        await alert.presentAlert();
    }
}

// ============================================
// 8. APPLICATION
// ============================================

class Application {
    constructor() {
        this.fileLoader = new FileLoader();
        this.parser = new Parser();
        this.scoreEngine = new ScoreEngine();
        this.ui = new UI(this);
        
        this.detectors = [];
        this.events = [];
        this.detections = [];
        this.startTime = null;
        this.endTime = null;
        
        this.registerDetectors();
    }

    registerDetectors() {
        this.detectors.push(new ProxyDetector());
        this.detectors.push(new VPNDetector());
        this.detectors.push(new JailbreakDetector());
        this.detectors.push(new SideloadDetector());
        this.detectors.push(new HookDetector());
        this.detectors.push(new FreeFireDetector());
        this.detectors.push(new CertificateDetector());
        log(`${this.detectors.length} detectores registrados`);
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
            log(`Erro: ${error.message}`, 'ERROR');
            await this.ui.showError(error);
        }
    }

    async runAnalysis() {
        try {
            // 1. Selecionar arquivos
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

            // 2. Processar arquivos
            const totalFiles = files.length;
            for (let i = 0; i < totalFiles; i++) {
                const file = files[i];
                await this.ui.showProgress(i, totalFiles, `📂 Analisando: ${file.name}`);
                
                const parsedEvents = await this.parser.parse(file);
                this.events.push(...parsedEvents);
                log(`${parsedEvents.length} eventos extraídos de ${file.name}`);
            }

            // 3. Executar detectores
            await this.ui.showProgress(1, 1, '🔎 Executando detectores...');
            for (const detector of this.detectors) {
                try {
                    const detections = detector.detect(this.events);
                    this.detections.push(...detections);
                } catch (error) {
                    log(`Erro no detector ${detector.name}: ${error.message}`, 'ERROR');
                }
            }
            log(`${this.detections.length} detecções encontradas`);

            // 4. Calcular score
            const score = this.scoreEngine.calculate(this.detections);
            this.endTime = Date.now();

            // 5. Gerar relatório
            const report = {
                appName: CONFIG.appName,
                version: CONFIG.version,
                generated: new Date().toISOString(),
                totalEvents: this.events.length,
                totalDetections: this.detections.length,
                score: score.total,
                riskLevel: score.riskLevel,
                byConfidence: score.byConfidence,
                detections: this.detections,
                recommendations: this.scoreEngine.getRecommendations(score),
                files: files.map(f => ({ name: f.name, size: f.size }))
            };

            await this.ui.showReport(report);

            // 6. Mostrar estatísticas
            const statsData = {
                totalEvents: this.events.length,
                totalDetections: this.detections.length,
                executionTime: this.endTime - this.startTime,
                fileCount: files.length,
                byConfidence: score.byConfidence
            };
            await this.ui.showStats(statsData);

            log(`Análise concluída em ${((this.endTime - this.startTime) / 1000).toFixed(2)}s`);

        } catch (error) {
            log(`Erro na análise: ${error.message}`, 'ERROR');
            await this.ui.showError(error);
        }
    }
}

// ============================================
// 9. PONTO DE ENTRADA
// ============================================

(async () => {
    try {
        const app = new Application();
        await app.run();
    } catch (error) {
        log(`Erro fatal: ${error.message}`, 'ERROR');
        const alert = new Alert();
        alert.title = '❌ Erro Fatal';
        alert.message = `Ocorreu um erro:\n\n${error.message}`;
        alert.addAction('OK');
        await alert.presentAlert();
    }
})();
