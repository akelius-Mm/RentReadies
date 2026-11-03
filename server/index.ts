import express from "express";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { timingSafeEqual, createHash } from "node:crypto";
import Anthropic from "@anthropic-ai/sdk";
import {
  CATEGORY_LABELS,
  CONDITIONS,
  INVENTORY_KINDS,
  ISSUE_CATEGORIES,
  SEVERITIES,
  TRADES,
  type AnalyzeRequest,
  type AnalyzeResponse,
} from "../src/lib/types.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 8787);
const MODEL = "claude-opus-5-5";
const MAX_PHOTOS_PER_REQUEST = 20;

// Load .env without an extra dependency.
const envFile = path.join(here, "..", ".env");
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]] && m[2]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

// The SDK resolves credentials in this order: ANTHROPIC_API_KEY, ANTHROPIC_AUTH_TOKEN, then the
// `ant auth login` OAuth profile on disk (refreshed automatically). Nothing to configure here.
const client = new Anthropic();

const authSource = process.env.ANTHROPIC_API_KEY
  ? "API key"
  : process.env.ANTHROPIC_AUTH_TOKEN
    ? "OAuth token (ANTHROPIC_AUTH_TOKEN)"
    : `Claude login profile${process.env.ANTHROPIC_PROFILE ? ` "${process.env.ANTHROPIC_PROFILE}"` : ""} (ant auth login)`;

// Check the credentials with a free call, and re-check at most once a minute while they fail.
let ai: { ready: boolean; error?: string; checkedAt: number } = { ready: false, checkedAt: 0 };
async function checkAi(force = false) {
  if (!force && (ai.ready || Date.now() - ai.checkedAt < 60_000)) return ai;
  try {
    await client.models.retrieve(MODEL);
    ai = { ready: true, checkedAt: Date.now() };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    ai = {
      ready: false,
      checkedAt: Date.now(),
      error:
        err instanceof Anthropic.AuthenticationError || /credential|api key|auth/i.test(msg)
          ? "No working Claude login on the server. Run `ant auth login` on the server machine (or set ANTHROPIC_API_KEY). The server re-checks every minute."
          : `Could not reach Claude: ${msg}`,
    };
  }
  return ai;
}

// Optional shared passcode. Set APP_PASSCODE when the server is reachable from the internet,
// so only your team can spend your Claude usage.
const PASSCODE = process.env.APP_PASSCODE?.trim() || "";
const digest = (v: string) => createHash("sha256").update(v).digest();
const passcodeOk = (given: unknown) =>
  !PASSCODE || (typeof given === "string" && timingSafeEqual(digest(given), digest(PASSCODE)));

const app = express();
app.use(express.json({ limit: "60mb" }));

app.get("/api/health", async (req, res) => {
  const status = await checkAi();
  res.json({
    ok: true,
    ai: status.ready,
    aiError: status.error ?? null,
    model: MODEL,
    passcodeRequired: Boolean(PASSCODE),
    passcodeOk: passcodeOk(req.get("x-app-passcode")),
  });
});

