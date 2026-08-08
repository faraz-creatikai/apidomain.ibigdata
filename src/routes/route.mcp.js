import express from "express";
import { establishSseConnection, handleMcpMessages } from "../controllers/mcpController.js";

const mcpRoutes = express.Router();

// Allow both GET and POST for SSE initialization to catch Claude's web probes
mcpRoutes.get("/sse", establishSseConnection);
mcpRoutes.post("/sse", establishSseConnection); 

mcpRoutes.post("/messages", express.json(), handleMcpMessages);

export default mcpRoutes;