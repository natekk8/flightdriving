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
      .withIndex("by_driverName", (q) => q.eq("driverName", args.driverName))
      .collect();

    if (existing.length === 0) {
      return await ctx.db.insert("telemetry", args);
    }

    // Patch the existing record in place instead of delete+insert on every
    // throttled update (called every ~250ms) to cut down on write load.
    const [first, ...duplicates] = existing;
    await ctx.db.patch(first._id, args);
    for (const duplicate of duplicates) {
      await ctx.db.delete(duplicate._id);
    }
    return first._id;
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
