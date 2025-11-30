import { serve } from '@hono/node-server'
import App from './index'

console.log("Starting server...")

serve({
  fetch: App.fetch,
})
console.log("Server started: http://localhost:3000")