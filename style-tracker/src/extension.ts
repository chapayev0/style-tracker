import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

let cssEditor: vscode.TextEditor | undefined;
let decorationType: vscode.TextEditorDecorationType;
let statusBarItem: vscode.StatusBarItem;

export function activate(context: vscode.ExtensionContext) {
    console.log('HTML CSS Tracker is now active');

    // Create decoration type for highlighting CSS rules
    decorationType = vscode.window.createTextEditorDecorationType({
        backgroundColor: new vscode.ThemeColor('editor.findMatchHighlightBackground'),
        border: '2px solid',
        borderColor: new vscode.ThemeColor('editor.findMatchBorder'),
    });

    // Create status bar item
    statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    statusBarItem.text = "$(link) CSS Tracker";
    context.subscriptions.push(statusBarItem);

    // Track cursor position changes
    const cursorDisposable = vscode.window.onDidChangeTextEditorSelection(event => {
        if (event.textEditor.document.languageId === 'html') {
            handleCursorChange(event.textEditor);
        }
    });

    // Track active editor changes
    const editorDisposable = vscode.window.onDidChangeActiveTextEditor(editor => {
        if (editor && editor.document.languageId === 'html') {
            handleCursorChange(editor);
        }
    });

    // Command to manually trigger CSS tracking
    const trackCommand = vscode.commands.registerCommand('htmlCssTracker.trackElement', () => {
        const editor = vscode.window.activeTextEditor;
        if (editor && editor.document.languageId === 'html') {
            handleCursorChange(editor);
        } else {
            vscode.window.showInformationMessage('Please open an HTML file to use CSS Tracker');
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

    context.subscriptions.push(cursorDisposable, editorDisposable, trackCommand, closeCommand, decorationType);
}

async function handleCursorChange(editor: vscode.TextEditor) {
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

function detectSelectorType(lineText: string, word: string, cursorPos: number): 
    { type: 'class' | 'id' | null, selector: string } {
    
    // Check if we're in a class attribute
    const classMatch = lineText.match(/class\s*=\s*["']([^"']*)["']/);
    if (classMatch && classMatch.index !== undefined) {
        const classContent = classMatch[1];
        const classStart = lineText.indexOf(classContent, classMatch.index);
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

    return { type: null, selector: '' };
}

async function findAndHighlightCSSRules(htmlEditor: vscode.TextEditor, selector: string, type: 'class' | 'id') {
    const htmlDoc = htmlEditor.document;
    const htmlContent = htmlDoc.getText();
    
    // Find linked CSS files
    const cssFiles = findLinkedCSSFiles(htmlContent, htmlDoc.uri.fsPath);
    
    if (cssFiles.length === 0) {
        vscode.window.showInformationMessage('No CSS files found linked in this HTML file');
        return;
    }

    // Search for selector in CSS files
    let found = false;
    for (const cssFile of cssFiles) {
        if (fs.existsSync(cssFile)) {
            const cssContent = fs.readFileSync(cssFile, 'utf8');
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

function findLinkedCSSFiles(htmlContent: string, htmlFilePath: string): string[] {
    const cssFiles: string[] = [];
    const linkRegex = /<link[^>]*rel\s*=\s*["']stylesheet["'][^>]*href\s*=\s*["']([^"']+)["'][^>]*>/gi;
    const linkRegex2 = /<link[^>]*href\s*=\s*["']([^"']+)["'][^>]*rel\s*=\s*["']stylesheet["'][^>]*>/gi;
    
    let match;
    while ((match = linkRegex.exec(htmlContent)) !== null) {
        const href = match[1];
        const absolutePath = resolveFilePath(href, htmlFilePath);
        cssFiles.push(absolutePath);
    }
    
    while ((match = linkRegex2.exec(htmlContent)) !== null) {
        const href = match[1];
        const absolutePath = resolveFilePath(href, htmlFilePath);
        if (!cssFiles.includes(absolutePath)) {
            cssFiles.push(absolutePath);
        }
    }
    
    return cssFiles;
}

function resolveFilePath(href: string, htmlFilePath: string): string {
    if (path.isAbsolute(href)) {
        return href;
    }
    
    const htmlDir = path.dirname(htmlFilePath);
    return path.resolve(htmlDir, href);
}

function findSelectorInCSS(cssContent: string, selector: string): vscode.Range[] {
    const ranges: vscode.Range[] = [];
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
                    } else if (char === '}') {
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
            
            ranges.push(new vscode.Range(
                new vscode.Position(startLine, 0),
                new vscode.Position(endLine, lines[endLine].length)
            ));
        }
    }
    
    return ranges;
}

async function openAndHighlightCSS(cssFilePath: string, ranges: vscode.Range[]) {
    const cssUri = vscode.Uri.file(cssFilePath);
    
    try {
        // Open CSS file in split view
        const doc = await vscode.workspace.openTextDocument(cssUri);
        cssEditor = await vscode.window.showTextDocument(doc, {
            viewColumn: vscode.ViewColumn.Beside,
            preserveFocus: false,
            preview: false
        });
        
        // Apply decorations
        cssEditor.setDecorations(decorationType, ranges);
        
        // Scroll to first match
        if (ranges.length > 0) {
            cssEditor.revealRange(ranges[0], vscode.TextEditorRevealType.InCenter);
        }
    } catch (error) {
        vscode.window.showErrorMessage(`Failed to open CSS file: ${error}`);
    }
}

function clearHighlights() {
    if (cssEditor) {
        cssEditor.setDecorations(decorationType, []);
    }
    statusBarItem.hide();
}

export function deactivate() {
    if (cssEditor) {
        cssEditor.setDecorations(decorationType, []);
    }
    statusBarItem.dispose();
}