const SYSTEM_PROMPT = `You are a make-ready inspector for a residential rental company. A unit has just been vacated. You review photos of one room and list every item that must be fixed, replaced, or cleaned before the unit can be rented to the next tenant.

Look closely for:
- Water damage: ceiling or wall stains, bubbling/peeling paint, warped baseboards, swollen cabinet bases (especially under sinks), rust rings, efflorescence.
- Mold or mildew: caulk lines, grout, window sills, around tubs/showers, ceilings in bathrooms.
- Paint: scuffs, marks, nail holes, patched areas not painted, mismatched colors, peeling. Note whether spot touch-up or a full wall/room repaint is likely needed.
- Wall/ceiling damage: holes, dents, cracks, doorknob punctures, missing wall stops.
- Stains on carpet, flooring, counters, tubs, sinks, toilets.
- Flooring: carpet wear, pet damage, tears, lifted seams, chipped/cracked tile, scratched or gouged hard floors, missing transitions.
- Appliances: dents, missing or broken parts (knobs, shelves, drawers, burner grates, drip pans, door gaskets), heavy grease, burnt residue, rust, damage that suggests it may not work.
- HVAC: dirty or dusty supply/return vents and grilles, dirty filters, rusted or bent registers.
- Cleaning: dirt, grease, dust, debris, items left behind, hard-water buildup, soap scum.
- Plumbing: leaks, corrosion, loose fixtures, damaged caulk, slow-drain signs.
- Electrical: missing/broken cover plates, dead or missing bulbs, damaged fixtures, exposed wiring.
- Fixtures/hardware, cabinets/counters, doors/windows/blinds/screens.
- Pest evidence: droppings, nests, insects.
- Safety: missing or damaged smoke/CO detectors, trip hazards, broken glass, missing handrails.

Rules:
- Report only what the photos show. Do not invent problems. If something is unclear, report it with a lower confidence and say "verify on site" in the recommended action.
- One finding per distinct problem. If the same problem appears in several photos, report it once using the clearest photo.
- photoId must be one of the ids given to you.
- bbox is the approximate area of the problem on that photo, as fractions of image width and height (x, y = top-left corner, all values 0 to 1). Use null if the problem is not localized (for example "whole room needs cleaning").
- Cost estimates are rough US dollar ranges for labor plus materials at typical property-management vendor rates. Use whole numbers.
- confidence is 0 to 1.
- trade is who should do the work.
- missingShots lists important views of this room type that the photos do not cover (for example "under kitchen sink", "inside oven"), so the inspector can go back and take them. Use an empty list if coverage is good.
- roomSummary is 1-2 plain sentences on the overall condition of the room.

Inventory:
Also record every appliance, finish, and fixture you can see in the room, whether or not it needs repair. The leasing and maintenance teams use this list to order matching parts, paint, and replacement appliances.
- appliance: refrigerator, range/oven, cooktop, wall oven, microwave, range hood, dishwasher, garbage disposal, washer, dryer, water heater, furnace/air handler, AC unit, thermostat, etc.
- finish: flooring, countertops, backsplash, cabinets (material, door style, color), wall paint (color and likely sheen), ceiling, trim and doors, tub/shower surround, tile, window coverings.
- fixture: faucets, sinks, toilet, tub, vanity, shower head, light fixtures, ceiling fans, cabinet and door hardware, towel bars, outlet/switch covers.
For each item:
- item is what it is ("Refrigerator", "Countertop", "Kitchen faucet", "Wall paint").
- type is the style or material ("French-door, bottom freezer", "Quartz", "Luxury vinyl plank", "Single-handle pull-down").
- colorFinish is the color and finish ("Stainless steel", "White shaker", "Brushed nickel", "Light gray, eggshell").
- brand only if a logo or label is readable in the photo; otherwise an empty string. model only if the model number is readable on a label; otherwise an empty string. Never guess a brand or model number.
- notes: anything else useful for ordering or matching, such as gas or electric, approximate size or width, number of burners, approximate age, or "label photo needed for model number". Empty string if nothing to add.
- condition is good, fair, poor, replace, or unknown.
- Record each physical item once, even if it appears in several photos; use the clearest photo for photoId.`;

const FINDINGS_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["findings", "inventory", "roomSummary", "missingShots"],
  properties: {
    inventory: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["photoId", "kind", "item", "type", "colorFinish", "brand", "model", "notes", "condition", "confidence"],
        properties: {
          photoId: { type: "string" },
          kind: { type: "string", enum: [...INVENTORY_KINDS] },
          item: { type: "string" },
          type: { type: "string" },
          colorFinish: { type: "string" },
          brand: { type: "string" },
          model: { type: "string" },
          notes: { type: "string" },
          condition: { type: "string", enum: [...CONDITIONS] },
          confidence: { type: "number" },
        },
      },
    },
    roomSummary: { type: "string" },
    missingShots: { type: "array", items: { type: "string" } },
    findings: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "photoId",
          "category",
          "severity",
          "title",
          "description",
          "recommendedAction",
          "trade",
          "estCostLow",
          "estCostHigh",
          "confidence",
          "bbox",
        ],
        properties: {
          photoId: { type: "string" },
          category: { type: "string", enum: [...ISSUE_CATEGORIES] },
          severity: { type: "string", enum: [...SEVERITIES] },
          title: { type: "string" },
          description: { type: "string" },
          recommendedAction: { type: "string" },
          trade: { type: "string", enum: [...TRADES] },
          estCostLow: { type: "number" },
          estCostHigh: { type: "number" },
          confidence: { type: "number" },
          bbox: {
            anyOf: [
              {
                type: "object",
                additionalProperties: false,
                required: ["x", "y", "w", "h"],
                properties: {
                  x: { type: "number" },
                  y: { type: "number" },
                  w: { type: "number" },
                  h: { type: "number" },
                },
              },
              { type: "null" },
            ],
          },
        },
      },
    },
  },
} as const;

const clamp01 = (n: number) => Math.min(1, Math.max(0, Number.isFinite(n) ? n : 0));

