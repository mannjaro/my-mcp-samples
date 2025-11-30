import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { execSync } from 'child_process';


// Chromeのタイムスタンプ(1601年1月1日からのマイクロ秒)をUnixタイムスタンプ(ミリ秒)に変換する定数
const WEBKIT_EPOCH_OFFSET = 11644473600000;

// WSL環境かどうかを判定
const isWSL = () => {
  if (process.platform !== 'linux') return false;
  try {
    const release = os.release().toLowerCase();
    const version = fs.readFileSync('/proc/version', 'utf8').toLowerCase();
    return release.includes('microsoft') || version.includes('microsoft');
  } catch {
    return false;
  }
};

// Windowsのユーザー名を取得 (WSLから cmd.exe を叩く)
const getWindowsUsername = (): string => {
  try {
    // cmd.exe経由で環境変数USERNAMEを取得
    const stdout = execSync('cmd.exe /c "echo %USERNAME%"', { encoding: 'utf8' });
    return stdout.trim();
  } catch (e) {
    throw new Error('WSLからWindowsのユーザー名を取得できませんでした。');
  }
};

// OSごとのChrome履歴ファイルのデフォルトパス
function getChromeHistoryPath() {
  const homeDir = os.homedir();
  switch (process.platform) {
    case 'darwin': // macOS
      return path.join(homeDir, 'Library/Application Support/Google/Chrome/Default/History');
    case 'win32': // Windows
      return path.join(homeDir, 'AppData\\Local\\Google\\Chrome\\User Data\\Default\\History');
    case 'linux': // Linux
      return path.join(homeDir, '.config/google-chrome/Default/History');
    default:
      throw new Error('サポートされていないOSです');
  }
}

function copyHistoryFile(srcPath: string) {
  const tempPath = path.join(os.tmpdir(), `chrome_history_copy_${Date.now()}.sqlite`);
  fs.copyFileSync(srcPath, tempPath);
  console.log(`Copied history DB to temporary path: ${tempPath}`);
  return {
    path: tempPath,
    [Symbol.dispose]: () => {
      if (fs.existsSync(tempPath)) {
        fs.unlinkSync(tempPath);
        console.log(`Deleted temporary history DB copy: ${tempPath}`);
      }
    }
  }
}

function openSqlite(dbPath: string) {
  return {
    db: new Database(dbPath, { readonly: true }),
    [Symbol.dispose]() {
      this.db.close();
      console.log(`Closed SQLite database connection.`);
    }
  }
}

export function registerChromeHistTool(mcpServer: McpServer) {
  mcpServer.registerTool('chrome-hist-tool', {
    title: 'fetch-chrome-history',
    description: 'Fetches browsing history from Google Chrome.',
    annotations: {
      readOnlyHint: true, // 外部の状態を変更しない
      openWorldHint: false, // ローカルシステムと接続する
    },
    inputSchema: z.object({
      limit: z.number().optional().describe('The number of recent history entries to fetch. Defaults to 10.'),
    }),
    outputSchema: z.object({
      result: z.string().describe('The recent browsing history entries from Google Chrome.'),
    }),
  }, async ({ limit }) => {
    // Chromeの履歴データベースファイルのパスを取得
    const historyPath = getChromeHistoryPath();
    // ファイルの存在確認
    if (!fs.existsSync(historyPath)) {
      throw new Error(`Chromeの履歴ファイルが見つかりません: ${historyPath}`);
    }

    //ロック回避のため一時コピーを作成
    using tempPath = copyHistoryFile(historyPath)

    // SQLiteデータベースを開く
    using dbHadnle = openSqlite(tempPath.path)

    const db = dbHadnle.db;

    // 今日の0時0分のタイムスタンプを計算
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    // Unixミリ秒 -> WebKitマイクロ秒 への変換
    // (UnixTimeMs + Offset) * 1000
    const chromeTimeStart = (startOfToday.getTime() + WEBKIT_EPOCH_OFFSET) * 1000;

    // SQLクエリ実行
    // urlsテーブル: url, title, visit_count, last_visit_time
    const query = `
        SELECT 
          title, 
          url, 
          last_visit_time 
        FROM urls 
        WHERE last_visit_time > ? 
        ORDER BY last_visit_time DESC 
        LIMIT ?
      `;

    const rows = db.prepare(query).all(chromeTimeStart, limit || 10);
    // データを整形
    const results = rows.map((row: any) => {
      // WebKitマイクロ秒 -> JS Dateオブジェクト
      const visitTimeMs = (row.last_visit_time / 1000) - WEBKIT_EPOCH_OFFSET;
      const visitDate = new Date(visitTimeMs);

      return {
        title: row.title || 'No Title',
        url: row.url,
        time: visitDate.toLocaleString('ja-JP'), // 読みやすい形式にする
      };
    });
    // フォーマットして返す
    console.log(results)

    // 履歴情報をフォーマット
    const formattedHistory = results.map((entry) => {
      return `## ${entry.title}\n  - URL: ${entry.url}\n  - Visited At: ${entry.time}\n`;
    }).join('\n');

    return {
      content: [{
        type: 'text',
        text: formattedHistory || 'No browsing history found.',
      }],
      structuredContent: {
        result: formattedHistory || 'No browsing history found.',
      }
    };
  });
}