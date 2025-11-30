import { Hono } from 'hono'
import { env } from 'hono/adapter'


import { StreamableHTTPTransport } from "@hono/mcp";
import { createMcpServer } from "./mcp/server";

const app = new Hono()
  .get('/', (c) => {
    return c.text('Hello Hono!')
  })
  .all('/mcp', async (c) => {
    const { GOOGLE_GENAI_API_KEY } = env<{ GOOGLE_GENAI_API_KEY: string }>(c)
    const mcpServer = createMcpServer(GOOGLE_GENAI_API_KEY);
    const transport = new StreamableHTTPTransport();
    await mcpServer.connect(transport);
    return transport.handleRequest(c)
  })


export default app
