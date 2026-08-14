import { PrismaClient } from "@prisma/client";

import ApiError from "../utils/ApiError.js";
import { followupAgent } from "../ai/agent.js";
import { notifyCustomerFollowupTaken, notifyFollowupNext } from "../jobs/notification/notificationEvents.js";
import { getCustomerAccessFilter } from "./controller.customer.js";

const prisma = new PrismaClient();

// ---------------------------------------------------
//  HELPER FUNCTION (TRANSFORM FOLLOWUP TO DESIRED FORMAT)
// ---------------------------------------------------
const transformFollowup = (followup) => ({
  _id: followup.id,
  customer: {
    _id: followup.customer?.id,
    Campaign: followup.customer?.Campaign || "",
    CustomerType: followup.customer?.CustomerType || "",
    CustomerSubType: followup.customer?.CustomerSubType || "",
    customerName: followup.customer?.customerName || "",
    ContactNumber: followup.customer?.ContactNumber || "",
    Email: followup.customer?.Email || "",
    City: followup.customer?.City || "",
    Location: followup.customer?.Location || "",
    Area: followup.customer?.Area || "",
    Adderess: followup.customer?.Adderess || "",
    Facillities: followup.customer?.Facillities || "",
    ReferenceId: followup.customer?.ReferenceId || "",
    CustomerId: followup.customer?.CustomerId || "",
    CustomerDate: followup.customer?.CustomerDate || "",
    CustomerYear: followup.customer?.CustomerYear || "",
    Other: followup.customer?.Other || "",
    Description: followup.customer?.Description || "",
    Video: followup.customer?.Video || "",
    Verified: followup.customer?.Verified || "",
    GoogleMap: followup.customer?.GoogleMap || "",
    CustomerImage: followup.customer?.CustomerImage || [],
    SitePlan: followup.customer?.SitePlan || [],
    isFavourite: followup.customer?.isFavourite || false,
    AssignTo: followup.customer?.AssignTo
      ? {
        _id: followup.customer.AssignTo.id,
        name: followup.customer.AssignTo.name,
        email: followup.customer.AssignTo.email,
        role: followup.customer.AssignTo.role,
        city: followup.customer.AssignTo.city,
        status: followup.customer.AssignTo.status,
      }
      : null,
    CreatedBy: followup.customer?.CreatedBy || null,
    isImported: followup.customer?.isImported || false,
    __v: followup.customer?.__v || 0,
    createdAt: followup.customer?.createdAt,
    updatedAt: followup.customer?.updatedAt,
  },
  StartDate: followup.StartDate || "",
  StatusType: followup.StatusType || "",
  FollowupNextDate: followup.FollowupNextDate || "",
  Description: followup.Description || "",
  CreatedBy: followup.CreatedBy || "",
  createdAt: followup.createdAt,
  updatedAt: followup.updatedAt,

  // Flattened customer fields
  Campaign: followup.customer?.Campaign || "",
  CustomerType: followup.customer?.CustomerType || "",
  CustomerSubType: followup.customer?.CustomerSubType || "",
  City: followup.customer?.City || "",
  Location: followup.customer?.Location || "",
  ReferenceId: followup.customer?.ReferenceId || "",
  customerName: followup.customer?.customerName || "",
  ContactNumber: followup.customer?.ContactNumber || "",
  AssignTo: followup.customer?.AssignTo
    ? {
      _id: followup.customer.AssignTo.id,
      name: followup.customer.AssignTo.name,
      email: followup.customer.AssignTo.email,
      role: followup.customer.AssignTo.role,
      city: followup.customer.AssignTo.city,
      status: followup.customer.AssignTo.status,
    }
    : null,

});


