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
    lapNumber: v.optional(v.number()),
    s1: v.optional(v.number()),
    s2: v.optional(v.number()),
    s3: v.optional(v.number()),
    lapTime: v.number(),
    topSpeed: v.optional(v.number()),
    timestamp: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("laps")
      .withIndex("by_trackId_vehicle", (q) =>
        q.eq("trackId", args.trackId).eq("vehicleType", args.vehicleType)
      )
      .filter((q) => q.eq(q.field("driverName"), args.driverName))
      .collect();

    const chronologicalLapNumber = existing.length + 1;
    const now = Date.now();

    return await ctx.db.insert("laps", {
      driverName: args.driverName,
      vehicleType: args.vehicleType,
      trackId: args.trackId,
      lapNumber: chronologicalLapNumber,
      s1: args.s1,
      s2: args.s2,
      s3: args.s3,
      lapTime: args.lapTime,
      topSpeed: args.topSpeed,
      timestamp: args.timestamp || now,
    });
  },
});

export const resequenceLaps = mutation({
  args: {},
  handler: async (ctx) => {
    const allLaps = await ctx.db.query("laps").collect();
    const groups = new Map<string, typeof allLaps>();

    for (const lap of allLaps) {
      const key = `${lap.driverName}_${lap.trackId}_${lap.vehicleType}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(lap);
    }

    let updatedCount = 0;
    for (const [, lapList] of groups) {
      lapList.sort((a, b) => (a.timestamp || a._creationTime) - (b.timestamp || b._creationTime));

      for (let i = 0; i < lapList.length; i++) {
        const lap = lapList[i];
        const correctLapNumber = i + 1;
        if (lap.lapNumber !== correctLapNumber) {
          await ctx.db.patch(lap._id, { lapNumber: correctLapNumber });
          updatedCount++;
        }
      }
    }
    return { updatedCount, totalLaps: allLaps.length };
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
