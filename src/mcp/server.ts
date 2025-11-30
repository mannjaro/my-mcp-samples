import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { GoogleGenAI } from "@google/genai";

import Parser from "rss-parser";
import { registerChromeHistTool } from "./chrome-hist-tool";

export function createMcpServer(apiKey: string) {
  const mcpServer = new McpServer({
    name: "tech rss reader",
    version: "0.0.1",
  })

  // Chrome履歴ツールを登録
  registerChromeHistTool(mcpServer);

  mcpServer.registerTool("zenn-feed", {
    title: "fetch-zenn-feed",
    description: "Fetches the latest articles from a Zenn topic.",
    annotations: {
      readOnlyHint: true, // 外部の状態を変更しない
      openWorldHint: true, // 外部システム（Zenn API）と接続する
    },
    inputSchema: z.object({
      topic: z.string().optional().describe("The Zenn topic to fetch articles from (e.g., 'python', 'aws', 'typescript'). If not provided, fetches from the general feed."),
    }),
    // ツールの出力形式
    outputSchema: {
      result: z.string().describe("The latest articles from the specified Zenn topic."),
    },
  }, async ({ topic }) => {
    try {
      // Zenn APIから最新記事を取得
      const parser = new Parser();
      let feedUrl = ''
      if (!topic) {
        feedUrl = `https://zenn.dev/feed`;
      } else {
        feedUrl = `https://zenn.dev/topics/${encodeURIComponent(topic)}/feed`;
      }
      const feed = await parser.parseURL(feedUrl)
      const limit = 100;

      const items = feed.items.slice(0, limit || 10).map(item => ({
        title: item.title,
        link: item.link,
        pubDate: item.pubDate,
        snippet: item.contentSnippet?.substring(0, 300) || "",
        creator: item.creator
      }))

      // 記事情報をフォーマット
      const articles = items || [];
      const formattedArticles = articles
        .map((article) =>
          `## ${article.title}\n  - URL: ${article.link}\n  - Published: ${article.pubDate}\n  - Creator: ${article.creator}\n  - Snippet: ${article.snippet}\n`
        )
        .join("\n");

      return {
        content: [{
          type: "text",
          text: formattedArticles || `No articles found for topic: ${topic}`
        }],
        structuredContent: {
          result: formattedArticles || `No articles found for topic: ${topic}`
        }
      };
    } catch (error) {
      const errorMessage = `Error fetching articles for topic "${topic}": ${error instanceof Error ? error.message : String(error)}`;
      return {
        content: [{
          type: "text",
          text: errorMessage
        }],
        structuredContent: {
          result: errorMessage
        }
      };
    }
  });

  mcpServer.registerTool("qiita-feed", {
    title: "fetch-qiita-feed",
    description: "Fetches the latest articles from Qiita.",
    annotations: {
      readOnlyHint: true, // 外部の状態を変更しない
      openWorldHint: true, // 外部システム（Qiita API）と接続する
    },
    inputSchema: z.object({
      topic: z.string().optional().describe('The qiita feed topic (like "typescript", "python", "aws", "react"). If not provided, fetches from the general feed.'),
    }),
    // ツールの出力形式
    outputSchema: {
      result: z.string().describe("The latest articles from Qiita."),
    },
  }, async ({ topic }) => {
    try {
      // QiitaのRSSフィードから最新記事を取得
      const parser = new Parser();
      let feedUrl = ''
      if (!topic) {
        feedUrl = 'https://qiita.com/popular-items/feed.atom'
      } else {
        feedUrl = `https://qiita.com/tags/${encodeURIComponent(topic)}/feed`
      }
      const feed = await parser.parseURL(feedUrl);
      const limit = 100;
      const items = feed.items.slice(0, limit).map(item => ({
        title: item.title,
        link: item.link,
        pubDate: item.pubDate,
        snippet: item.contentSnippet?.substring(0, 300) || "",
      }))

      // 記事情報をフォーマット
      const articles = items || [];
      const formattedArticles = articles
        .map((article) =>
          `## ${article.title}\n  - URL: ${article.link}\n  - Published: ${article.pubDate}\n  - Snippet: ${article.snippet}\n`
        )
        .join("\n");

      return {
        content: [{
          type: "text",
          text: formattedArticles || `No articles found from Qiita.`
        }],
        structuredContent: {
          result: formattedArticles || `No articles found from Qiita.`
        }
      };
    } catch (error) {
      const errorMessage = `Error fetching articles from Qiita: ${error instanceof Error ? error.message : String(error)}`;
      return {
        content: [{
          type: "text",
          text: errorMessage
        }],
        structuredContent: {
          result: errorMessage
        }
      };
    }
  });

  mcpServer.registerTool("grounding-search-gemini", {
    title: "grounding-search-gemini",
    description: "Search the web using Gemini API.",
    annotations: {
      readOnlyHint: true,
      openWorldHint: true,
    },
    inputSchema: z.object({
      query: z.string().describe("The search query."),
    }),
    outputSchema: {
      result: z.string().describe("The search results from Gemini API."),
    },
  }, async ({ query }) => {
    // Gemini APIを使った検索ロジックをここに実装
    const ai = new GoogleGenAI({ apiKey: apiKey });
    const groundingTool = {
      googleSearch: {},
    };

    const config = {
      tools: [groundingTool],
    };

    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: `Search results for query: ${query}`,
      config,
    });

    // 例: const results = await geminiApi.search(query);
    const results = response.text || "No results found.";

    console.log("Gemini Search Results:", results);

    return {
      content: [{
        type: "text",
        text: results,
      }],
      structuredContent: {
        result: results,
      },
    };
  })

  return mcpServer;
}