const vscode = require('vscode');
const fs = require('fs');
const path = require('path');
const jsoncParser = require('jsonc-parser'); // 添加 JSONC 解析器

// 声明一个全局变量以存储匹配项
let lastMatchedItemsGlobal = [];

// 在 activate 函数开始处添加计时器变量
let inputTimer = null;
let inputBuffer = '';

function activate(context) {
  console.log('开始激活 Completion Booster...');

  // 创建输出通道用于调试
  const outputChannel = vscode.window.createOutputChannel('Completion Booster');
  outputChannel.show(); // 强制显示输出通道

  // 注册命令
  let enableCommand = vscode.commands.registerCommand('completionBooster.enable', () => {
    vscode.window.showInformationMessage('Completion Booster 已启用！');
  });
  context.subscriptions.push(enableCommand);

  // 修改插入snippet的命令处理
  let insertSnippetCommand = vscode.commands.registerCommand('completionBooster.insertSnippet', async (args) => {
    const editor = vscode.window.activeTextEditor;
    if (editor && args && args.snippet) {
      const snippetString =
        args.snippet instanceof vscode.SnippetString ? args.snippet : new vscode.SnippetString(args.snippet);
      await editor.insertSnippet(snippetString);
    }
  });
  context.subscriptions.push(insertSnippetCommand);

  // 修改处理带序号的代码片段插入命令
  let insertNumberedSnippetCommand = vscode.commands.registerCommand(
    'completionBooster.insertNumberedSnippet',
    async (args) => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        outputChannel.appendLine('无活动编辑器');
        return;
      }

      const inputChar = args?.text;
      if (!inputChar) {
        outputChannel.appendLine('未收到数字输入');
        return;
      }

      // 清除之前的定时器
      if (inputTimer) {
        clearTimeout(inputTimer);
      }

      // 添加到输入缓冲区
      inputBuffer += inputChar;
      outputChannel.appendLine(`当前输入缓冲区: ${inputBuffer}`);

      // 设置新的定时器，等待可能的下一个数字
      inputTimer = setTimeout(async () => {
        const index = parseInt(inputBuffer) - 1;
        outputChannel.appendLine(`最终选择的索引: ${index}`);

        // 清空缓冲区
        inputBuffer = '';

        if (!lastMatchedItemsGlobal || lastMatchedItemsGlobal.length === 0) {
          outputChannel.appendLine('没有可用的补全项');
          return;
        }

        if (index >= 0 && index < lastMatchedItemsGlobal.length) {
          const selectedItem = lastMatchedItemsGlobal[index];

          try {
            // 获取当前位置和行文本
            const position = editor.selection.active;
            const line = editor.document.lineAt(position.line);
            const lineText = line.text.substring(0, position.character);

            // 从当前位置向前查找到最后一个空格位置
            const lastSpaceIndex = lineText.lastIndexOf(' ');
            const triggerWord = lineText.substring(lastSpaceIndex + 1);
            const triggerWordLength = triggerWord.length;

            // 如果找到触发词，先删除它
            if (triggerWordLength > 0) {
              const deleteRange = new vscode.Range(
                new vscode.Position(position.line, position.character - triggerWordLength),
                position
              );

              // 使用 editor.edit 删除触发词
              await editor.edit(
                (editBuilder) => {
                  editBuilder.delete(deleteRange);
                },
                {undoStopBefore: false, undoStopAfter: false}
              );

              outputChannel.appendLine(`删除触发词: "${triggerWord}"`);
            }

            // 获取 snippet 内容
            const snippetText =
              selectedItem.insertText instanceof vscode.SnippetString
                ? selectedItem.insertText
                : new vscode.SnippetString(selectedItem.insertText);

            // 插入 snippet
            await editor.insertSnippet(snippetText);

            // 隐藏建议列表
            await vscode.commands.executeCommand('hideSuggestWidget');

            outputChannel.appendLine(`成功插入代码片段 [${index + 1}]`);
          } catch (error) {
            outputChannel.appendLine(`处理时出错: ${error.message}`);
            vscode.window.showErrorMessage(`插入代码片段失败: ${error.message}`);
          }
        } else {
          outputChannel.appendLine(`无效的序号: ${inputChar} (索引: ${index})`);
        }
      }, 100); // 等待100ms，给用户输入第二个数字的时间
    }
  );

  context.subscriptions.push(insertNumberedSnippetCommand);

  // 创建状态栏项
  const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 0);
  statusBarItem.text = '$(list-ordered) Completion Booster';
  statusBarItem.tooltip = '点击管理 Completion Booster';
  statusBarItem.command = 'completionBooster.enable';
  statusBarItem.show();

  // 添加到订阅列表
  context.subscriptions.push(statusBarItem);

  // 显示通知
  vscode.window.showInformationMessage('Completion Booster 插件已启动');

  outputChannel.appendLine('===============================');
  outputChannel.appendLine('Completion Booster 插件已启动');
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

  // 创建补全项提供器前，先定义辅助函数们
  function findSnippetsPath(outputChannel) {
    const possiblePaths = [
      path.join(process.env.APPDATA || '', 'Code', 'User', 'snippets'),
      path.join(process.env.HOME || '', 'Library', 'Application Support', 'Code', 'User', 'snippets'),
      path.join(process.env.HOME || '', '.config', 'Code', 'User', 'snippets'),
    ];

    for (const testPath of possiblePaths) {
      outputChannel.appendLine(`尝试查找 snippets 目录: ${testPath}`);
      if (fs.existsSync(testPath)) {
        outputChannel.appendLine(`找到有效的 snippets 目录: ${testPath}`);
        return testPath;
      }
    }
    return null;
  }

  function createNumberedItem(originalItem, number) {
    const numberedItem = new vscode.CompletionItem(
      {
        label: `${number}. ${originalItem.label.label || originalItem.label}`,
        description: originalItem.label.description,
        detail: originalItem.label.detail,
      },
      vscode.CompletionItemKind.Snippet
    );

    numberedItem.insertText = originalItem.insertText;
    numberedItem.documentation = originalItem.documentation;
    numberedItem.sortText = `0${number.toString().padStart(3, '0')}`;
    numberedItem.filterText = originalItem.filterText;

    return numberedItem;
  }

  // 创建补全项提供器
  const provider = {
    // 新增: 读取单个snippets文件的函数
    async readSnippetsFile(filePath, source, outputChannel) {
      const snippets = [];
      try {
        const fileContent = fs.readFileSync(filePath, 'utf8');
        let content;

        try {
          const errors = [];
          content = jsoncParser.parse(fileContent, errors, {allowTrailingComma: true});
          if (!content) throw new Error('解析结果为空');
        } catch (err) {
          const strippedContent = fileContent.replace(/\/\*[\s\S]*?\*\/|\/\/.*/g, '').replace(/,(\s*[}\]])/g, '$1');
          content = JSON.parse(strippedContent);
        }

        return Object.entries(content).map(([name, snippet]) => ({
          name,
          ...snippet,
          source,
          isSnippet: true,
          isUserSnippet: true,
        }));
      } catch (err) {
        outputChannel.appendLine(`读取文件失败 ${filePath}: ${err.message}`);
        return [];
      }
    },

    async provideCompletionItems(document, position) {
      const linePrefix = document.lineAt(position).text.substr(0, position.character);
      outputChannel.appendLine(`\n========== 补全触发 ==========`);
      outputChannel.appendLine(`当前输入: "${linePrefix}"`);
      const languageId = document.languageId;

      // 修复: 重新定义 numberMatch
      const numberMatch = linePrefix.match(/(\d+)$/);
      if (numberMatch && isCompletionActive) {
        // ...existing code for number handling...
      }

      // 收集所有代码片段
      const allSnippets = [];

      try {
        // 1. 读取用户全局snippets目录下的所有文件
        const snippetsPath = findSnippetsPath(outputChannel);
        outputChannel.appendLine(`使用snippets目录: ${snippetsPath}`); // 添加调试日志

        if (snippetsPath) {
          const files = fs.readdirSync(snippetsPath);
          outputChannel.appendLine(`发现文件: ${files.join(', ')}`); // 添加调试日志

          const snippetFiles = files.filter((file) => file.endsWith('.code-snippets'));
          outputChannel.appendLine(`发现snippet文件: ${snippetFiles.join(', ')}`); // 添加调试日志

          // 并行读取所有snippets文件
          const userSnippetsPromises = snippetFiles.map((file) => {
            const fullPath = path.join(snippetsPath, file);
            const source = `user/${path.basename(file, '.code-snippets')}`;
            return this.readSnippetsFile(fullPath, source, outputChannel);
          });

          const userSnippetsArrays = await Promise.all(userSnippetsPromises);
          userSnippetsArrays.forEach((snippets) => {
            if (snippets && snippets.length > 0) {
              outputChannel.appendLine(`添加 ${snippets.length} 个片段`); // 添加调试日志
              allSnippets.push(...snippets);
            }
          });
        }

        // 输出收集到的代码片段数量
        outputChannel.appendLine(`总共收集到 ${allSnippets.length} 个代码片段`); // 添加调试日志

        // 4. 按prefix排序所有收集到的snippets
        allSnippets.sort((a, b) => {
          const prefixA = Array.isArray(a.prefix) ? a.prefix[0] : a.prefix;
          const prefixB = Array.isArray(b.prefix) ? b.prefix[0] : b.prefix;
          return (prefixA || '').localeCompare(prefixB || ''); // 修复：处理 undefined 的情况
        });

        // 5. 创建补全项
        const matchedItems = [];
        allSnippets.forEach((snippet) => {
          const prefixes = Array.isArray(snippet.prefix) ? snippet.prefix : [snippet.prefix];

          prefixes.forEach((prefix) => {
            if (typeof prefix === 'string' && prefix.toLowerCase().startsWith(linePrefix.toLowerCase())) {
              const item = new vscode.CompletionItem(
                {
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

              matchedItems.push(item);
            }
          });
        });

        // 6. 缓存匹配项并添加序号
        if (matchedItems.length > 0) {
          lastMatchedItemsGlobal = matchedItems;
          return matchedItems.map((item, index) => {
            const number = index + 1;
            return createNumberedItem(item, number);
          });
        }
      } catch (err) {
        outputChannel.appendLine(`处理代码片段时出错: ${err.stack || err.message}`);
      }

      return [];
    },

    // 添加resolve方法以支持异步加载补全项的额外信息
    resolveCompletionItem(item) {
      return item;
    },
  };

  // 注册补全提供器，设置触发字符包含数字
  outputChannel.appendLine('注册补全提供器，包含数字触发字符');
  const disposable = vscode.languages.registerCompletionItemProvider({scheme: 'file'}, provider);
  outputChannel.appendLine('补全提供器注册完成');

  context.subscriptions.push(disposable);

  // 使用有效的事件监听器来重置 isCompletionActive 状态
  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor(() => {
      isCompletionActive = false;
      outputChannel.appendLine('建议列表状态已重置');
    })
  );

  // 监听文档打开事件
  context.subscriptions.push(
    vscode.workspace.onDidOpenTextDocument(() => {
      outputChannel.appendLine('Document opened, completion booster activated');
    })
  );

  // 监听配置变更
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration('completionBooster.enabled')) {
        const enabled = vscode.workspace.getConfiguration('completionBooster').get('enabled');
        outputChannel.appendLine(`配置已更改: enabled = ${enabled}`);
        statusBarItem.text = enabled
          ? '$(list-ordered) Completion Booster'
          : '$(list-ordered) Completion Booster (已禁用)';
      }
    })
  );

  // 添加更详细的日志
  outputChannel.appendLine('========== 插件激活详情 ==========');
  outputChannel.appendLine(`激活时间: ${new Date().toLocaleString()}`);
  outputChannel.appendLine(`VSCode版本: ${vscode.version}`);
  outputChannel.appendLine(
    `插件状态: ${vscode.workspace.getConfiguration('completionBooster').get('enabled') ? '已启用' : '已禁用'}`
  );
  outputChannel.appendLine('================================');

  outputChannel.appendLine('Completion Booster activated');
}

function deactivate() {}

module.exports = {
  activate,
  deactivate,
};
