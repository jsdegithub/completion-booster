const vscode = require('vscode');
const fs = require('fs');
const path = require('path');

function activate(context) {
  console.log('开始激活 Snippets Helper...');

  // 创建输出通道用于调试
  const outputChannel = vscode.window.createOutputChannel('Snippets Helper');
  outputChannel.show(); // 强制显示输出通道

  // 注册命令
  let enableCommand = vscode.commands.registerCommand('snippetsHelper.enable', () => {
    vscode.window.showInformationMessage('Snippets Helper 已启用！');
  });
  context.subscriptions.push(enableCommand);

  // 创建状态栏项
  const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 0);
  statusBarItem.text = '$(list-ordered) Snippets Helper';
  statusBarItem.tooltip = '点击管理 Snippets Helper';
  statusBarItem.command = 'snippetsHelper.enable';
  statusBarItem.show();

  // 添加到订阅列表
  context.subscriptions.push(statusBarItem);

  // 显示通知
  vscode.window.showInformationMessage('Snippets Helper 插件已启动');

  outputChannel.appendLine('===============================');
  outputChannel.appendLine('Snippets Helper 插件已启动');
  outputChannel.appendLine(`时间: ${new Date().toLocaleString()}`);
  outputChannel.appendLine('===============================');

  // 创建补全项提供器
  const provider = {
    async provideCompletionItems(document, position) {
      const linePrefix = document.lineAt(position).text.substr(0, position.character);
      outputChannel.appendLine(`\n========== 补全触发 ==========`);
      outputChannel.appendLine(`检测到输入: "${linePrefix}"`);

      const items = [];
      try {
        const languageId = document.languageId;
        outputChannel.appendLine(`当前文档语言: ${languageId}`);

        // 获取所有可用的代码片段
        const snippets = [];

        // 获取内置代码片段
        vscode.extensions.all
          .filter((ext) => ext.packageJSON?.contributes?.snippets)
          .forEach((ext) => {
            const snippetContributions = ext.packageJSON.contributes.snippets || [];
            snippetContributions
              .filter((s) => s.language === languageId)
              .forEach((s) => {
                try {
                  const snippetPath = path.join(ext.extensionPath, s.path);
                  outputChannel.appendLine(`尝试读取代码片段文件: ${snippetPath}`);

                  if (fs.existsSync(snippetPath)) {
                    const content = JSON.parse(fs.readFileSync(snippetPath, 'utf8'));
                    Object.entries(content).forEach(([name, snippet]) => {
                      snippets.push({
                        name,
                        ...snippet,
                        source: ext.id,
                      });
                    });
                  }
                } catch (err) {
                  outputChannel.appendLine(`读取扩展 ${ext.id} 的代码片段失败: ${err.message}`);
                }
              });
          });

        outputChannel.appendLine(`找到 ${snippets.length} 个代码片段定义`);

        // 处理所有代码片段
        snippets.forEach((snippet, index) => {
          outputChannel.appendLine(`处理代码片段 [${index}] 来自 ${snippet.source}:`);

          // 获取前缀，支持字符串或数组形式
          const prefixes = Array.isArray(snippet.prefix) ? snippet.prefix : [snippet.prefix];

          // 检查每个前缀是否匹配
          prefixes.forEach((prefix) => {
            if (typeof prefix === 'string' && prefix.toLowerCase().startsWith(linePrefix.toLowerCase())) {
              const item = new vscode.CompletionItem(
                {
                  label: `${index + 1}. ${snippet.name || prefix}`,
                  description: snippet.source, // 添加来源信息
                  detail: `[#${index + 1}] ${snippet.description || ''}`,
                },
                vscode.CompletionItemKind.Snippet
              );

              const body = Array.isArray(snippet.body) ? snippet.body.join('\n') : snippet.body;
              item.insertText = new vscode.SnippetString(body || '');
              item.detail = `[${index + 1}] ${snippet.description || snippet.name || prefix}`;
              item.filterText = prefix;
              item.sortText = `${index}`.padStart(5, '0');
              item.documentation = new vscode.MarkdownString()
                .appendCodeblock(body, document.languageId)
                .appendText(`\n\n来源: ${snippet.source}`);

              outputChannel.appendLine(`创建补全项: ${prefix} -> ${item.label}`);
              items.push(item);
            }
          });
        });

        // 按前缀相关度排序
        items.sort((a, b) => {
          const aPrefix = a.filterText.toLowerCase();
          const bPrefix = b.filterText.toLowerCase();
          const input = linePrefix.toLowerCase();

          // 优先显示以输入内容开头的项
          const aStartsWith = aPrefix.startsWith(input);
          const bStartsWith = bPrefix.startsWith(input);
          if (aStartsWith !== bStartsWith) {
            return aStartsWith ? -1 : 1;
          }

          return a.sortText.localeCompare(b.sortText);
        });
      } catch (err) {
        outputChannel.appendLine(`处理代码片段时出错: ${err.stack || err.message}`);
      }

      outputChannel.appendLine(`\n找到 ${items.length} 个匹配的snippets`);
      outputChannel.appendLine('============================\n');
      return items;
    },
  };

  // 注册补全提供器，监听所有文件
  const disposable = vscode.languages.registerCompletionItemProvider({scheme: 'file'}, provider);

  context.subscriptions.push(disposable);

  // 监听文档打开事件
  context.subscriptions.push(
    vscode.workspace.onDidOpenTextDocument(() => {
      outputChannel.appendLine('Document opened, snippets helper activated');
    })
  );

  // 监听配置变更
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration('snippetsHelper.enabled')) {
        const enabled = vscode.workspace.getConfiguration('snippetsHelper').get('enabled');
        outputChannel.appendLine(`配置已更改: enabled = ${enabled}`);
        statusBarItem.text = enabled ? '$(list-ordered) Snippets Helper' : '$(list-ordered) Snippets Helper (已禁用)';
      }
    })
  );

  // 添加更详细的日志
  outputChannel.appendLine('========== 插件激活详情 ==========');
  outputChannel.appendLine(`激活时间: ${new Date().toLocaleString()}`);
  outputChannel.appendLine(`VSCode版本: ${vscode.version}`);
  outputChannel.appendLine(
    `插件状态: ${vscode.workspace.getConfiguration('snippetsHelper').get('enabled') ? '已启用' : '已禁用'}`
  );
  outputChannel.appendLine('================================');

  outputChannel.appendLine('Snippets Helper activated');
}

function deactivate() {}

module.exports = {
  activate,
  deactivate,
};
