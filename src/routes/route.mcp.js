import express from "express";
import { establishSseConnection, handleMcpMessages } from "../controllers/mcpController.js";
// Import the two SSE handler functions from your controller

const mcpRoutes = express.Router();

mcpRoutes.post("/messages", express.json(), handleMcpMessages);
mcpRoutes.get("/sse", establishSseConnection);

export default mcpRoutes;