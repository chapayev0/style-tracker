"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.deactivate = exports.activate = void 0;
const vscode = __importStar(require("vscode"));
const path = __importStar(require("path"));
const fs = __importStar(require("fs"));
let cssEditor;
let decorationType;
let statusBarItem;
let isTrackingEnabled = true; // Default to enabled
function activate(context) {
    console.log('HTML Style Tracker is now active');
    // Create decoration type for highlighting CSS rules
    decorationType = vscode.window.createTextEditorDecorationType({
        backgroundColor: new vscode.ThemeColor('editor.findMatchHighlightBackground'),
        border: '2px solid',
        borderColor: new vscode.ThemeColor('editor.findMatchBorder'),
    });
    // Create status bar item
    statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    statusBarItem.text = "$(link) Style Tracker";
    context.subscriptions.push(statusBarItem);
    // Set initial context
    vscode.commands.executeCommand('setContext', 'htmlCssTracker.isTrackingEnabled', isTrackingEnabled);
    // Track cursor position changes in any file type
    const cursorDisposable = vscode.window.onDidChangeTextEditorSelection(event => {
        if (isTrackingEnabled) {
            handleCursorChange(event.textEditor);
        }
    });
    // Track active editor changes in any file type
    const editorDisposable = vscode.window.onDidChangeActiveTextEditor(editor => {
        if (isTrackingEnabled && editor) {
            handleCursorChange(editor);
        }
    });
    // Command to enable tracking
    const startTrackingCommand = vscode.commands.registerCommand('htmlCssTracker.startTracking', () => {
        isTrackingEnabled = true;
        vscode.commands.executeCommand('setContext', 'htmlCssTracker.isTrackingEnabled', true);
        vscode.window.showInformationMessage('Style Tracking enabled');
    });
    // Command to disable tracking
    const stopTrackingCommand = vscode.commands.registerCommand('htmlCssTracker.stopTracking', () => {
        isTrackingEnabled = false;
        vscode.commands.executeCommand('setContext', 'htmlCssTracker.isTrackingEnabled', false);
        // Close CSS panel and clear highlights when disabling
        if (cssEditor) {
            cssEditor.setDecorations(decorationType, []);
            cssEditor = undefined;
        }
        statusBarItem.hide();
        vscode.window.showInformationMessage('Style Tracking disabled');
    });
    // Command to manually trigger CSS tracking
    const trackCommand = vscode.commands.registerCommand('htmlCssTracker.trackElement', () => {
        const editor = vscode.window.activeTextEditor;
        if (editor) {
            handleCursorChange(editor);
        }
        else {
            vscode.window.showInformationMessage('Please open a file to use Style Tracker');
        }
    });
    // Command to close CSS preview
    const closeCommand = vscode.commands.registerCommand('htmlCssTracker.close', () => {
        if (cssEditor) {
            cssEditor.setDecorations(decorationType, []);
            cssEditor = undefined;
        }
        statusBarItem.hide();
    });
    context.subscriptions.push(cursorDisposable, editorDisposable, startTrackingCommand, stopTrackingCommand, trackCommand, closeCommand, decorationType);
}
exports.activate = activate;
async function handleCursorChange(editor) {
    const position = editor.selection.active;
    const document = editor.document;
    const lineText = document.lineAt(position.line).text;
    // Get the word under cursor
    const wordRange = document.getWordRangeAtPosition(position, /[\w-]+/);
    if (!wordRange) {
        clearHighlights();
        return;
    }
    const word = document.getText(wordRange);
    // Check if cursor is on a class or id attribute
    const { type, selector } = detectSelectorType(lineText, word, wordRange.start.character);
    if (!type) {
        clearHighlights();
        return;
    }
    statusBarItem.text = `$(link) Tracking: ${selector}`;
    statusBarItem.show();
    // Find and highlight CSS rules
    await findAndHighlightCSSRules(editor, selector, type);
}
function detectSelectorType(lineText, word, cursorPos) {
    // Check if we're in a class attribute (HTML: class="...")
    const classMatch = lineText.match(/class\s*=\s*["']([^"']*)["']/);
    if (classMatch && classMatch.index !== undefined) {
        const classContent = classMatch[1];
        const classStart = lineText.indexOf(classContent, classMatch.index);
        const classEnd = classStart + classContent.length;
        if (cursorPos >= classStart && cursorPos <= classEnd) {
            return { type: 'class', selector: `.${word}` };
        }
    }
    // Check if we're in a className attribute (JSX/React: className="...")
    const classNameMatch = lineText.match(/className\s*=\s*["']([^"']*)["']/);
    if (classNameMatch && classNameMatch.index !== undefined) {
        const classContent = classNameMatch[1];
        const classStart = lineText.indexOf(classContent, classNameMatch.index);
        const classEnd = classStart + classContent.length;
        if (cursorPos >= classStart && cursorPos <= classEnd) {
            return { type: 'class', selector: `.${word}` };
        }
    }
    // Check if we're in an id attribute
    const idMatch = lineText.match(/id\s*=\s*["']([^"']*)["']/);
    if (idMatch && idMatch.index !== undefined) {
        const idContent = idMatch[1];
        const idStart = lineText.indexOf(idContent, idMatch.index);
        const idEnd = idStart + idContent.length;
        if (cursorPos >= idStart && cursorPos <= idEnd) {
            return { type: 'id', selector: `#${word}` };
        }
    }
    // Check if cursor is directly on a CSS class selector (e.g., .className)
    if (lineText[cursorPos - 1] === '.' || (cursorPos > 0 && lineText.substring(0, cursorPos).match(/\.\w*$/))) {
        return { type: 'class', selector: `.${word}` };
    }
    // Check if cursor is directly on a CSS id selector (e.g., #idName)
    if (lineText[cursorPos - 1] === '#' || (cursorPos > 0 && lineText.substring(0, cursorPos).match(/#\w*$/))) {
        return { type: 'id', selector: `#${word}` };
    }
    // Check if cursor is on an HTML element tag (e.g., <body>, <div>, <h1>)
    // Match opening tags: <tagname or <tagname> or <tagname attributes>
    const openTagMatch = lineText.match(/<(\w+)(?:\s|>|\/)/);
    if (openTagMatch && openTagMatch.index !== undefined) {
        const tagName = openTagMatch[1];
        const tagStart = openTagMatch.index + 1; // Position after '<'
        const tagEnd = tagStart + tagName.length;
        if (cursorPos >= tagStart && cursorPos <= tagEnd && word.toLowerCase() === tagName.toLowerCase()) {
            return { type: 'element', selector: tagName.toLowerCase() };
        }
    }
    // Match closing tags: </tagname>
    const closeTagMatch = lineText.match(/<\/(\w+)>/);
    if (closeTagMatch && closeTagMatch.index !== undefined) {
        const tagName = closeTagMatch[1];
        const tagStart = closeTagMatch.index + 2; // Position after '</'
        const tagEnd = tagStart + tagName.length;
        if (cursorPos >= tagStart && cursorPos <= tagEnd && word.toLowerCase() === tagName.toLowerCase()) {
            return { type: 'element', selector: tagName.toLowerCase() };
        }
    }
    return { type: null, selector: '' };
}
function findSelectorInInternalCSS(fileContent, selector, document) {
    const ranges = [];
    // Find all <style> tags and their content
    const styleTagRegex = /<style[^>]*>([\s\S]*?)<\/style>/gi;
    let styleMatch;
    while ((styleMatch = styleTagRegex.exec(fileContent)) !== null) {
        const cssContent = styleMatch[1];
        const styleStartIndex = styleMatch.index + styleMatch[0].indexOf('>') + 1;
        // Find the selector within this style block
        const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const selectorRegex = new RegExp(`(?:^|,|\\s)${escapedSelector}(?=[\\s,{:])`, 'gm');
        let match;
        while ((match = selectorRegex.exec(cssContent)) !== null) {
            // Calculate the actual position in the document
            const matchStartIndex = styleStartIndex + match.index;
            const matchStartPos = document.positionAt(matchStartIndex);
            // Find the entire CSS rule block
            let braceCount = 0;
            let foundOpenBrace = false;
            let ruleStart = matchStartIndex;
            let ruleEnd = matchStartIndex;
            // Search forward from the selector to find the complete rule
            for (let i = match.index; i < cssContent.length; i++) {
                const char = cssContent[i];
                if (char === '{') {
                    braceCount++;
                    foundOpenBrace = true;
                }
                else if (char === '}') {
                    braceCount--;
                    if (foundOpenBrace && braceCount === 0) {
                        ruleEnd = styleStartIndex + i + 1;
                        break;
                    }
                }
            }
            const startPos = document.positionAt(ruleStart);
            const endPos = document.positionAt(ruleEnd);
            ranges.push(new vscode.Range(startPos, endPos));
        }
    }
    return ranges;
}
async function findAndHighlightCSSRules(htmlEditor, selector, type) {
    const htmlDoc = htmlEditor.document;
    const htmlContent = htmlDoc.getText();
    // First, check for internal CSS in the same file (within <style> tags)
    const internalCSSRanges = findSelectorInInternalCSS(htmlContent, selector, htmlDoc);
    if (internalCSSRanges.length > 0) {
        // Open the same file in split view and highlight
        await openAndHighlightCSS(htmlDoc.uri.fsPath, internalCSSRanges);
        return;
    }
    // If not found in internal CSS, search linked external CSS files
    const cssFiles = findLinkedCSSFiles(htmlContent, htmlDoc.uri.fsPath);
    if (cssFiles.length === 0) {
        vscode.window.showInformationMessage('No local Style files found (external URLs or unresolved paths may have been skipped)');
        clearHighlights();
        return;
    }
    // Search for selector in external CSS files
    let found = false;
    for (const cssFile of cssFiles) {
        if (fs.existsSync(cssFile)) {
            const cssContent = await fs.promises.readFile(cssFile, 'utf8');
            const ranges = findSelectorInCSS(cssContent, selector);
            if (ranges.length > 0) {
                await openAndHighlightCSS(cssFile, ranges);
                found = true;
                break; // Highlight in first file found
            }
        }
    }
    if (!found) {
        vscode.window.showInformationMessage(`No CSS rules found for ${selector}`);
        clearHighlights();
    }
}
function findLinkedCSSFiles(htmlContent, htmlFilePath) {
    const cssFiles = [];
    const linkRegex = /<link[^>]*rel\s*=\s*["']stylesheet["'][^>]*href\s*=\s*["']([^"']+)["'][^>]*>/gi;
    const linkRegex2 = /<link[^>]*href\s*=\s*["']([^"']+)["'][^>]*rel\s*=\s*["']stylesheet["'][^>]*>/gi;
    let match;
    while ((match = linkRegex.exec(htmlContent)) !== null) {
        const href = match[1];
        const absolutePath = resolveFilePath(href, htmlFilePath);
        if (absolutePath)
            cssFiles.push(absolutePath);
    }
    while ((match = linkRegex2.exec(htmlContent)) !== null) {
        const href = match[1];
        const absolutePath = resolveFilePath(href, htmlFilePath);
        if (absolutePath && !cssFiles.includes(absolutePath)) {
            cssFiles.push(absolutePath);
        }
    }
    return cssFiles;
}
function resolveFilePath(href, htmlFilePath) {
    // Skip remote URLs (http(s) or protocol-relative)
    if (/^(https?:)?\/\//i.test(href)) {
        return null;
    }
    // If href starts with a leading slash, treat it as workspace-root relative when possible
    if (href.startsWith('/')) {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (workspaceFolders && workspaceFolders.length > 0) {
            const workspaceRoot = workspaceFolders[0].uri.fsPath;
            // remove leading slashes
            const rel = href.replace(/^\/+/, '');
            return path.resolve(workspaceRoot, rel);
        }
        // No workspace open — can't reliably resolve root-relative paths
        return null;
    }
    // Otherwise resolve relative to the HTML file
    const htmlDir = path.dirname(htmlFilePath);
    return path.resolve(htmlDir, href);
}
function findSelectorInCSS(cssContent, selector) {
    const ranges = [];
    const lines = cssContent.split('\n');
    // Escape special regex characters in selector
    const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        // Look for selector at start of rule or after comma
        const selectorRegex = new RegExp(`(?:^|,|\\s)${escapedSelector}(?=[\\s,{:])`, 'g');
        let match;
        while ((match = selectorRegex.exec(line)) !== null) {
            // Find the entire rule block
            let startLine = i;
            let endLine = i;
            let braceCount = 0;
            let foundOpenBrace = false;
            // Search forward for the closing brace
            for (let j = i; j < lines.length; j++) {
                const currentLine = lines[j];
                for (const char of currentLine) {
                    if (char === '{') {
                        braceCount++;
                        foundOpenBrace = true;
                    }
                    else if (char === '}') {
                        braceCount--;
                        if (foundOpenBrace && braceCount === 0) {
                            endLine = j;
                            break;
                        }
                    }
                }
                if (foundOpenBrace && braceCount === 0) {
                    break;
                }
            }
            ranges.push(new vscode.Range(new vscode.Position(startLine, 0), new vscode.Position(endLine, lines[endLine].length)));
        }
    }
    return ranges;
}
async function openAndHighlightCSS(cssFilePath, ranges) {
    const cssUri = vscode.Uri.file(cssFilePath);
    try {
        // If cssEditor is no longer visible, undefine it so a new one is created
        if (cssEditor && !vscode.window.visibleTextEditors.includes(cssEditor)) {
            cssEditor = undefined;
        }
        // Open the CSS document
        const doc = await vscode.workspace.openTextDocument(cssUri);
        // Decide which column to use: reuse the existing cssEditor column when possible
        let targetColumn = undefined;
        if (cssEditor && cssEditor.viewColumn) {
            targetColumn = cssEditor.viewColumn;
        }
        else {
            // default to Beside for the first time
            targetColumn = vscode.ViewColumn.Beside;
        }
        // If there was a previous cssEditor, clear its decorations so we don't leave stale highlights
        if (cssEditor && decorationType) {
            try {
                cssEditor.setDecorations(decorationType, []);
            }
            catch { /* ignore */ }
        }
        // Show the document in the target column — this will reuse the same editor pane when possible
        const shownEditor = await vscode.window.showTextDocument(doc, {
            viewColumn: targetColumn,
            preserveFocus: false,
            preview: false
        });
        // Keep a reference to the CSS editor pane and apply decorations there
        cssEditor = shownEditor;
        if (decorationType) {
            cssEditor.setDecorations(decorationType, ranges);
        }
        // Scroll to first match
        if (ranges.length > 0) {
            cssEditor.revealRange(ranges[0], vscode.TextEditorRevealType.InCenter);
        }
    }
    catch (error) {
        vscode.window.showErrorMessage(`Failed to open CSS file: ${error}`);
    }
}
function clearHighlights() {
    if (cssEditor) {
        if (decorationType)
            cssEditor.setDecorations(decorationType, []);
    }
    if (statusBarItem)
        statusBarItem.hide();
}
function deactivate() {
    if (cssEditor) {
        if (decorationType)
            cssEditor.setDecorations(decorationType, []);
    }
    if (statusBarItem)
        statusBarItem.dispose();
}
exports.deactivate = deactivate;
//# sourceMappingURL=extension.js.map