// ai followup 
export const createFollowupByAI = async (req, res, next) => {
  try {
    const admin = req.admin;
    const { customerIds = [], userPrompt } = req.body;

    // ❌ No params usage anymore
    // const { customerId } = req.params;

    // ✅ Validate input
    if (!userPrompt) {
      return next(new ApiError(400, "userPrompt is required"));
    }

    if (!Array.isArray(customerIds) || customerIds.length === 0) {
      return next(new ApiError(400, "customerIds must be a non-empty array"));
    }

    // ✅ Fetch customers
    const customers = await prisma.customer.findMany({
      where: {
        id: { in: customerIds },
      },
    });

    if (!customers.length) {
      return next(new ApiError(404, "No customers found"));
    }

    // ✅ Call AI once
    const aiResponse = await followupAgent(userPrompt);

    if (!aiResponse?.data) {
      return next(new ApiError(500, "AI failed"));
    }

    const aiData = aiResponse.data;

    // ✅ Create followups for all customers
    const followups = await Promise.all(
      customers.map((customer) =>
        prisma.followup.create({
          data: {
            customerId: customer.id,
            ...aiData,
            CreatedById: admin.id || admin._id,
          },
        })
      )
    );

    res.status(201).json({
      success: true,
      message: "Follow-ups created via AI",
      count: followups.length,
      aiMessage: aiResponse.message,
    });
  } catch (error) {
    next(new ApiError(500, error.message));
  }
};

// ---------------------------------------------------
//  CREATE FOLLOWUP
// ---------------------------------------------------
export const createFollowup = async (req, res, next) => {
  try {
    const admin = req.admin;
    const { customerId } = req.params;
    const { StartDate, StatusType, FollowupNextDate, Description } = req.body;

    const customer = await prisma.customer.findUnique({
      where: { id: customerId },
    });
    if (!customer) return next(new ApiError(404, "Customer not found"));

    const followup = await prisma.followup.create({
      data: {
        customerId,
        StartDate,
        StatusType,
        FollowupNextDate,
        Description,
        CreatedById: admin.id || admin._id,
      },
      include: { customer: true },
    });



        // if next date is today, notify immediately
    const today = new Date();
    const dd   = String(today.getDate()).padStart(2, "0");
    const mm   = String(today.getMonth() + 1).padStart(2, "0");
    const yyyy = today.getFullYear();
    const todayStr = `${dd}-${mm}-${yyyy}`;

    if (followup.FollowupNextDate === todayStr) {
      await notifyFollowupNext({ followup: followup, customer: followup.customer });
    }

    res.status(201).json({
      success: true,
      message: "Follow-up created successfully",
      data: transformFollowup(followup),
    });
  } catch (error) {
    next(new ApiError(500, error.message));
  }
};

// ---------------------------------------------------
//  GET ALL FOLLOWUPS (FILTERS + PAGINATION)
// ---------------------------------------------------
// Make sure to import your helper at the top of the file
// import { getCustomerAccessFilter } from './path-to-helper';

