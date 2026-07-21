import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

export const get = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query("telemetry").collect();
  },
});

export const update = mutation({
  args: {
    driverName: v.string(),
    vehicleType: v.union(v.literal("scooter"), v.literal("bike")),
    trackId: v.optional(v.id("tracks")),
    lat: v.number(),
    lon: v.number(),
    speed: v.number(),
    heading: v.optional(v.number()),
    gForce: v.optional(v.number()),
    timestamp: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("telemetry")
      .filter((q) => q.eq(q.field("driverName"), args.driverName))
      .collect();
      
    for (const record of existing) {
      await ctx.db.delete(record._id);
    }
    
    return await ctx.db.insert("telemetry", args);
  },
});

export const clearAll = mutation({
  args: {},
  handler: async (ctx) => {
    const all = await ctx.db.query("telemetry").collect();
    for (const item of all) {
      await ctx.db.delete(item._id);
    }
  },
});
