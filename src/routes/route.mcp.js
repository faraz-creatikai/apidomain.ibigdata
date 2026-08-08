import express from "express";
import { createCustomerJson } from "../controllers/mcpController.js";

const mcpRoutes = express.Router();


mcpRoutes.post("/create/customer", createCustomerJson);

export default mcpRoutes;