export const getFollowups = async (req, res, next) => {
  try {
    const admin = req.admin;

    const {
      page = 1, limit, keyword = "", StatusType, Campaign, CustomerSubType, PropertyType, City, Location, User,
    } = req.query;

    const pageNum = Math.max(1, parseInt(page, 10));
    const isPaginated = limit !== undefined;
    const perPage = isPaginated ? Math.max(1, parseInt(limit, 10)) : null;
    const skip = isPaginated ? (pageNum - 1) * perPage : undefined;

    // -------------------------
    // 1. FOLLOWUP FILTER
    // -------------------------
    // Ensures we only fetch followups created by the logged-in user (unless they are an admin)
    const whereFollowup = {};
    if (StatusType) whereFollowup.StatusType = StatusType.trim();
    
    if (admin.role !== "administrator") {
      whereFollowup.CreatedById = admin.id || admin._id;
    }
    const followupFilter = Object.keys(whereFollowup).length > 0 ? whereFollowup : {};

    // -------------------------
    // 2. CUSTOMER FIELD FILTERS (Query Params)
    // -------------------------
    const fieldFilters = {};
    if (Campaign) fieldFilters.Campaign = { contains: Campaign.trim() };
    if (PropertyType) fieldFilters.CustomerType = { contains: PropertyType.trim() };
    if (CustomerSubType) fieldFilters.CustomerSubType = { contains: CustomerSubType.trim() };
    if (City) fieldFilters.City = { contains: City.trim() };
    if (Location) fieldFilters.Location = { contains: Location.trim() };
    if (User) {
      fieldFilters.AssignTo = { some: { name: { contains: User.trim() } } };
    }

    // -------------------------
    // 3. KEYWORD FILTER
    // -------------------------
    let keywordFilter = {};
    if (keyword) {
      const kw = keyword.trim();
      keywordFilter = {
        OR: [
          { customerName: { contains: kw } },
          { ContactNumber: { contains: kw } },
          { Email: { contains: kw } },
          { City: { contains: kw } },
          { Location: { contains: kw } },
        ],
      };
    }

    // -------------------------
    // 4. CUSTOMER ACCESS FILTER
    // -------------------------
    // Reusing the exact same logic from getCustomer 
    // to ensure the customer entry was assigned to or created by them.
    const accessFilter = getCustomerAccessFilter(admin);

    // -------------------------
    // MAGIC HAPPENS HERE: Safely Combine Queries
    // -------------------------
    // We use an `AND` array so that the `OR` from keywordFilter 
    // doesn't overwrite the `OR` from accessFilter.
    const where = {
      AND: [
        accessFilter,
        Object.keys(fieldFilters).length > 0 ? fieldFilters : undefined,
        Object.keys(keywordFilter).length > 0 ? keywordFilter : undefined,
      ].filter(Boolean), // Removes undefined objects
      followups: { some: followupFilter } // Only fetches customers that have valid followups
    };

    // -------------------------
    // FETCH DATA
    // -------------------------
    const [total, customers] = await Promise.all([
      prisma.customer.count({ where }),
      prisma.customer.findMany({
        where,
        include: {
          AssignTo: true,
          followups: {
            where: followupFilter,
            orderBy: { createdAt: "desc" },
            include: {
              CreatedBy: { select: { id: true, name: true, email: true, role: true } },
            },
          },
        },
        ...(isPaginated && { skip, take: perPage }),
        orderBy: { updatedAt: "desc" },
      }),
    ]);

    // -------------------------
    // MAP RESPONSE FOR TABLE
    // -------------------------
    const mappedCustomers = customers.map((customer) => {
      const uniqueUsers = [...new Set(
        customer.followups.map(f => f.CreatedBy?.name).filter(Boolean)
      )].join(", ");

      const latestFollowup = customer.followups[0] || {};

      return {
        _id: latestFollowup.id || customer.id,
        customer: {
          ...customer,
          _id: customer.id, 
        },
        StartDate: latestFollowup.StartDate || "",
        StatusType: latestFollowup.StatusType || "",
        FollowupNextDate: latestFollowup.FollowupNextDate || "",
        Description: latestFollowup.Description || "",
        CreatedBy: latestFollowup.CreatedBy || null,
        createdAt: latestFollowup.createdAt || customer.updatedAt,
        updatedAt: latestFollowup.updatedAt || customer.updatedAt,

        Campaign: customer.Campaign || "",
        CustomerType: customer.CustomerType || "",
        CustomerSubType: customer.CustomerSubType || "",
        City: customer.City || "",
        Location: customer.Location || "",
        ReferenceId: customer.ReferenceId || "",
        customerName: customer.customerName || "",
        ContactNumber: customer.ContactNumber || "",
        User: uniqueUsers || "N/A", 
      };
    });

    res.status(200).json({
      success: true,
      total,
      currentPage: isPaginated ? pageNum : 1,
      totalPages: isPaginated ? Math.ceil(total / perPage) : 1,
      data: mappedCustomers,
    });
  } catch (error) {
    next(new ApiError(500, error.message));
  }
};

