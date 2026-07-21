import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

export const getTimingBoard = query({
  args: { 
    trackId: v.optional(v.id("tracks")),
    vehicleType: v.optional(v.union(v.literal("scooter"), v.literal("bike")))
  },
  handler: async (ctx, args) => {
    if (!args.trackId) return [];
    
    let lapsQuery = ctx.db
      .query("laps")
      .filter((q) => q.eq(q.field("trackId"), args.trackId));
      
    const laps = await lapsQuery.collect();
    
    if (args.vehicleType) {
      return laps.filter(l => l.vehicleType === args.vehicleType);
    }
    return laps;
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
  args: { trackId: v.id("tracks") },
  handler: async (ctx, args) => {
    const laps = await ctx.db
      .query("laps")
      .filter((q) => q.eq(q.field("trackId"), args.trackId))
      .collect();
    for (const lap of laps) {
      await ctx.db.delete(lap._id);
    }
  },
});
