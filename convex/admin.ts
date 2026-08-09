import { mutation } from "./_generated/server";

export const wipeDatabase = mutation({
  args: {},
  handler: async (ctx) => {
    const tracks = await ctx.db.query("tracks").collect();
    for (const track of tracks) {
      await ctx.db.delete(track._id);
    }
    const laps = await ctx.db.query("laps").collect();
    for (const lap of laps) {
      await ctx.db.delete(lap._id);
    }
    const telemetry = await ctx.db.query("telemetry").collect();
    for (const t of telemetry) {
      await ctx.db.delete(t._id);
    }
    return { success: true, wiped: { tracks: tracks.length, laps: laps.length, telemetry: telemetry.length } };
  },
});
