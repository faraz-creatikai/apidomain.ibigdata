// mcpController.js
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { z } from "zod";
import prisma from "../config/prismaClient.js"; // Updated to match your file system
import ApiError from "../utils/ApiError.js";

const mcpServer = new McpServer({
  name: "crm-mcp-server",
  version: "1.0.0"
});

// ==========================================
// TOOL 1: Create Customer
// ==========================================
mcpServer.tool(
  "add_customer_to_crm",
  {
    customerName: z.string().min(1).describe("Full name of the customer"),
    ContactNumber: z.string().min(1).describe("Phone number of the customer. Use '101010101010' if none is provided."),
    Campaign: z.string().min(1).describe("Marketing campaign source, e.g., 'Seller' or 'Buyer'"),
    City: z.string().default("N/A").describe("City they are located in"),
    Price: z.string().default("N/A").describe("Budget or property price")
    // ... (other optional fields)
  },
  async (args) => {
    try {
      let PriceNumber = 0;
      if (args.Price && args.Price !== "N/A") {
        const raw = args.Price.toString().toLowerCase();
        let multiplier = 1;
        if (raw.includes("thousand") || raw.includes("हज़ार")) multiplier = 1000;
        else if (raw.includes("lakh") || raw.includes("लाख")) multiplier = 100000;
        else if (raw.includes("crore") || raw.includes("cr")) multiplier = 10000000;
        PriceNumber = Number(raw.replace(/[^0-9.]/g, "")) * multiplier;
      }

      const AI_SYSTEM_ADMIN_ID = "YOUR-FALLBACK-ADMIN-UUID";

      const newCustomer = await prisma.customer.create({
        data: {
          customerName: args.customerName,
          ContactNumber: args.ContactNumber,
          Campaign: args.Campaign,
          City: args.City,
          Price: args.Price,
          PriceNumber: PriceNumber,
          LeadTemperature: "cold",
          isImported: true,
          CreatedById: AI_SYSTEM_ADMIN_ID,
          AssignTo: { connect: [{ id: AI_SYSTEM_ADMIN_ID }] },
          updatedAt: new Date() 
        }
      });

      return {
        content: [{ type: "text", text: `Success! Customer added with CRM ID: ${newCustomer.id}` }]
      };
    } catch (error) {
      return {
        content: [{ type: "text", text: `Failed to add customer: ${error.message}` }],
        isError: true
      };
    }
  }
);

// ==========================================
// TOOL 2: Search Customers
// ==========================================
mcpServer.tool(
  "search_customers",
  {
    searchTerm: z.string().describe("Name or phone number to search for")
  },
  async (args) => {
    try {
      const customers = await prisma.customer.findMany({
        where: {
          OR: [
            { customerName: { contains: args.searchTerm } },
            { ContactNumber: { contains: args.searchTerm } }
          ]
        },
        take: 5
      });

      if (customers.length === 0) {
        return { content: [{ type: "text", text: "No customers found matching that search." }] };
      }

      return {
        content: [{ type: "text", text: `Found ${customers.length} customers: ${JSON.stringify(customers, null, 2)}` }]
      };
    } catch (error) {
      return { content: [{ type: "text", text: `Search failed: ${error.message}` }], isError: true };
    }
  }
);

// --- EXPRESS HANDLERS (The Fix) ---

// 1. Create a Map to store active transports by their unique session ID
const activeTransports = new Map();

export const establishSseConnection = async (req, res) => {
  // 1. Force headers to prevent Hostinger's Nginx proxy from closing the stream
  res.setHeader("Connection", "keep-alive");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("X-Accel-Buffering", "no"); // Specifically tells Nginx not to buffer

  // 2. Use the ABSOLUTE URL instead of a relative path
  const messagesUrl = "https://apidomain.ibigdata.in/api/mcp/messages";
  const transport = new SSEServerTransport(messagesUrl, res);
  
  activeTransports.set(transport.sessionId, transport);
  
  await mcpServer.connect(transport);
  console.log(`Claude connected to CRM backend via Web SSE (Session: ${transport.sessionId})`);
};

export const handleMcpMessages = async (req, res) => {
  // 3. Look up the specific transport object for this POST request
  const sessionId = req.query.sessionId;
  const transport = activeTransports.get(sessionId);
  
  if (transport) {
    await transport.handlePostMessage(req, res);
  } else {
    res.status(400).json({ error: "No active SSE connection for this session" });
  }
};