// ---------------------------------------------------
//  GET FOLLOWUPS BY CUSTOMER
// ---------------------------------------------------
export const getFollowupByCustomer = async (req, res, next) => {
  try {
    const { customerId } = req.params;
     const admin = req.admin; // 1. Extract the admin/user

    // 2. Build the where clause dynamically
    const whereClause = { customerId };

    // 3. Add the restriction for non-admins
    if (admin.role !== "administrator") {
      whereClause.CreatedById = admin.id || admin._id;
    }

    const followups = await prisma.followup.findMany({
       where: whereClause,
      include: { customer: true,CreatedBy: { select: { name: true } }, }, // just to get customer.id
      orderBy: { createdAt: "desc" },
    });

    const transformed = followups.map((f) => ({
      _id: f.id,
      customer: f.customer.id, // flatten to just customer ID
      StartDate: f.StartDate,
      StatusType: f.StatusType,
      FollowupNextDate: f.FollowupNextDate,
      Description: f.Description,
      CreatedBy: f.CreatedBy?.name || "N/A",
      createdAt: f.createdAt,
      updatedAt: f.updatedAt,
      __v: 0, // to match MongoDB format
    }));

    res.status(200).json({
      success: true,
      total: transformed.length,
      data: transformed,
    });
  } catch (error) {
    next(new ApiError(500, error.message));
  }
};

// ---------------------------------------------------
//  GET FOLLOWUP BY ID
// ---------------------------------------------------
export const getFollowupById = async (req, res, next) => {
  try {
    const followup = await prisma.followup.findUnique({
      where: { id: req.params.id },
      include: { customer: true }, // only include customer to get its id
    });

    if (!followup) return next(new ApiError(404, "Follow-up not found"));

    // Transform the followup to match the desired response format
    const transformed = {
      _id: followup.id,
      customer: followup.customer.id, // only return customer ID
      StartDate: followup.StartDate,
      StatusType: followup.StatusType,
      FollowupNextDate: followup.FollowupNextDate,
      Description: followup.Description,
      createdAt: followup.createdAt,
      updatedAt: followup.updatedAt,
      __v: 0, // if you want to keep __v like MongoDB
    };

    res.status(200).json({ success: true, data: transformed });
  } catch (error) {
    next(new ApiError(500, error.message));
  }
};

// ---------------------------------------------------
//  UPDATE FOLLOWUP
// ---------------------------------------------------
export const updateFollowup = async (req, res, next) => {
  try {
    const { StartDate, StatusType, FollowupNextDate, Description } = req.body;

    const updatedFollowup = await prisma.followup.update({
      where: { id: req.params.id },
      data: {
        ...(StartDate && { StartDate }),
        ...(StatusType && { StatusType }),
        ...(FollowupNextDate && { FollowupNextDate }),
        ...(Description && { Description }),
      },
      include: { customer: { include: { AssignTo: true } } },
    });

    res.status(200).json({
      success: true,
      message: "Follow-up updated successfully",
      data: transformFollowup(updatedFollowup),
    });
  } catch (error) {
    if (error.code === "P2025")
      return next(new ApiError(404, "Follow-up not found"));
    next(new ApiError(500, error.message));
  }
};

// ---------------------------------------------------
//  DELETE FOLLOWUP
// ---------------------------------------------------
export const deleteFollowup = async (req, res, next) => {
  try {
    await prisma.followup.delete({ where: { id: req.params.id } });
    res
      .status(200)
      .json({ success: true, message: "Follow-up deleted successfully" });
  } catch (error) {
    if (error.code === "P2025")
      return next(new ApiError(404, "Follow-up not found"));
    next(new ApiError(500, error.message));
  }
};

// ---------------------------------------------------
//  DELETE FOLLOWUPS BY CUSTOMER
// ---------------------------------------------------
export const deleteFollowupsByCustomer = async (req, res, next) => {
  try {
    const { customerId } = req.params;
    const result = await prisma.followup.deleteMany({ where: { customerId } });
    res.status(200).json({
      success: true,
      message: "All followups for this customer have been deleted",
      deletedCount: result.count,
    });
  } catch (error) {
    next(new ApiError(500, error.message));
  }
};
