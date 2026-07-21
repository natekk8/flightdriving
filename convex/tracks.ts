import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

export const getTracks = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query("tracks").collect();
  },
});

export const saveTrack = mutation({
  args: {
    name: v.string(),
    path: v.array(v.object({ lat: v.number(), lon: v.number() })),
    s1Index: v.optional(v.number()),
    s2Index: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("tracks", args);
  },
});

export const deleteTrack = mutation({
  args: { id: v.id("tracks") },
  handler: async (ctx, args) => {
    await ctx.db.delete(args.id);
  },
});

export const clearAll = mutation({
  args: {},
  handler: async (ctx) => {
    const tracks = await ctx.db.query("tracks").collect();
    for (const t of tracks) {
      await ctx.db.delete(t._id);
    }
    const laps = await ctx.db.query("laps").collect();
    for (const l of laps) {
      await ctx.db.delete(l._id);
    }
    const telemetry = await ctx.db.query("telemetry").collect();
    for (const t of telemetry) {
      await ctx.db.delete(t._id);
    }
  },
});