app.post("/api/analyze", async (req, res) => {
  if (!passcodeOk(req.get("x-app-passcode"))) {
    res.status(401).json({ error: "Wrong or missing passcode.", passcode: true });
    return;
  }
  const status = await checkAi();
  if (!status.ready) {
    res.status(503).json({ error: status.error ?? "AI inspection is not available." });
    return;
  }

  const body = req.body as AnalyzeRequest;
  if (!body?.photos?.length) {
    res.status(400).json({ error: "No photos to analyze." });
    return;
  }
  if (body.photos.length > MAX_PHOTOS_PER_REQUEST) {
    res.status(400).json({ error: `Send at most ${MAX_PHOTOS_PER_REQUEST} photos per request.` });
    return;
  }

  const content: Anthropic.Beta.BetaContentBlockParam[] = [];
  for (const p of body.photos) {
    content.push({ type: "text", text: `Photo id: ${p.photoId} — view: ${p.label}` });
    content.push({ type: "image", source: { type: "base64", media_type: p.mediaType, data: p.data } });
  }
  content.push({
    type: "text",
    text:
      `Room: "${body.roomName}" (type: ${body.roomType}).\n` +
      `Valid categories: ${ISSUE_CATEGORIES.map((c) => `${c} (${CATEGORY_LABELS[c]})`).join(", ")}.\n` +
      `List everything that must be done to make this room rent-ready, and inventory the appliances, finishes, and fixtures.`,
  });

  try {
    // Streaming: findings plus inventory for up to 10 photos can be a long answer.
    const stream = client.beta.messages.stream({
      model: MODEL,
      max_tokens: 64000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      thinking: { type: "adaptive" },
      output_config: {
        effort: "high",
        format: { type: "json_schema", schema: FINDINGS_SCHEMA as unknown as Record<string, unknown> },
      },
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content }],
    });
    const response = await stream.finalMessage();

    if (response.stop_reason === "refusal") {
      res.status(422).json({ error: "The AI declined to analyze these photos. Add issues manually." });
      return;
    }
    if (response.stop_reason === "max_tokens") {
      res.status(502).json({ error: "The analysis was cut off. Try fewer photos at a time." });
      return;
    }

    const text = response.content
      .map((b) => (b.type === "text" ? b.text : ""))
      .join("")
      .trim();
    const parsed = JSON.parse(text) as AnalyzeResponse;

    const validIds = new Set(body.photos.map((p) => p.photoId));
    parsed.findings = parsed.findings.map((f) => ({
      ...f,
      photoId: validIds.has(f.photoId) ? f.photoId : body.photos[0].photoId,
      estCostLow: Math.max(0, Math.round(f.estCostLow)),
      estCostHigh: Math.max(Math.round(f.estCostLow), Math.round(f.estCostHigh)),
      confidence: clamp01(f.confidence),
      bbox: f.bbox
        ? {
            x: clamp01(f.bbox.x),
            y: clamp01(f.bbox.y),
            w: clamp01(Math.min(f.bbox.w, 1 - f.bbox.x)),
            h: clamp01(Math.min(f.bbox.h, 1 - f.bbox.y)),
          }
        : null,
    }));
    parsed.inventory = (parsed.inventory ?? []).map((it) => ({
      ...it,
      photoId: validIds.has(it.photoId) ? it.photoId : body.photos[0].photoId,
      confidence: clamp01(it.confidence),
    }));
    res.json(parsed);
  } catch (err) {
    if (err instanceof Anthropic.RateLimitError) {
      res.status(429).json({ error: "AI service is busy. Wait a minute and try again." });
    } else if (err instanceof Anthropic.AuthenticationError) {
      ai = { ready: false, checkedAt: Date.now(), error: "The server's Claude login expired or was rejected. Run `ant auth login` again." };
      res.status(503).json({ error: ai.error });
    } else if (err instanceof Anthropic.BadRequestError) {
      res.status(400).json({ error: `AI request rejected: ${err.message}` });
    } else if (err instanceof Anthropic.APIError) {
      res.status(502).json({ error: `AI service error: ${err.message}` });
    } else if (err instanceof SyntaxError) {
      res.status(502).json({ error: "The AI returned an unreadable answer. Try again." });
    } else {
      console.error(err);
      res.status(500).json({ error: "Unexpected server error." });
    }
  }
});

// Serve the built front end in production.
const dist = path.join(here, "..", "dist");
if (fs.existsSync(dist)) {
  app.use(express.static(dist));
  app.get(/^(?!\/api).*/, (_req, res) => res.sendFile(path.join(dist, "index.html")));
}

app.listen(PORT, async () => {
  console.log(`RentReadies on http://localhost:${PORT}`);
  console.log(`Claude credentials: ${authSource}`);
  const status = await checkAi(true);
  console.log(status.ready ? `AI inspection ready (${MODEL}).` : `AI inspection OFF: ${status.error}`);
  if (!PASSCODE) console.log("No APP_PASSCODE set. Set one before exposing this server to the internet.");
});
