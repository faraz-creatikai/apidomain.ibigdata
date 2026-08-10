import prisma from "../config/prismaClient.js";

export const createCustomerJson = async (req, res, next) => {
  try {
    const body = req.body;

    // Price Conversion Logic
    let PriceNumber = 0;
    if (body.Price && body.Price !== "N/A") {
      const raw = body.Price.toString().toLowerCase();
      let multiplier = 1;
      if (raw.includes("thousand") || raw.includes("thousands") || raw.includes("हज़ार")) {
        multiplier = 1000;
      } else if (raw.includes("lakh") || raw.includes("लाख")) {
        multiplier = 100000;
      } else if (raw.includes("crore") || raw.includes("करोड़") || raw.includes("cr")) {
        multiplier = 10000000;
      }
      PriceNumber = Number(raw.replace(/[^0-9.]/g, "")) * multiplier;
    }

    // Fallbacks for Claude API
    const finalContact = (body.ContactNumber && body.ContactNumber.trim() !== "") 
      ? body.ContactNumber 
      : "101010101010";

    const newCustomer = await prisma.customer.create({
      data: {
        customerName: body.customerName || "N/A",
        ContactNumber: finalContact,
        Campaign: body.Campaign || "N/A",
        
        // Standard Optional Fields 
        City: body.City || "N/A",
        Location: body.Location || "N/A",
        Adderess: body.Adderess || "N/A",
        Email: body.Email || "N/A",
        CustomerType: body.CustomerType || "N/A",
        CustomerSubType: body.CustomerSubType || "",
        LeadType: body.LeadType || "N/A",
        Description: body.Description || "N/A",
        URL: body.URL || "", // 👈 Added URL mapping
        GoogleMap: body.GoogleMap || "",
        Price: body.Price || "N/A",
        PriceNumber: PriceNumber,
        
        // 🚀 DYNAMIC JSON FIELDS
        CustomerFields: body.CustomerFields || {}, 

        LeadTemperature: "cold",
        isImported: true, 

        updatedAt: new Date() 
      },
    });

    res.status(201).json({ success: true, data: newCustomer });
  } catch (error) {
    console.error("Prisma Error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};