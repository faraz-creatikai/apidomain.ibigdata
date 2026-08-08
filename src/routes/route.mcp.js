import express from "express";
import { establishSseConnection, handleMcpMessages } from "../controllers/mcpController.js";
// Import the two SSE handler functions from your controller

const mcpRoutes = express.Router();

// 1. GET route for Claude Web to open the SSE stream
// Claude will ping this URL when you add the connector (e.g., https://api.ibigdata.in/api/mcp/sse)
mcpRoutes.get("/sse", establishSseConnection);

// 2. POST route for Claude to send the actual tool execution payloads
// You don't put this in Claude Web; the SDK handles telling Claude where this is automatically.
mcpRoutes.post("/messages", handleMcpMessages);

export default mcpRoutes;