import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

export const getTimingBoard = query({
  args: { 
    trackId: v.optional(v.id("tracks")),
    vehicleType: v.optional(v.union(v.literal("scooter"), v.literal("bike")))
  },
  handler: async (ctx, args) => {
    if (!args.trackId) return [];
    
    if (args.vehicleType) {
      return await ctx.db
        .query("laps")
        .withIndex("by_trackId_vehicle", (q) =>
          q.eq("trackId", args.trackId!).eq("vehicleType", args.vehicleType!)
        )
        .collect();
    }
    
    return await ctx.db
      .query("laps")
      .withIndex("by_trackId", (q) => q.eq("trackId", args.trackId!))
      .collect();
  },
});

export const record = mutation({
  args: {
    driverName: v.string(),
    vehicleType: v.union(v.literal("scooter"), v.literal("bike")),
    trackId: v.id("tracks"),
    lapNumber: v.number(),
    s1: v.optional(v.number()),
    s2: v.optional(v.number()),
    s3: v.optional(v.number()),
    lapTime: v.number(),
    topSpeed: v.optional(v.number()),
    timestamp: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("laps", args);
  },
});

export const clearBoard = mutation({
  args: {
    trackId: v.optional(v.id("tracks")),
    clearAll: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    let laps;
    if (args.trackId) {
      laps = await ctx.db
        .query("laps")
        .withIndex("by_trackId", (q) => q.eq("trackId", args.trackId!))
        .collect();
    } else if (args.clearAll) {
      laps = await ctx.db.query("laps").collect();
    } else {
      return;
    }
    for (const lap of laps) {
      await ctx.db.delete(lap._id);
    }
  },
});
