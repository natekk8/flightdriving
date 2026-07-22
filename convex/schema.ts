import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  tracks: defineTable({
    name: v.string(),
    path: v.array(v.object({ lat: v.number(), lon: v.number() })),
    s1Index: v.optional(v.number()),
    s2Index: v.optional(v.number()),
  }),
  laps: defineTable({
    driverName: v.string(),
    vehicleType: v.union(v.literal("scooter"), v.literal("bike")),
    trackId: v.id("tracks"),
    lapNumber: v.number(),
    s1: v.optional(v.number()),
    s2: v.optional(v.number()),
    s3: v.optional(v.number()),
    lapTime: v.number(),
    topSpeed: v.optional(v.number()),
    maxLeanAngle: v.optional(v.number()),
    maxGForce: v.optional(v.number()),
    cornerSpeeds: v.optional(v.array(v.object({
      cornerIndex: v.number(),
      entrySpeed: v.number(),
      apexSpeed: v.number(),
      exitSpeed: v.number(),
      leanAngle: v.number()
    }))),
    timestamp: v.optional(v.number()),
  })
    .index("by_trackId_vehicle", ["trackId", "vehicleType"])
    .index("by_trackId", ["trackId"]),
  telemetry: defineTable({
    driverName: v.string(),
    vehicleType: v.union(v.literal("scooter"), v.literal("bike")),
    trackId: v.optional(v.id("tracks")),
    lat: v.number(),
    lon: v.number(),
    speed: v.number(),
    heading: v.optional(v.number()),
    gForce: v.optional(v.number()), // Calculated from accelerometer
    leanAngle: v.optional(v.number()), // Lean angle in degrees
    timestamp: v.optional(v.number()),
  }).index("by_driverName", ["driverName"]),
  lights: defineTable({
    status: v.string(),
  })
});
