import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { z } from "zod";
import prisma from "../config/prismaClient.js";

// Helper function to create a fresh server instance per connection
const createMcpServer = () => {
  const server = new McpServer({
    name: "crm-mcp-server",
    version: "1.0.0"
  });

  // TOOL 1: Create Customer
  server.tool(
    "add_customer_to_crm",
    {
      customerName: z.string().min(1).describe("Full name of the customer"),
      ContactNumber: z.string().min(1).describe("Phone number of the customer. Use '101010101010' if none is provided."),
      Campaign: z.string().min(1).describe("Marketing campaign source, e.g., 'Seller' or 'Buyer'"),
      City: z.string().default("N/A").describe("City they are located in"),
      Price: z.string().default("N/A").describe("Budget or property price"),
      Adderess: z.string().default("N/A").describe("Full physical address"),
      Email: z.string().default("N/A").describe("Email address"),
      CustomerType: z.string().default("N/A").describe("Category of customer"),
      LeadType: z.string().default("N/A").describe("Type of lead"),
      Location: z.string().default("N/A").describe("Specific neighborhood or locality"),
      Description: z.string().default("N/A").describe("Any additional notes")
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
            Adderess: args.Adderess,
            Email: args.Email,
            CustomerType: args.CustomerType,
            LeadType: args.LeadType,
            Location: args.Location,
            Description: args.Description,
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

  // TOOL 2: Search Customers
  server.tool(
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

  return server;
};

// ==========================================
// EXPRESS HANDLERS (Multi-Session Management)
// ==========================================
const activeTransports = new Map();

export const establishSseConnection = async (req, res) => {
  res.setHeader("Connection", "keep-alive");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("X-Accel-Buffering", "no"); 

  const transport = new SSEServerTransport("/api/mcp/messages", res);
  
  // Create a brand new isolated server instance for this specific client session
  const serverInstance = createMcpServer();
  
  activeTransports.set(transport.sessionId, { transport, server: serverInstance });
  
  await serverInstance.connect(transport);
  console.log(`Claude connected via SSE (Session: ${transport.sessionId})`);

  const pingInterval = setInterval(() => {
    res.write(": keep-alive\n\n");
  }, 15000);

  req.on("close", () => {
    clearInterval(pingInterval);
    activeTransports.delete(transport.sessionId);
    console.log(`Connection closed for session: ${transport.sessionId}`);
  });
};

export const handleMcpMessages = async (req, res) => {
  const sessionId = req.query.sessionId;
  const sessionData = activeTransports.get(sessionId);
  
  if (sessionData && sessionData.transport) {
    try {
      await sessionData.transport.handlePostMessage(req, res);
    } catch (error) {
      console.error("SDK processing error:", error);
      res.status(500).json({ error: "Internal SDK Error" });
    }
  } else {
    res.status(400).json({ error: "No active SSE connection for this session" });
  }
};