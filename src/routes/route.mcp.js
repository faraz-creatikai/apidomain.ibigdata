import express from "express";
import { establishSseConnection, handleMcpMessages } from "../controllers/mcpController.js";

const mcpRoutes = express.Router();

// GET route for Claude Web to open the SSE stream
mcpRoutes.get("/sse", establishSseConnection);

// FIXED: Explicitly parse JSON payload to prevent SDK crashes
mcpRoutes.post("/messages", express.json(), handleMcpMessages);

export default mcpRoutes;