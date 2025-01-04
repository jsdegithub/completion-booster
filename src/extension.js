const vscode = require('vscode');
const fs = require('fs');
const path = require('path');
const jsoncParser = require('jsonc-parser'); // 添加 JSONC 解析器

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

  // 修改插入snippet的命令处理
  let insertSnippetCommand = vscode.commands.registerCommand('snippetsHelper.insertSnippet', async (args) => {
    const editor = vscode.window.activeTextEditor;
    if (editor && args && args.snippet) {
      const snippetString =
        args.snippet instanceof vscode.SnippetString ? args.snippet : new vscode.SnippetString(args.snippet);
      await editor.insertSnippet(snippetString);
    }
  });
  context.subscriptions.push(insertSnippetCommand);

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

  // 添加数字缓存
  let numberBuffer = '';
  let numberBufferTimeout = null;

  // 添加变量跟踪建议列表状态
  let isCompletionActive = false;

  // 监听建议列表状态变化
  context.subscriptions.push(
    vscode.languages.registerCompletionItemProvider(
      {scheme: 'file'},
      {
        provideCompletionItems(document, position) {
          isCompletionActive = true;
          outputChannel.appendLine('建议列表已激活');
          return [];
        },
      },
      '.' // 使用一个不常用的触发字符
    )
  );

  // 创建补全项提供器
  const provider = {
    async provideCompletionItems(document, position) {
      const linePrefix = document.lineAt(position).text.substr(0, position.character);
      outputChannel.appendLine(`\n========== 补全触发 ==========`);
      outputChannel.appendLine(`当前输入: "${linePrefix}"`);

      // 检查是否是数字输入且建议列表处于激活状态
      const numberMatch = linePrefix.match(/(\d+)$/);
      if (numberMatch && isCompletionActive) {
        numberBuffer = numberMatch[1];
        outputChannel.appendLine(`检测到数字输入: ${numberBuffer} (建议列表已激活)`);

        // 将数字转换为索引
        const selectedIndex = parseInt(numberBuffer) - 1;
        outputChannel.appendLine(`转换为索引: ${selectedIndex}`);

        // 如果有缓存的匹配项且索引有效，直接应用选中的snippet
        if (this.lastMatchedItems && selectedIndex >= 0 && selectedIndex < this.lastMatchedItems.length) {
          const selectedItem = this.lastMatchedItems[selectedIndex];
          outputChannel.appendLine(`选中项: ${selectedItem.label.label || selectedItem.label}`);

          // 创建新的CompletionItem用于插入
          const autoInsertItem = new vscode.CompletionItem(selectedItem.label);

          // 确保使用正确的snippet内容
          const snippetText = selectedItem.insertText || new vscode.SnippetString('');

          // 设置插入行为
          autoInsertItem.insertText = snippetText;
          autoInsertItem.kind = vscode.CompletionItemKind.Snippet;
          autoInsertItem.preselect = true;

          // 添加命令确保snippet正确插入
          autoInsertItem.command = {
            command: 'editor.action.insertSnippet',
            title: 'Insert Snippet',
            arguments: [{snippet: snippetText.value || snippetText}],
          };

          // 删除输入的数字
          const deleteRange = new vscode.Range(
            position.with(undefined, position.character - numberBuffer.length),
            position
          );
          autoInsertItem.additionalTextEdits = [vscode.TextEdit.delete(deleteRange)];

          outputChannel.appendLine('准备插入snippet...');
          return [autoInsertItem];
        }
      }

      outputChannel.appendLine(`\n========== 补全触发 ==========`);
      outputChannel.appendLine(`检测到输入: "${linePrefix}"`);

      const items = [];
      try {
        const languageId = document.languageId;
        outputChannel.appendLine(`当前文档语言: ${languageId}`);

        // 获取所有可用的代码片段
        const snippets = [];

        // 获取用户全局 snippets
        try {
          outputChannel.appendLine('\n========== 用户自定义 Snippets ==========');

          // 获取用户 snippets 目录（支持多个可能的路径）
          const possiblePaths = [
            // 通过环境变量获取的路径
            path.join(process.env.APPDATA || '', 'Code', 'User', 'snippets'),
            // 兜底路径
            path.join(process.env.HOME || process.env.USERPROFILE || '', '.config', 'Code', 'User', 'snippets'),
          ];

          let snippetsPath = null;
          for (const testPath of possiblePaths) {
            outputChannel.appendLine(`尝试查找 snippets 目录: ${testPath}`);
            if (fs.existsSync(testPath)) {
              snippetsPath = testPath;
              outputChannel.appendLine(`找到有效的 snippets 目录: ${snippetsPath}`);
              break;
            }
          }

          if (!snippetsPath) {
            outputChannel.appendLine('警告: 未找到任何有效的 snippets 目录');
            return items;
          }

          // 处理具体的 snippets 文件
          const devSnippetsPath = path.join(snippetsPath, 'dev.code-snippets');
          if (fs.existsSync(devSnippetsPath)) {
            try {
              const fileContent = fs.readFileSync(devSnippetsPath, 'utf8');
              outputChannel.appendLine(`文件内容长度: ${fileContent.length} 字节`);

              // 使用 JSONC 解析器处理文件
              let content;
              try {
                // 使用 jsonc-parser 解析带注释的 JSON
                const errors = [];
                content = jsoncParser.parse(fileContent, errors, {allowTrailingComma: true});

                if (errors.length > 0) {
                  outputChannel.appendLine('JSONC 解析警告:');
                  errors.forEach((error) => {
                    outputChannel.appendLine(`- 位置 ${error.offset}: ${error.error}`);
                  });
                }

                if (!content) {
                  throw new Error('解析结果为空');
                }
              } catch (jsonError) {
                outputChannel.appendLine(`JSONC 解析错误: ${jsonError.message}`);
                outputChannel.appendLine('尝试移除注释后解析...');

                // 移除注释并尝试标准 JSON 解析
                const strippedContent = fileContent
                  .replace(/\/\*[\s\S]*?\*\/|\/\/.*/g, '') // 移除注释
                  .replace(/,(\s*[}\]])/g, '$1'); // 移除尾随逗号

                try {
                  content = JSON.parse(strippedContent);
                } catch (fallbackError) {
                  outputChannel.appendLine(`标准 JSON 解析也失败: ${fallbackError.message}`);
                  throw fallbackError;
                }
              }

              outputChannel.appendLine(`\n成功读取 dev.code-snippets: ${devSnippetsPath}`);
              outputChannel.appendLine(`包含 ${Object.keys(content).length} 个代码片段`);

              Object.entries(content).forEach(([name, snippet]) => {
                try {
                  // 检查 scope 是否匹配当前语言
                  const scope = snippet.scope ? snippet.scope.split(',').map((s) => s.trim()) : ['global'];
                  if (scope.includes('global') || scope.includes(languageId)) {
                    outputChannel.appendLine(
                      `  - Snippet "${name}": ${snippet.prefix || '无前缀'} (作用域: ${scope.join(', ')})`
                    );
                    snippets.push({
                      name,
                      ...snippet,
                      source: 'user',
                      isSnippet: true,
                      isUserSnippet: true,
                    });
                  } else {
                    outputChannel.appendLine(`  - 跳过 Snippet "${name}": 作用域不匹配 (${scope.join(', ')})`);
                  }
                } catch (snippetError) {
                  outputChannel.appendLine(`处理片段 "${name}" 时出错: ${snippetError.message}`);
                }
              });
            } catch (err) {
              outputChannel.appendLine(`读取或解析 dev.code-snippets 失败:`);
              outputChannel.appendLine(`- 错误类型: ${err.name}`);
              outputChannel.appendLine(`- 错误消息: ${err.message}`);
              outputChannel.appendLine(`- 堆栈跟踪: ${err.stack}`);
            }
          } else {
            outputChannel.appendLine(`dev.code-snippets 文件不存在: ${devSnippetsPath}`);
          }

          // 获取工作区 snippets
          if (vscode.workspace.workspaceFolders) {
            for (const folder of vscode.workspace.workspaceFolders) {
              const workspaceSnippetsPath = path.join(folder.uri.fsPath, '.vscode');
              if (fs.existsSync(workspaceSnippetsPath)) {
                const workspaceSnippets = await vscode.workspace.findFiles('**/*.code-snippets');
                outputChannel.appendLine(`找到 ${workspaceSnippets.length} 个工作区 snippet 文件`);

                for (const snippetFile of workspaceSnippets) {
                  try {
                    const content = JSON.parse(fs.readFileSync(snippetFile.fsPath, 'utf8'));
                    outputChannel.appendLine(`\n正在处理文件: ${snippetFile.fsPath}`);

                    const snippetCount = Object.keys(content).length;
                    outputChannel.appendLine(`发现 ${snippetCount} 个可用 snippets`);

                    Object.entries(content).forEach(([name, snippet]) => {
                      // 检查 scope 是否匹配当前语言
                      const scope = snippet.scope ? snippet.scope.split(',').map((s) => s.trim()) : ['global'];
                      if (scope.includes('global') || scope.includes(languageId)) {
                        outputChannel.appendLine(
                          `  - Snippet "${name}": ${snippet.prefix || '无前缀'} (作用域: ${scope.join(', ')})`
                        );
                        snippets.push({
                          name,
                          ...snippet,
                          source: 'user',
                          isSnippet: true,
                          isUserSnippet: true,
                        });
                      } else {
                        outputChannel.appendLine(`  - 跳过 Snippet "${name}": 作用域不匹配 (${scope.join(', ')})`);
                      }
                    });
                  } catch (err) {
                    outputChannel.appendLine(`读取 snippet 文件失败 ${snippetFile.fsPath}: ${err.message}`);
                  }
                }
              }
            }
          }

          // 获取特定语言的 snippets
          const languageSnippets = await vscode.workspace.findFiles(`**/${languageId}.json`);
          outputChannel.appendLine(`\n找到 ${languageSnippets.length} 个语言相关的 snippet 文件`);

          for (const snippetFile of languageSnippets) {
            try {
              const content = JSON.parse(fs.readFileSync(snippetFile.fsPath, 'utf8'));
              outputChannel.appendLine(`\n正在处理语言文件: ${snippetFile.fsPath}`);

              Object.entries(content).forEach(([name, snippet]) => {
                outputChannel.appendLine(`  - Snippet "${name}": ${snippet.prefix || '无前缀'}`);
                snippets.push({
                  name,
                  ...snippet,
                  source: 'user',
                  isSnippet: true,
                  isUserSnippet: true,
                });
              });
            } catch (err) {
              outputChannel.appendLine(`读取语言 snippet 文件失败 ${snippetFile.fsPath}: ${err.message}`);
            }
          }

          outputChannel.appendLine('====================================\n');
        } catch (err) {
          outputChannel.appendLine(`处理用户 snippets 时出错: ${err.stack || err.message}`);
        }

        // 获取内置代码片段时，添加 isSnippet 标记
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
                        isSnippet: true, // 添加标记
                      });
                    });
                  }
                } catch (err) {
                  outputChannel.appendLine(`读取扩展 ${ext.id} 的代码片段失败: ${err.message}`);
                }
              });
          });

        outputChannel.appendLine(`找到 ${snippets.length} 个代码片段定义`);

        // 先创建所有匹配的补全项
        const matchedItems = [];
        snippets.forEach((snippet) => {
          const prefixes = Array.isArray(snippet.prefix) ? snippet.prefix : [snippet.prefix];

          prefixes.forEach((prefix) => {
            if (typeof prefix === 'string' && prefix.toLowerCase().startsWith(linePrefix.toLowerCase())) {
              const item = new vscode.CompletionItem(
                {
                  // 暂时不添加序号，后面统一处理
                  label: snippet.name || prefix,
                  description: snippet.source,
                  detail: snippet.description || '',
                },
                vscode.CompletionItemKind.Snippet
              );

              const body = Array.isArray(snippet.body) ? snippet.body.join('\n') : snippet.body;
              item.insertText = new vscode.SnippetString(body || '');
              item.filterText = prefix;
              item.documentation = new vscode.MarkdownString()
                .appendCodeblock(body, document.languageId)
                .appendText(`\n\n来源: ${snippet.source}`);

              item.isSnippet = true;
              item.isUserSnippet = snippet.isUserSnippet;
              matchedItems.push(item);
            }
          });
        });

        // 缓存匹配的items以供数字选择使用
        this.lastMatchedItems = matchedItems;
        outputChannel.appendLine(`缓存了 ${matchedItems.length} 个匹配项供数字选择使用`);

        // 添加序号并创建最终的补全项列表
        items.push(
          ...matchedItems.map((item, index) => {
            const number = index + 1;
            item.label = {
              label: `${number}. ${item.label.label}`,
              description: item.label.description,
              detail: `[#${number}] ${item.label.detail}`,
            };
            // 确保排序时数字选择的item排在最前面
            item.sortText = numberBuffer
              ? '!' + number.toString().padStart(5, '0')
              : number.toString().padStart(5, '0');
            return item;
          })
        );

        outputChannel.appendLine(`\n找到 ${items.length} 个匹配的snippets`);
      } catch (err) {
        outputChannel.appendLine(`处理代码片段时出错: ${err.stack || err.message}`);
      }

      outputChannel.appendLine(`\n找到 ${items.length} 个匹配的snippets`);
      outputChannel.appendLine('============================\n');
      return items;
    },

    // 添加resolve方法以支持异步加载补全项的额外信息
    resolveCompletionItem(item) {
      return item;
    },
  };

  // 注册补全提供器，设置触发字符包含数字
  outputChannel.appendLine('注册补全提供器，包含数字触发字符');
  const disposable = vscode.languages.registerCompletionItemProvider(
    {scheme: 'file'},
    provider,
    ...'0123456789'.split('') // 添加数字作为触发字符
  );
  outputChannel.appendLine('补全提供器注册完成');

  context.subscriptions.push(disposable);

  // 监听建议列表隐藏事件
  context.subscriptions.push(
    vscode.languages.registerCompletionItemProvider(
      {scheme: 'file'},
      {
        resolveCompletionItem(item) {
          isCompletionActive = false;
          outputChannel.appendLine('建议列表已关闭');
          return item;
        },
      }
    )
  );

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
